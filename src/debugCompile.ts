import * as os from "os"
import * as path from "path"
import { expandConfiguredPath } from "./vCommand"

/** A counter so two debug sessions started in the same millisecond do not collide. */
let debugSessionCounter = 0

/** The path the debug build of a program is written to.
 *
 * A temporary directory rather than next to the source, because a debug build is
 * not something the user asked to keep and a source tree should not gain build
 * artifacts from starting a debug session.
 *
 * The name carries a timestamp, a counter and the program name, so two sessions on
 * the same program do not collide and a leftover is identifiable.
 */
export function debugBinaryPath(program: string): string {
	const base = path.basename(program, path.extname(program))
	return path.join(os.tmpdir(), `v-debug-${Date.now()}-${debugSessionCounter++}-${base}`)
}

/** The arguments for compiling a program for debugging.
 *
 * `-g` is the debug info that lets a breakpoint in V source resolve to a location
 * in the binary. `-o` writes to the path `debugBinaryPath` computed, because the
 * default output name would land in the source tree. `-d
 * panics_break_into_debugger` turns a panic into a trap while a debugger is
 * attached instead of an exit: every panic funnels through `v_panic`, so no
 * V-side change was needed, and without a debugger the flag changes
 * nothing. Measured: SIGTRAP with `risky()` and `wmain` on the stack.
 */
export function debugCompileArgs(program: string, binary: string): string[] {
	return ["-g", "-d", "panics_break_into_debugger", "-o", binary, program]
}

