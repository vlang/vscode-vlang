import { execFile as _execFile, spawn as _spawn } from "child_process"
import { promisify } from "util"
import * as path from "path"
import * as fs from "fs"
import * as vscode from "vscode"
import { parseByVersion } from "./documentMemo"
import {
	cppdbgAttachConfig,
	cppdbgLaunchConfig,
	dapAttachFields,
	debugBinaryPath,
	debugCompileArgs,
	gdbSetupCommandToCli,
	isCommandReference,
	shouldSkipProcessPicker,
	lldbDapFields,
	buildDapEnv,
	mainFunctionLines,
	missingCppdbgMessage,
	missingDebuggerMessage,
	parseEnvFile,
	preflightGdb,
	pipeTransportArgs,
	resolveDebuggerCommand,
	vPrintersPath,
	type CppdbgEnvironmentEntry,
	type CppdbgPipeTransport,
	type GdbPreflightResult,
	type VDebuggerMode,
	type VSetupCommandInput,
	withEnvFileEntries,
} from "./debugCompile"
import { resolvedCommand } from "./vCommand"
import { vCommandForProgram } from "./vExecutable"
import { processLaunchCommand } from "./processExecution"

const execFile = promisify(_execFile)

/** How long to wait for the compile step of a debug session. */
const compileTimeoutMs = 60_000

/** The shape of a V debug configuration.
 *
 * `program` is the V source file to debug. It is compiled with `-g` before the
 * session starts, because the debug info is what lets a breakpoint in V source map
 * to a location in the binary. `miDebuggerPath` names the MI debugger (a path
 * or a command on PATH, with `~` expanded); blank means the `MIMode` default.
 */
export interface VDebugConfiguration extends vscode.DebugConfiguration {
	program: string
	args?: string[]
	stopAtEntry?: boolean
	cwd?: string
	miDebuggerPath?: string
	MIMode?: VDebuggerMode
	setupCommands?: VSetupCommandInput[]
	environment?: CppdbgEnvironmentEntry[]
	envFile?: string
	externalConsole?: boolean
	processId?: string
	coreFile?: string
	sourceFileMap?: Record<string, string>
	miDebuggerServerAddress?: string
	pipeTransport?: CppdbgPipeTransport
}

/** Compile a V program to a binary with debug info. */
async function compileForDebug(
	vCommand: string,
	program: string,
	cwd: string,
	signal?: AbortSignal,
): Promise<string> {
	const binary = debugBinaryPath(program)
	// The configured compiler may be a `.bat`/`.cmd` launcher, which Node
	// cannot spawn directly on Windows; the launch goes through `cmd.exe`.
	const launch = processLaunchCommand(vCommand, debugCompileArgs(program, binary))
	await execFile(launch.command, launch.args, {
		cwd,
		timeout: compileTimeoutMs,
		signal,
		windowsVerbatimArguments: launch.windowsVerbatimArguments,
	})
	return binary
}

/** The extension a V debug session can delegate to when it is present. */
const cppdbgExtensionId = "ms-vscode.cpptools"
/** The adapter a V debug session can run on. */
type VDebugAdapter = "gdb-dap" | "lldb-dap" | "cppdbg"

/** A selected adapter plus the probed gdb DAP surface behind it.
 *
 * `coreFileDap` gates core-file attach: DAP coreFile support arrived in
 * GDB 18, so older gdb DAPs (observed up to 17.1) reject `coreFile` and the
 * provider errors out instead of launching into a guaranteed failure. */
interface AdapterSelection {
	adapter: VDebugAdapter
	coreFileDap: boolean
}

/** Decide which adapter a session uses and refuse to launch a broken one.
 *
 * `v.debug.adapter` selects explicitly; `auto` prefers the built-in gdb/lldb
 * DAP server and falls back to `cppdbg` when the debugger cannot serve DAP
 * itself. Probing gdb first matters: launching an unsupported gdb would die
 * on `Content-Length` errors, so an explicit `gdb-dap` that fails the probe
 * cancels the session instead of falling back silently.
 */
