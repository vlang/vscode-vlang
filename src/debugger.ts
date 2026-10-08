import { execFile as _execFile } from "child_process"
import { promisify } from "util"
import * as path from "path"
import * as vscode from "vscode"
import {
	cppdbgAttachConfig,
	cppdbgLaunchConfig,
	debugBinaryPath,
	debugCompileArgs,
	mainFunctionLines,
	missingCppdbgMessage,
	missingDebuggerMessage,
	resolveDebuggerCommand,
	vPrintersPath,
	type CppdbgEnvironmentEntry,
	type CppdbgPipeTransport,
	type VDebuggerMode,
	type VSetupCommandInput,
} from "./debugCompile"
import { resolvedCommand } from "./vCommand"
import { vCommandFor } from "./vExecutable"

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
	sourceFileMap?: Record<string, string>
	miDebuggerServerAddress?: string
	pipeTransport?: CppdbgPipeTransport
}

/** Compile a V program to a binary with debug info. */
async function compileForDebug(vCommand: string, program: string, cwd: string): Promise<string> {
	const binary = debugBinaryPath(program)
	await execFile(vCommand, debugCompileArgs(program, binary), { cwd, timeout: compileTimeoutMs })
	return binary
}

/** The extension a V debug session delegates to. */
const cppdbgExtensionId = "ms-vscode.cpptools"

/** Rewrite a V launch configuration into a real debug session.
 *
 * Spawning raw `gdb --interpreter=mi2` cannot work: it never answers DAP
 * `initialize` (`Undefined command: "Content-Length"`), so no session can
 * run that way on any platform. Instead the program is compiled here and
 * the configuration is rewritten to the C/C++ extension's `cppdbg`
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
		if (!vscode.extensions.getExtension(cppdbgExtensionId)) {
			const action = "Install C/C++ Extension"
			const choice = await vscode.window.showErrorMessage(missingCppdbgMessage(), action)
			if (choice === action) {
				await vscode.commands.executeCommand(
					"workbench.extensions.installExtension",
					cppdbgExtensionId,
				)
			}
			return undefined
		}
		const vCommand = workspaceFolder ? vCommandFor(workspaceFolder) : "v"
		const cwd =
			vConfiguration.cwd ||
			workspaceFolder?.uri.fsPath ||
			path.dirname(vConfiguration.program)
		if (vConfiguration.request === "attach") {
			if (!vConfiguration.processId) {
				void vscode.window.showErrorMessage(
					"Cannot debug: attach needs a processId, e.g. ${command:pickProcess}.",
				)
				return undefined
			}
			return cppdbgAttachConfig({
				name: configuration.name,
				program: vConfiguration.program,
				processId: vConfiguration.processId,
				cwd,
				printersPath: vPrintersPath(__dirname),
				miMode,
				miDebuggerPath: debuggerPath,
				setupCommands: vConfiguration.setupCommands,
				sourceFileMap: vConfiguration.sourceFileMap,
				miDebuggerServerAddress: vConfiguration.miDebuggerServerAddress,
				pipeTransport: vConfiguration.pipeTransport,
			})
		}
		return vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Window, title: "Compiling V for debugging..." },
			async () => {
				const binary = await compileForDebug(vCommand, vConfiguration.program, cwd)
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
				})
			},
		)
	}
}

/** Register the V debugger.
 *
 * The debugger is contributed in `package.json` with `type: "v"`. This
 * provider compiles the program and rewrites the configuration to the
 * `cppdbg` adapter before the session starts. A CodeLens over `fn main`
 * starts the same pipeline without a launch configuration.
 */
export function registerDebugger(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.debug.registerDebugConfigurationProvider("v", new VDebugConfigurationProvider()),
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
		return mainFunctionLines(document.getText()).map(
			(line) =>
				new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
					title: "Debug Main",
					command: "v.debugMain",
					arguments: [document.uri],
				}),
		)
	}
}
