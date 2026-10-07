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

/** The GDB command line for a debug session on a compiled binary.
 *
 * `--eval-command` must come before `-- <binary>`: gdb treats everything
 * after `--` as excess executable arguments and ignores it, so an
 * eval-command placed after the binary never runs.
 *
 * The entry symbol is platform dependent. V inlines `fn main` into the C
 * entry point, which is `wmain` on Windows — there is no `main` symbol at
 * all, and `break main` answers "Function main not defined". Verified
 * against a `-g` build on Windows: `break wmain` stops at the first V
 * statement with the V source line shown. `platform` defaults to the host
 * so tests can pin each branch.
 */
export function debugSessionArgs(
	binary: string,
	stopAtEntry: boolean,
	platform: NodeJS.Platform = process.platform,
): string[] {
	const args = ["--interpreter=mi2"]
	if (stopAtEntry) {
		args.push("--eval-command", `break ${platform === "win32" ? "wmain" : "main"}`)
	}
	args.push("--", binary)
	return args
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