async function selectAdapter(
	miMode: VDebuggerMode,
	debuggerPath: string,
	workspaceFolder?: string,
): Promise<AdapterSelection | undefined> {
	const configured = vscode.workspace.getConfiguration("v").get<string>("debug.adapter", "auto")
	const hasCppdbg = !!vscode.extensions.getExtension(cppdbgExtensionId)
	if (configured === "cppdbg") {
		if (!hasCppdbg) {
			void vscode.window.showErrorMessage(missingCppdbgMessage())
			return undefined
		}
		return { adapter: "cppdbg", coreFileDap: false }
	}
	if (miMode === "lldb") {
		if (configured === "gdb-dap") {
			void vscode.window.showErrorMessage(
				'Cannot debug: v.debug.adapter is "gdb-dap" but MIMode is "lldb". Use "lldb-dap" or "auto".',
			)
			return undefined
		}
		const lldbDap =
			resolvedCommand("lldb-dap", workspaceFolder) ||
			resolvedCommand("lldb-vscode", workspaceFolder)
		if (lldbDap) {
			return { adapter: "lldb-dap", coreFileDap: false }
		}
		if (configured === "lldb-dap") {
			void vscode.window.showErrorMessage(
				missingDebuggerMessage(process.platform, "lldb-dap"),
			)
			return undefined
		}
		if (hasCppdbg) {
			return { adapter: "cppdbg", coreFileDap: false }
		}
		void vscode.window.showErrorMessage(missingDebuggerMessage(process.platform, "lldb"))
		return undefined
	}
	if (configured === "lldb-dap") {
		void vscode.window.showErrorMessage(
			'Cannot debug: v.debug.adapter is "lldb-dap" but MIMode is "gdb". Use "gdb-dap" or "auto".',
		)
		return undefined
	}
	const probe = await probeGdbCapability(debuggerPath)
	if (probe.adapter === "gdb-dap") {
		return { adapter: "gdb-dap", coreFileDap: probe.coreFileDap }
	}
	if (configured === "gdb-dap") {
		void vscode.window.showErrorMessage(
			probe.error ?? missingDebuggerMessage(process.platform, "gdb"),
		)
		return undefined
	}
	if (hasCppdbg) {
		return { adapter: "cppdbg", coreFileDap: probe.coreFileDap }
	}
	void vscode.window.showErrorMessage(
		probe.error ?? missingDebuggerMessage(process.platform, "gdb"),
	)
	return undefined
}

/** Probe a gdb binary for DAP capability without starting a session.
 *
 * Runs the same three checks `scripts/verify-dap.sh` gates CI on (version,
 * Python support, the `dap` interpreter) and feeds the combined output to
 * `preflightGdb`, so the provider and the script agree on what counts as
 * DAP-capable. Probe exit codes are preserved: a failed probe must not be
 * classified as capable just because its diagnostic text is unrecognized.
 */
async function probeGdbCapability(gdbPath: string): Promise<GdbPreflightResult> {
	const runs: Promise<{ output: string; exitCode: number }>[] = [
		runProbe(gdbPath, ["--version"]),
		runProbe(gdbPath, ["--batch", "-ex", 'python print("ok")']),
		runProbe(gdbPath, ["-i=dap", "--batch"]),
	]
	const results = await Promise.all(runs)
	const combined = results.map((result) => result.output).join("\n")
	const exitCode = results.some((result) => result.exitCode !== 0) ? 1 : 0
	return preflightGdb({ output: combined, exitCode })
}

