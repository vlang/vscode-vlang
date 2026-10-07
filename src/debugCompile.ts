import * as os from "os"
import * as path from "path"

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


/** Actionable error when GDB is not on PATH.
 *
 * gdb is not installed by default on Windows and effectively unavailable
 * on macOS, so a first debug session there otherwise dies with a raw
 * spawn error. The message names the per-OS install route. `platform`
 * defaults to the host so tests can pin each branch. When the planned
 * debugger-path setting lands, its resolution replaces this check.
 */
export function missingDebuggerMessage(platform: NodeJS.Platform = process.platform): string {
	const hint =
		platform === "win32"
			? "Install GDB via MSYS2 (`pacman -S mingw-w64-ucrt-x86_64-gdb`) or MinGW-w64 and restart VS Code so it is on PATH."
			: platform === "darwin"
				? "Install GDB (`brew install gdb`) and codesign it per the GDB macOS instructions."
				: "Install GDB (`sudo apt install gdb` or `sudo dnf install gdb`)."
	return `Cannot debug: gdb was not found on PATH. ${hint}`
}

/** The `cppdbg` launch configuration a V debug session delegates to.
 *
 * Raw `gdb --interpreter=mi2` never answers DAP `initialize`
 * (`Undefined command: "Content-Length"`), so no session can run that
 * way on any platform. Instead the `type: "v"` config is rewritten to
 * the C/C++ extension's real adapter; only `program` is required there,
 * and `MIMode`/`setupCommands`/`args`/`cwd` carry over. `MIMode` stays
 * `gdb` until the planned debugger-path setting (D1-1) parameterizes it.
 */
export interface CppdbgLaunchConfiguration {
	type: "cppdbg"
	request: "launch"
	name: string
	program: string
	args: string[]
	cwd: string
	MIMode: "gdb"
	stopAtEntry: boolean
}

export function cppdbgLaunchConfig(input: {
	name: string
	binary: string
	args: string[]
	cwd: string
	stopAtEntry: boolean
}): CppdbgLaunchConfiguration {
	return {
		type: "cppdbg",
		request: "launch",
		name: input.name,
		program: input.binary,
		args: input.args,
		cwd: input.cwd,
		MIMode: "gdb",
		stopAtEntry: input.stopAtEntry,
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