const mainFunction = /^fn\s+main\s*\(/

/** Zero-based line numbers declaring `fn main`.
 *
 * Drives the Debug CodeLens: exactly the lines a session starts from,
 * without parsing anything else. Indented and commented-out matches do
 * not count; `main` is always top level.
 */
export function mainFunctionLines(source: string): number[] {
	const lines: number[] = []
	const split = source.split("\n")
	for (let index = 0; index < split.length; index++) {
		if (mainFunction.test(split[index] ?? "")) {
			lines.push(index)
		}
	}
	return lines
}

/** Actionable error when the debugger is not on PATH.
 *
 * gdb is not installed by default on Windows and effectively unavailable
 * on macOS, so a first debug session there otherwise dies with a raw
 * spawn error. The message names the per-OS install route. `platform`
 * defaults to the host so tests can pin each branch.
 */
export function missingDebuggerMessage(
	platform: NodeJS.Platform = process.platform,
	debuggerCommand = "gdb",
): string {
	if (debuggerCommand !== "gdb") {
		const hint =
			platform === "win32"
				? "Install LLVM from the releases page and put its bin directory on PATH."
				: platform === "darwin"
					? "Install the Xcode command line tools (`xcode-select --install`); lldb ships with them."
					: "Install LLDB (`sudo apt install lldb` or `sudo dnf install lldb`)."
		return `Cannot debug: ${debuggerCommand} was not found on PATH. ${hint}`
	}
	const hint =
		platform === "win32"
			? "Install GDB via MSYS2 (`pacman -S mingw-w64-ucrt-x86_64-gdb`) or MinGW-w64 and restart VS Code so it is on PATH."
			: platform === "darwin"
				? "Install GDB (`brew install gdb`) and codesign it per the GDB macOS instructions."
				: "Install GDB (`sudo apt install gdb` or `sudo dnf install gdb`)."
	return `Cannot debug: gdb was not found on PATH. ${hint}`
}

/** The MI debugger a V debug session runs under. */
export type VDebuggerMode = "gdb" | "lldb"

/** Resolve the debugger command for a session.
 *
 * A configured path expands `~`, `${env:NAME}` and `${workspaceFolder}`
 * exactly like the other executable settings, so the `~` regression test
 * shape applies here from day one. Blank means the mode default, which
 * the adapter searches for on PATH.
 */
export function resolveDebuggerCommand(
	configuredPath: string | undefined,
	miMode: VDebuggerMode,
	workspaceFolder?: string,
): string {
	const value = (configuredPath ?? "").trim()
	if (!value) {
		return miMode === "lldb" ? "lldb" : "gdb"
	}
	return expandConfiguredPath(value, workspaceFolder)
}

/** The `cppdbg` launch configuration a V debug session delegates to.
 *
 * Raw `gdb --interpreter=mi2` never answers DAP `initialize`
 * (`Undefined command: "Content-Length"`), so no session can run that
 * way on any platform. Instead the `type: "v"` config is rewritten to
 * the C/C++ extension's real adapter; only `program` is required there,
 * and `MIMode`/`miDebuggerPath`/`setupCommands`/`args`/`cwd` carry over.
 * The pretty printers are GDB scripts, so a non-gdb mode gets no printer
 * setup commands.
 */
export interface CppdbgLaunchConfiguration {
	type: "cppdbg"
	request: "launch" | "attach"
	name: string
	program: string
	args: string[]
	cwd: string
	MIMode: VDebuggerMode
	miDebuggerPath: string
	stopAtEntry: boolean
	setupCommands: CppdbgSetupCommand[]
	environment?: CppdbgEnvironmentEntry[]
	envFile?: string
	externalConsole?: boolean
	processId?: string
	sourceFileMap?: Record<string, string>
	miDebuggerServerAddress?: string
	pipeTransport?: CppdbgPipeTransport
}

/** Remote debugging transport for the MI debugger.
 *
 * `debuggerPath` is the debugger on the REMOTE end of the pipe: it may live
 * at a different path than the local `miDebuggerPath` (that is why the pipe
 * exists at all), so it must never be resolved against the local PATH. The
 * pipe program itself (`ssh`, ...) is local and resolved normally. */
export interface CppdbgPipeTransport {
	pipeProgram: string
	pipeArgs?: string[]
	pipeCwd?: string
	pipeEnv?: Record<string, string>
	debuggerPath: string
}

/** Arguments that run the remote debugger through a pipe program.
 *
 * The remote debugger path goes verbatim after the pipe arguments: resolving
 * it locally would substitute the wrong executable whenever the remote gdb
 * or lldb-dap lives at a different path. Extra debugger arguments (e.g.
 * gdb's `-i=dap`) follow the remote path. */
export function pipeTransportArgs(
	pipeTransport: CppdbgPipeTransport,
	debuggerArgs: string[] = [],
): string[] {
	return [...(pipeTransport.pipeArgs ?? []), pipeTransport.debuggerPath, ...debuggerArgs]
}

/** An environment entry for the debugged program. */
export interface CppdbgEnvironmentEntry {
	name: string
	value: string
}

export interface CppdbgSetupCommand {
	description: string
	text: string
	ignoreFailures: boolean
}

/** A user-supplied setup command from the V launch configuration. */
export interface VSetupCommandInput {
	description?: string
	text: string
	ignoreFailures?: boolean
}

/** Normalize user setup commands: only `text` is required.
 *
 * A failing user command never fails the session, the same rule the
 * built-in printer commands follow: a session that starts without one
 * skipped breakpoint beats no session.
 */
export function normalizeSetupCommands(
	entries: VSetupCommandInput[] | undefined,
): CppdbgSetupCommand[] {
	return (entries ?? []).map((entry) => ({
		description: entry.description ?? "",
		text: entry.text,
		ignoreFailures: entry.ignoreFailures ?? true,
	}))
}

/** MI setup commands that load the V pretty printers for a session.
 *
 * The texts are MI commands, which is what the adapter sends: printing is
 * enabled explicitly, and the printers script runs through the console
 * interpreter. Backslashes become forward slashes first, so a Windows path
 * needs no MI-level escaping beyond its quotes. A printer failure never
 * fails the session: debugging without pretty printers beats not debugging.
 */
export function gdbSetupCommands(printersPath: string): CppdbgSetupCommand[] {
	const script = printersPath.replace(/\\/g, "/").replace(/"/g, '\\"')
	return [
		{
			description: "Enable GDB pretty-printing",
			text: "-enable-pretty-printing",
			ignoreFailures: true,
		},
		{
			description: "Load V pretty printers",
			text: `-interpreter-exec console "source \\"${script}\\""`,
			ignoreFailures: true,
		},
	]
}

/** The printers script shipped with the extension, next to the bundle. */
export function vPrintersPath(bundleDirectory: string): string {
	return path.join(bundleDirectory, "..", "scripts", "gdb", "v_printers.py")
}

export function cppdbgLaunchConfig(input: {
	name: string
	binary: string
	args: string[]
	cwd: string
	stopAtEntry: boolean
	printersPath: string
	miMode: VDebuggerMode
	miDebuggerPath: string
	setupCommands?: VSetupCommandInput[]
	environment?: CppdbgEnvironmentEntry[]
	envFile?: string
	externalConsole?: boolean
	sourceFileMap?: Record<string, string>
	miDebuggerServerAddress?: string
	pipeTransport?: CppdbgPipeTransport
	usePrettyPrinters?: boolean
}): CppdbgLaunchConfiguration {
	const userCommands = normalizeSetupCommands(input.setupCommands)
	const usePrinters = input.usePrettyPrinters ?? true
	return {
		type: "cppdbg",
		request: "launch",
		name: input.name,
		program: input.binary,
		args: input.args,
		cwd: input.cwd,
		MIMode: input.miMode,
		miDebuggerPath: input.miDebuggerPath,
		stopAtEntry: input.stopAtEntry,
		setupCommands:
			input.miMode === "gdb" && usePrinters
				? [...gdbSetupCommands(input.printersPath), ...userCommands]
				: userCommands,
		...(input.environment ? { environment: input.environment } : {}),
		...(input.envFile ? { envFile: input.envFile } : {}),
		...(input.externalConsole !== undefined ? { externalConsole: input.externalConsole } : {}),
		...(input.sourceFileMap ? { sourceFileMap: input.sourceFileMap } : {}),
		...(input.miDebuggerServerAddress
			? { miDebuggerServerAddress: input.miDebuggerServerAddress }
			: {}),
		...(input.pipeTransport ? { pipeTransport: input.pipeTransport } : {}),
	}
}

/** Rewrite a V attach configuration into a real debug session.
 *
 * Attaching means joining a running process, so there is nothing to
 * compile: `program` names the binary for symbols, and `processId`
 * passes through untouched — including `${command:pickProcess}`, which
 * the adapter's own process picker provides.
 */
export function cppdbgAttachConfig(input: {
	name: string
	program: string
	processId: string
	cwd: string
	printersPath: string
	miMode: VDebuggerMode
	miDebuggerPath: string
	setupCommands?: VSetupCommandInput[]
	sourceFileMap?: Record<string, string>
	miDebuggerServerAddress?: string
	pipeTransport?: CppdbgPipeTransport
	usePrettyPrinters?: boolean
}): CppdbgLaunchConfiguration {
	const userCommands = normalizeSetupCommands(input.setupCommands)
	const usePrinters = input.usePrettyPrinters ?? true
	return {
		type: "cppdbg",
		request: "attach",
		name: input.name,
		program: input.program,
		args: [],
		cwd: input.cwd,
		MIMode: input.miMode,
		miDebuggerPath: input.miDebuggerPath,
		stopAtEntry: false,
		setupCommands:
			input.miMode === "gdb" && usePrinters
				? [...gdbSetupCommands(input.printersPath), ...userCommands]
				: userCommands,
		processId: input.processId,
		...(input.sourceFileMap ? { sourceFileMap: input.sourceFileMap } : {}),
		...(input.miDebuggerServerAddress
			? { miDebuggerServerAddress: input.miDebuggerServerAddress }
			: {}),
		...(input.pipeTransport ? { pipeTransport: input.pipeTransport } : {}),
	}
}

/** Actionable error when the delegation target is not installed.
 *
 * V debug sessions run on the C/C++ extension's `cppdbg` adapter; our
 * extensionPack recommends it, but a recommendation is not a guarantee.
 */
export function missingCppdbgMessage(): string {
	return "Cannot debug: the C/C++ extension (ms-vscode.cpptools) is not installed. Install it from the Marketplace — V debugging delegates to its cppdbg adapter."
}

/** Result of probing a gdb for DAP capability. */
export interface GdbPreflightResult {
	adapter: "gdb-dap" | "cppdbg" | null
	/** Whether the probed gdb's DAP accepts `coreFile` on attach.
	 *
	 * DAP core-file support arrived in GDB 18 (gdb-patches, April 2026):
	 * GDB 15.1 and 17.1 only accept `pid`/`target` (the live verifier
	 * records a SKIP there), so core-file attach is gated on GDB 18+. */
	coreFileDap: boolean
	error?: string
}

/** Extract the gdb version from a `--version` banner.
 *
 * Distro packaging adds a vendor tag that shifts the version away from the
 * `(GDB)` shape, e.g. `GNU gdb (Ubuntu 15.1-1ubuntu1) 15.1` or
 * `GNU gdb (Debian 13.1-3) 13.1`. The canonical form ends with the version
 * right after the vendor tag, so prefer that: a dotted distro suffix
 * (`~22.04`), a Fedora release tag (`13.2-5.fc38`), or a git build stamp
 * (`16.0.50.20240513-git`) must never win over the real version. Without
 * a vendor tag the first `X.Y` is the version. */
export function parseGdbVersion(text: string): string {
	const firstLine = text.split(/\r?\n/)[0] ?? ""
	const trailing = /\)\s*(\d+\.\d+)/.exec(firstLine)?.[1]
	if (trailing) {
		return trailing
	}
	return firstLine.match(/\d+\.\d+/)?.[0] ?? ""
}

/** Normalize a preflight input into text + exit code. */
function normalizePreflightInput(input: unknown): {
	text: string
	exitCode: number
	version: string
	notFound: boolean
	cppdbgAvailable: boolean
} {
	if (input === null || input === undefined) {
		return { text: "", exitCode: 1, version: "", notFound: true, cppdbgAvailable: false }
	}
	if (typeof input === "string") {
		const text = input
		const notFound =
			/not found/i.test(text) || /not recognized/i.test(text) || /no such file/i.test(text)
		const version = parseGdbVersion(text)
		return { text, exitCode: notFound ? 127 : 0, version, notFound, cppdbgAvailable: false }
	}
	const obj = input as Record<string, unknown>
	const stdout = String(obj.stdout ?? obj.output ?? "")
	const stderr = String(obj.stderr ?? "")
	const text = `${stdout}\n${stderr}`
	const exitCode = Number(obj.exitCode ?? obj.code ?? obj.status ?? 0)
	const version = (typeof obj.version === "string" && obj.version) || parseGdbVersion(text)
	const notFound = Boolean(obj.notFound) || /not found/i.test(text)
	const cppdbgAvailable = Boolean(obj.cppdbgAvailable ?? obj.cppdbg)
	return { text, exitCode, version, notFound, cppdbgAvailable }
}

/** Probe a gdb's recorded output and decide which adapter to use. */
export function preflightGdb(input?: unknown): GdbPreflightResult {
	const { text, exitCode, version, notFound, cppdbgAvailable } = normalizePreflightInput(input)
	if (notFound) {
		return { adapter: null, coreFileDap: false, error: "gdb not found on PATH" }
	}
	const hasPython =
		!/Python scripting is not supported/i.test(text) && !/No module named/i.test(text)
	const hasDap =
		!/Interpreter `dap' unrecognized/i.test(text) &&
		!/Could not find interpreter "dap"/i.test(text) &&
		!/unrecognized/i.test(text) &&
		(exitCode === 0 || /ok/i.test(text))
	const verNum = parseFloat(version || "0")
	const coreFileDap = verNum >= 18
	if (hasPython && hasDap && verNum >= 13) {
		return { adapter: "gdb-dap", coreFileDap }
	}
	if (cppdbgAvailable) {
		return { adapter: "cppdbg", coreFileDap }
	}
	const verLabel = version ? `gdb ${version}` : "gdb"
	return {
		adapter: null,
		coreFileDap,
		error: `${verLabel} has no DAP support (built without Python). Install gdb >= 13 with Python, or enable the cppdbg fallback (v.debug.adapter = 'cppdbg').`,
	}
}

export const parseGdbPreflight = preflightGdb
export const gdbPreflight = preflightGdb
export const probeGdb = preflightGdb
export const gdbDapPreflight = preflightGdb
export const checkGdb = preflightGdb

/** Translate an MI setup command to the GDB CLI form the built-in adapter needs.
 *
 * The launch schema documents `setupCommands` as MI commands, which is what
 * the `cppdbg` adapter sends. The built-in adapter instead passes them to
 * `gdb -iex`, which expects CLI commands: GDB 18.1 rejects the MI
 * `-enable-pretty-printing` there as an undefined command. Known MI shapes
 * translate exactly, any other `-command` runs wrapped in
 * `-interpreter-exec mi`, and text that is already a CLI command passes
 * through untouched. */
export function gdbSetupCommandToCli(text: string): string {
	const trimmed = text.trim()
	if (trimmed === "-enable-pretty-printing") {
		return "set print pretty on"
	}
	const consoleMatch = trimmed.match(/^-interpreter-exec\s+console\s+"([\s\S]*)"$/)
	if (consoleMatch) {
		return consoleMatch[1]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\")
	}
	if (trimmed.startsWith("-")) {
		return `-interpreter-exec mi "${trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
	}
	return text
}