/** Run one gdb probe, folding spawn failures into text the preflight parser reads. */
function runProbe(gdbPath: string, args: string[]): Promise<{ output: string; exitCode: number }> {
	return new Promise((resolve) => {
		// `stdio: "ignore"` for stdin mirrors the `</dev/null` the verify
		// script uses: `gdb -i=dap --batch` must see EOF, not a held pipe.
		const child = _spawn(gdbPath, args, { stdio: ["ignore", "pipe", "pipe"] })
		let stdout = ""
		let stderr = ""
		const timer = setTimeout(() => child.kill("SIGKILL"), 15_000)
		child.stdout?.on("data", (chunk) => {
			stdout += String(chunk)
		})
		child.stderr?.on("data", (chunk) => {
			stderr += String(chunk)
		})
		child.on("error", (error) => {
			clearTimeout(timer)
			resolve({ output: `${stdout}\n${stderr}\n${error.message}`, exitCode: 1 })
		})
		child.on("close", (code) => {
			clearTimeout(timer)
			resolve({
				output: `${stdout}\n${stderr}`,
				exitCode: typeof code === "number" ? code : 1,
			})
		})
	})
}

/** Rewrite a V launch configuration into a real debug session.
 *
 * Spawning raw `gdb --interpreter=mi2` cannot work: it never answers DAP
 * `initialize` (`Undefined command: "Content-Length"`), so no session can
 * run that way on any platform. Instead the program is compiled here and
 * the configuration runs on the selected adapter: the built-in gdb/lldb DAP
 * server when the debugger supports it, else the C/C++ extension's `cppdbg`
 * adapter, which speaks DAP. The compile still happens here rather than
 * in a `preLaunchTask`, so the debugger stays self-contained: a user
 * does not need a task defined to start a session.
 *
 * Returning `undefined` cancels the session with the message already
 * shown; that is preferable to launching into a guaranteed failure.
 */
