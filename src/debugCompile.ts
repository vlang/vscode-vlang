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
 * default output name is derived from the source and would land in the source tree.
 */
export function debugCompileArgs(program: string, binary: string): string[] {
	return ["-g", "-o", binary, program]
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
	request: "launch"
	name: string
	program: string
	args: string[]
	cwd: string
	MIMode: VDebuggerMode
	miDebuggerPath: string
	stopAtEntry: boolean
	setupCommands: CppdbgSetupCommand[]
}

export interface CppdbgSetupCommand {
	description: string
	text: string
	ignoreFailures: boolean
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
}): CppdbgLaunchConfiguration {
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
		setupCommands: input.miMode === "gdb" ? gdbSetupCommands(input.printersPath) : [],
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