/** Whether a launch value is an unsubstituted `${command:...}` reference.
 *
 * `resolveDebugConfiguration` runs before VS Code substitutes variables, so
 * the built-in attach path sees the literal `${command:v.pickProcess}`
 * default. Matching it here lets the provider run its own picker instead of
 * handing GDB DAP a string it cannot parse as a PID. */
export function isCommandReference(value: string): boolean {
	return /^\$\{command:[^}]+\}$/.test(value.trim())
}

/** The DAP fields a built-in attach session needs.
 *
 * GDB DAP (and lldb-dap) attach takes `pid` for a live process, `target`
 * for a remote target, or `coreFile` for a post-mortem — never the
 * `processId` string the `cppdbg` adapter accepts. A PID that is not a
 * positive integer, or an attach with neither a PID, a target, nor a core
 * file, is a configuration error surfaced before any session starts. When
 * a remote target is set it wins over a PID: GDB documents attach as
 * trying `pid`, then `target`, then `coreFile` (first one found is used),
 * so sending both would attach locally and silently ignore the remote.
 */
export function dapAttachFields(input: {
	processId?: string
	coreFile?: string
	target?: string
}): { pid?: number; coreFile?: string; target?: string } | { error: string } {
	const pidText = (input.processId ?? "").trim()
	const coreFile = (input.coreFile ?? "").trim()
	const target = (input.target ?? "").trim()
	if (!pidText && !coreFile && !target) {
		return { error: "Cannot debug: attach needs a processId, a coreFile, or a remote target." }
	}
	if (!pidText) {
		return {
			...(target ? { target } : {}),
			...(coreFile ? { coreFile } : {}),
		}
	}
	const pid = Number(pidText)
	if (!Number.isInteger(pid) || pid <= 0) {
		return { error: `Cannot debug: "${input.processId}" is not a process ID.` }
	}
	return {
		// A remote target takes precedence: sending both would let the
		// local pid shadow the remote the user asked for.
		...(target ? { target } : { pid }),
		...(coreFile ? { coreFile } : {}),
	}
}