export class VDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
	async resolveDebugConfiguration(
		folder: vscode.WorkspaceFolder | undefined,
		configuration: vscode.DebugConfiguration,
	): Promise<vscode.DebugConfiguration | undefined> {
		const vConfiguration = configuration as VDebugConfiguration
		if (!vConfiguration.program) {
			void vscode.window.showErrorMessage(
				"Cannot debug: no V program in the launch configuration.",
			)
			return undefined
		}
		const workspaceFolder =
			folder ?? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(vConfiguration.program))
		const miMode = vConfiguration.MIMode === "lldb" ? "lldb" : "gdb"
		const debuggerCommand = resolveDebuggerCommand(
			vConfiguration.miDebuggerPath,
			miMode,
			workspaceFolder?.uri.fsPath,
		)
		const debuggerPath = resolvedCommand(debuggerCommand, workspaceFolder?.uri.fsPath)
		if (!debuggerPath) {
			const configured = (vConfiguration.miDebuggerPath ?? "").trim()
			void vscode.window.showErrorMessage(
				configured
					? `Cannot debug: debugger not found: ${debuggerCommand}. Check miDebuggerPath.`
					: missingDebuggerMessage(process.platform, miMode),
			)
			return undefined
		}
		const selection = await selectAdapter(miMode, debuggerPath, workspaceFolder?.uri.fsPath)
		if (!selection) {
			return undefined
		}
		const adapter = selection.adapter
		const usePrettyPrinters = vscode.workspace
			.getConfiguration("v")
			.get("debug.usePrettyPrinters", true)
		const vCommand = vCommandForProgram(vConfiguration.program, workspaceFolder)
		const cwd =
			vConfiguration.cwd ||
			workspaceFolder?.uri.fsPath ||
			path.dirname(vConfiguration.program)
		if (vConfiguration.request === "attach") {
			// Read `coreFile` and the remote target before the picker: the
			// attach schema defaults `processId` to `${command:v.pickProcess}`,
			// so a core-file-only or target-only config still carries the
			// picker reference. Running it would send both `pid` and
			// `coreFile`/`target`, and GDB DAP prefers the PID over the
			// requested dump or remote. A command reference alongside a core
			// file or target is treated as absent (no pick, no PID).
			const coreFile = (vConfiguration.coreFile ?? "").trim() || undefined
			const target = (vConfiguration.miDebuggerServerAddress ?? "").trim() || undefined
			let processId = vConfiguration.processId
			if (processId && shouldSkipProcessPicker({ processId, coreFile, target })) {
				processId = undefined
			} else if (processId && isCommandReference(processId)) {
				// Variable substitution has not run yet, so the built-in
				// adapter cannot defer to a picker command: run ours now.
				const picked = await pickProcess()
				if (!picked) {
					return undefined
				}
				processId = picked
			}
			if (adapter === "cppdbg") {
				if (!processId) {
					void vscode.window.showErrorMessage(
						coreFile
							? 'Cannot debug: core-file attach needs the built-in adapter; set v.debug.adapter to "auto" or "gdb-dap".'
							: "Cannot debug: attach needs a processId, e.g. ${command:v.pickProcess}.",
					)
					return undefined
				}
				return cppdbgAttachConfig({
					name: configuration.name,
					program: vConfiguration.program,
					processId,
					cwd,
					printersPath: vPrintersPath(__dirname),
					miMode,
					miDebuggerPath: debuggerPath,
					setupCommands: vConfiguration.setupCommands,
					sourceFileMap: vConfiguration.sourceFileMap,
					miDebuggerServerAddress: vConfiguration.miDebuggerServerAddress,
					pipeTransport: vConfiguration.pipeTransport,
					usePrettyPrinters,
				})
			}
			// GDB DAP and lldb-dap attach take `pid` for a live process, `target`
			// for a remote, or `coreFile` for a post-mortem: the cppdbg
			// `processId` string (or a target-only or core-file-only
			// configuration with no PID at all) maps here, because neither
			// adapter recognizes `processId`. The target comes from
			// miDebuggerServerAddress first, so a remote attach validates even
			// without a PID — and when both are set the target wins.
			const fields = dapAttachFields({ processId, coreFile, target })
			if ("error" in fields) {
				void vscode.window.showErrorMessage(fields.error)
				return undefined
			}
			if (
				fields.coreFile &&
				miMode === "gdb" &&
				adapter === "gdb-dap" &&
				!selection.coreFileDap
			) {
				void vscode.window.showErrorMessage(
					"Cannot debug: core-file attach needs DAP coreFile support, which arrived in GDB 18 " +
						"(this GDB's DAP predates it). Install a newer GDB with Python support.",
				)
				return undefined
			}
			const resolved = {
				...configuration,
				type: "v",
				request: "attach",
				program: vConfiguration.program,
				...(fields.pid !== undefined ? { pid: fields.pid } : {}),
				...(fields.coreFile ? { coreFile: fields.coreFile } : {}),
				...(fields.target ? { target: fields.target } : {}),
				cwd,
				miDebuggerPath: debuggerPath,
				MIMode: miMode,
				...(vConfiguration.miDebuggerServerAddress
					? { miDebuggerServerAddress: vConfiguration.miDebuggerServerAddress }
					: {}),
				...(miMode === "lldb"
					? lldbDapFields({
							sourceFileMap: vConfiguration.sourceFileMap,
							setupCommands: vConfiguration.setupCommands,
							usePrettyPrinters,
							formattersPath: lldbFormattersPath(),
						})
					: {
							...(vConfiguration.sourceFileMap
								? { sourceFileMap: vConfiguration.sourceFileMap }
								: {}),
						}),
			}
			delete (resolved as Partial<VDebugConfiguration>).processId
			return resolved
		}
		return vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Window,
				title: "Compiling V for debugging...",
				cancellable: true,
			},
			async (_progress, token) => {
				if (token.isCancellationRequested) {
					return undefined
				}
				const controller = new AbortController()
				const cancellation = token.onCancellationRequested(() => controller.abort())
				try {
					const binary = await compileForDebug(
						vCommand,
						vConfiguration.program,
						cwd,
						controller.signal,
					)
					if (token.isCancellationRequested) {
						return undefined
					}
					if (adapter === "cppdbg") {
						return cppdbgLaunchConfig({
							name: configuration.name,
							binary,
							args: vConfiguration.args ?? [],
							cwd,
							stopAtEntry: vConfiguration.stopAtEntry ?? false,
							printersPath: vPrintersPath(__dirname),
							miMode,
							miDebuggerPath: debuggerPath,
							setupCommands: vConfiguration.setupCommands,
							environment: vConfiguration.environment,
							envFile: vConfiguration.envFile,
							externalConsole: vConfiguration.externalConsole,
							sourceFileMap: vConfiguration.sourceFileMap,
							miDebuggerServerAddress: vConfiguration.miDebuggerServerAddress,
							pipeTransport: vConfiguration.pipeTransport,
							usePrettyPrinters,
						})
					}
					// GDB/LLDB DAP replace the debuggee environment with `env`,
					// so seed it from the inherited environment: an explicit
					// entry must add to PATH, not wipe it. The envFile merges
					// later in `resolveDebugConfigurationWithSubstitutedVariables`,
					// once VS Code has substituted variables in its path — and
					// read errors surface as a warning there instead of a
					// silent empty map. Nothing configured means no `env` at
					// all: the debuggee then inherits naturally.
					const hasExplicitEnv =
						(vConfiguration.environment?.length ?? 0) > 0 ||
						!!(vConfiguration.envFile ?? "").trim()
					const finalEnv = hasExplicitEnv
						? buildDapEnv(vConfiguration.environment)
						: undefined
					return {
						...configuration,
						type: "v",
						request: "launch",
						program: binary,
						args: vConfiguration.args ?? [],
						cwd,
						miDebuggerPath: debuggerPath,
						MIMode: miMode,
						env: finalEnv,
						envFile: vConfiguration.envFile,
						externalConsole: vConfiguration.externalConsole,
						...(miMode === "lldb"
							? lldbDapFields({
									stopAtEntry: vConfiguration.stopAtEntry ?? false,
									sourceFileMap: vConfiguration.sourceFileMap,
									setupCommands: vConfiguration.setupCommands,
									usePrettyPrinters,
									formattersPath: lldbFormattersPath(),
								})
							: {
									stopAtEntry: vConfiguration.stopAtEntry ?? false,
									stopAtBeginningOfMainSubprogram:
										vConfiguration.stopAtEntry ?? false,
									...(vConfiguration.sourceFileMap
										? { sourceFileMap: vConfiguration.sourceFileMap }
										: {}),
								}),
					}
				} finally {
					cancellation.dispose()
				}
			},
		)
	}

	/** Merge `envFile` into `env` after VS Code substitutes variables.
	 *
	 * `resolveDebugConfiguration` runs before substitution, so an
	 * `envFile` like `${workspaceFolder}/.env` would be read literally
	 * there and silently yield nothing. Here the path is already
	 * substituted: parse it (`KEY=VALUE`, `#` comments and blank lines
	 * ignored) and merge over the inherited environment, under the
	 * explicit `environment` entries. A read error warns instead of
	 * failing the session. `envFile` itself is dropped from the resolved
	 * config: neither GDB DAP nor lldb-dap consumes it (the `cppdbg`
	 * path, which does, never reaches this hook).
	 */
	async resolveDebugConfigurationWithSubstitutedVariables(
		_folder: vscode.WorkspaceFolder | undefined,
		configuration: vscode.DebugConfiguration,
	): Promise<vscode.DebugConfiguration | undefined> {
		const vConfiguration = configuration as VDebugConfiguration
		if (
			configuration.type !== "v" ||
			configuration.request !== "launch" ||
			typeof vConfiguration.envFile !== "string" ||
			!vConfiguration.envFile.trim()
		) {
			return configuration
		}
		let fileEntries: Record<string, string> = {}
		try {
			fileEntries = parseEnvFile(fs.readFileSync(vConfiguration.envFile, "utf8"))
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error)
			void vscode.window.showWarningMessage(
				`Cannot read envFile ${vConfiguration.envFile}: ${detail}. Launching without it.`,
			)
		}
		return withEnvFileEntries(configuration, fileEntries) as vscode.DebugConfiguration
	}
}