/** Parse a `KEY=VALUE` environment file.
 *
 * Blank lines and `#` comments are ignored; only the first `=` splits,
 * so values may contain `=`. Runs on the substituted path (see the
 * provider's `resolveDebugConfigurationWithSubstitutedVariables`), never
 * on the raw `${workspaceFolder}/...` form. */
export function parseEnvFile(text: string): Record<string, string> {
	const entries: Record<string, string> = {}
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim()
		if (!line || line.startsWith("#")) {
			continue
		}
		const eq = line.indexOf("=")
		if (eq > 0) {
			entries[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
		}
	}
	return entries
}

/** Build the `env` object a built-in DAP launch sends.
 *
 * GDB/LLDB DAP replace the debuggee environment with `env` instead of
 * merging, so sending only the configured entries would drop PATH, HOME
 * and everything else inherited. Start from the inherited environment and
 * overlay in increasing precedence: inherited < envFile entries <
 * explicit `environment` entries. */
export function buildDapEnv(
	explicit?: CppdbgEnvironmentEntry[],
	base: NodeJS.ProcessEnv = process.env,
	envFileEntries?: Record<string, string>,
): Record<string, string> {
	const env: Record<string, string> = {}
	for (const [key, value] of Object.entries(base)) {
		if (value !== undefined) {
			env[key] = value
		}
	}
	for (const [key, value] of Object.entries(envFileEntries ?? {})) {
		env[key] = value
	}
	for (const entry of explicit ?? []) {
		env[entry.name] = entry.value
	}
	return env
}

/** A launch configuration carrying the pieces the env merge reads.
 *
 * Structural (not `vscode.DebugConfiguration`) so the merge stays testable
 * without the vscode API: the provider narrows its own config to this. */
export interface DapLaunchEnvConfig {
	environment?: CppdbgEnvironmentEntry[]
	envFile?: string
	env?: Record<string, string>
}

/** Merge parsed envFile entries into a launch configuration.
 *
 * Runs on the substituted config (see the provider's
 * `resolveDebugConfigurationWithSubstitutedVariables`): the `envFile` path
 * there is already expanded, so `${workspaceFolder}/.env` resolves instead
 * of being read literally and swallowed. Precedence is inherited < envFile
 * < explicit `environment`; `envFile` itself is dropped because neither GDB
 * DAP nor lldb-dap consumes it. */
export function withEnvFileEntries(
	configuration: DapLaunchEnvConfig & Record<string, unknown>,
	fileEntries: Record<string, string>,
	base: NodeJS.ProcessEnv = process.env,
): DapLaunchEnvConfig & Record<string, unknown> {
	const resolved: DapLaunchEnvConfig & Record<string, unknown> = {
		...configuration,
		env: buildDapEnv(configuration.environment, base, fileEntries),
	}
	delete resolved.envFile
	return resolved
}