/** The LLDB pretty-printer script shipped with the extension, next to the bundle. */
function lldbFormattersPath(): string {
	return path.join(__dirname, "..", "scripts", "lldb", "v_formatters.py").replace(/\\/g, "/")
}

/** Register the V debugger.
 *
 * The debugger is contributed in `package.json` with `type: "v"`. This
 * provider compiles the program and selects the adapter (`v.debug.adapter`:
 * the built-in gdb/lldb DAP server when the debugger supports it, else the
 * `cppdbg` adapter). A CodeLens over `fn main` starts the same pipeline
 * without a launch configuration.
 */
export function registerDebugger(context: vscode.ExtensionContext): void {
	// `v.pickProcess` is the documented picker and is always ours. The bare
	// `pickProcess` id is legacy: it is registered here only when cpptools is
	// absent, otherwise it would shadow the C/C++ extension's own picker that
	// `cppdbg` configurations rely on.
	context.subscriptions.push(
		vscode.commands.registerCommand("v.pickProcess", () => pickProcess()),
	)
	if (!vscode.extensions.getExtension(cppdbgExtensionId)) {
		context.subscriptions.push(
			vscode.commands.registerCommand("pickProcess", () => pickProcess()),
		)
	}
	context.subscriptions.push(
		vscode.debug.registerDebugConfigurationProvider("v", new VDebugConfigurationProvider()),
		vscode.debug.registerDebugAdapterDescriptorFactory(
			"v",
			new VDebugAdapterDescriptorFactory(),
		),
		vscode.languages.registerCodeLensProvider(
			{ scheme: "file", language: "v" },
			new VDebugCodeLensProvider(),
		),
		vscode.commands.registerCommand("v.debugMain", (uri?: vscode.Uri) => debugMain(uri)),
	)
}