/** The lldb-dap fields a V launch or attach configuration needs.
 *
 * lldb-dap does not understand the GDB/cppdbg field names the V config
 * carries: `stopAtEntry` is `stopOnEntry`, `sourceFileMap` (`{from: to}`)
 * is `sourceMap` (`[[from, to], ...]`), and `setupCommands` run as
 * `preRunCommands` (lldb commands, untranslated). The pretty-printer
 * import goes in `initCommands`. Both launch and attach share this
 * conversion so attach sessions do not silently drop it. */
export interface LldbDapConvertedFields {
	stopOnEntry: boolean
	sourceMap?: [string, string][]
	preRunCommands: string[]
	initCommands: string[]
}

export function lldbDapFields(input: {
	stopAtEntry?: boolean
	sourceFileMap?: Record<string, string>
	setupCommands?: VSetupCommandInput[]
	usePrettyPrinters?: boolean
	formattersPath?: string
}): LldbDapConvertedFields {
	const pairs = Object.entries(input.sourceFileMap ?? {})
	return {
		stopOnEntry: input.stopAtEntry ?? false,
		...(pairs.length ? { sourceMap: pairs } : {}),
		preRunCommands: (input.setupCommands ?? []).map((command) => command.text),
		initCommands:
			input.usePrettyPrinters !== false && input.formattersPath
				? [`command script import ${input.formattersPath}`]
				: [],
	}
}