function activeVFilePath(): string | undefined {
	const document = vscode.window.activeTextEditor?.document
	if (!document || document.uri.scheme !== "file") {
		return undefined
	}
	if (document.languageId !== "v" && !document.fileName.endsWith(".vsh")) {
		return undefined
	}
	return document.uri.fsPath
}

async function debugMain(uri?: vscode.Uri): Promise<void> {
	const filePath = uri?.scheme === "file" ? uri.fsPath : activeVFilePath()
	if (!filePath) {
		void vscode.window.showErrorMessage("No V file to debug.")
		return
	}
	const fileUri = uri?.scheme === "file" ? uri : vscode.Uri.file(filePath)
	const folder = vscode.workspace.getWorkspaceFolder(fileUri)
	const started = await vscode.debug.startDebugging(folder, {
		type: "v",
		request: "launch",
		name: `Debug ${path.basename(filePath)}`,
		program: filePath,
	})
	if (!started) {
		void vscode.window.showErrorMessage("Could not start the V debug session.")
	}
}

class VDebugCodeLensProvider implements vscode.CodeLensProvider {
	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		if (document.uri.scheme !== "file") {
			return []
		}
		return parseByVersion(document, mainFunctionLines).map(
			(line) =>
				new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
					title: "Debug Main",
					command: "v.debugMain",
					arguments: [document.uri],
				}),
		)
	}
}

class VDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
	createDebugAdapterDescriptor(
		session: vscode.DebugSession,
	): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
		const config = session.configuration as VDebugConfiguration
		const miMode = config.MIMode === "lldb" ? "lldb" : "gdb"
		const folder = vscode.workspace.workspaceFolders?.[0]
		const debuggerCommand = resolveDebuggerCommand(
			config.miDebuggerPath,
			miMode,
			folder?.uri.fsPath,
		)
		const debuggerPath = resolvedCommand(debuggerCommand, folder?.uri.fsPath)
		if (!debuggerPath) {
			return undefined
		}
		if (config.pipeTransport) {
			const pt = config.pipeTransport
			const pipePath = resolvedCommand(pt.pipeProgram, folder?.uri.fsPath)
			if (!pipePath || !pt.debuggerPath.trim()) {
				return undefined
			}
			// `pt.debuggerPath` is the debugger on the remote end: it goes
			// verbatim after the pipe arguments and is never resolved against
			// the local PATH, where it may not exist at all.
			if (miMode === "lldb") {
				return new vscode.DebugAdapterExecutable(
					pipePath,
					pipeTransportArgs(pt),
					pt.pipeCwd ? { cwd: pt.pipeCwd } : undefined,
				)
			}
			return new vscode.DebugAdapterExecutable(
				pipePath,
				pipeTransportArgs(pt, ["-i=dap"]),
				pt.pipeCwd ? { cwd: pt.pipeCwd } : undefined,
			)
		}
		if (miMode === "lldb") {
			const lldbDap =
				resolvedCommand("lldb-dap", folder?.uri.fsPath) ||
				resolvedCommand("lldb-vscode", folder?.uri.fsPath)
			if (!lldbDap) {
				return undefined
			}
			return new vscode.DebugAdapterExecutable(lldbDap, [])
		}
		const usePrinters = vscode.workspace
			.getConfiguration("v")
			.get("debug.usePrettyPrinters", true)
		const args = ["-i=dap"]
		if (usePrinters) {
			const printers = vPrintersPath(__dirname).replace(/\\/g, "/")
			args.push("-iex", `source ${printers}`)
			// gdb >= 13 required; older gdb may parse -iex differently under DAP.
		}
		const sessionConfig = session.configuration as VDebugConfiguration
		for (const [from, to] of Object.entries(sessionConfig.sourceFileMap ?? {})) {
			args.push("-iex", `set substitute-path ${from} ${to}`)
		}
		// `setupCommands` are documented as MI commands; `gdb -iex` expects
		// CLI, so known MI shapes translate (the pretty-printer enablement
		// included) instead of failing as undefined commands.
		for (const command of sessionConfig.setupCommands ?? []) {
			args.push("-iex", gdbSetupCommandToCli(command.text))
		}
		return new vscode.DebugAdapterExecutable(debuggerPath, args)
	}
}

async function pickProcess(): Promise<string | undefined> {
	const items: { label: string; description: string; pid: string }[] = []
	try {
		if (process.platform === "win32") {
			const { stdout } = await execFile("tasklist", ["/FO", "CSV", "/NH"], {
				encoding: "utf8",
			})
			for (const line of stdout.split(/\r?\n/)) {
				const match = line.match(/^"([^"]+)","(\d+)"/)
				if (match) {
					items.push({
						label: match[1]!,
						description: `PID ${match[2]!}`,
						pid: match[2]!,
					})
				}
			}
		} else {
			const { stdout } = await execFile("ps", ["-eo", "pid=,comm="], { encoding: "utf8" })
			for (const line of stdout.split(/\r?\n/)) {
				const parts = line.trim().split(/\s+/)
				if (parts.length >= 2) {
					items.push({
						label: parts.slice(1).join(" "),
						description: `PID ${parts[0]!}`,
						pid: parts[0]!,
					})
				}
			}
		}
	} catch {
		return undefined
	}
	const choice = await vscode.window.showQuickPick(
		items.map((item) => ({ label: item.label, description: item.description, pid: item.pid })),
		{ placeHolder: "Select a process" },
	)
	return choice ? (choice as { pid: string }).pid : undefined
}
