/** Translating between V and C.
 *
 * Everything here is pure so it can be tested without an editor. The editor
 * wiring lives in `commands.ts`.
 */

import * as os from "os"
import * as path from "path"
import { isExecutable } from "./vCommand"

function replaceExtension(fileName: string, extension: string): string {
	const current = path.extname(fileName)
	return `${fileName.slice(0, fileName.length - current.length)}${extension}`
}

/** The C file name V writes for a V source file.
 *
 * `hello.v` is translated to `hello.c` beside it, which is the spelling V's own
 * help uses: `v -o h.c hello.v`.
 */
export function cOutputFileName(sourceFileName: string): string {
	return replaceExtension(sourceFileName, ".c")
}

/** The V file c2v writes for a C source file.
 *
 * c2v names its output after its input, so `hello.c` becomes `hello.v` beside
 * it, unless a `c2v.toml` redirects the output directory.
 */
export function vOutputFileName(sourceFileName: string): string {
	return replaceExtension(sourceFileName, ".v")
}

/** Whether a file is a C source c2v can translate.
 *
 * The extension is the gate rather than the language ID, because this extension
 * does not contribute the `c` language: a `.c` file only reports `languageId`
 * `c` when the C/C++ extension is installed and enabled.
 */
export function isCFileName(fileName: string): boolean {
	return path.extname(fileName).toLowerCase() === ".c"
}

function defaultVModulesDirectory(): string {
	// V reads VMODULES first and only then falls back to `~/.vmodules` (vlib/os/os.v).
	return process.env.VMODULES || path.join(os.homedir(), ".vmodules")
}

/** The c2v executable, or `undefined` when it is not built.
 *
 * `v install --git https://github.com/vlang/c2v` only clones the source into
 * `~/.vmodules/c2v`, so the executable is built there and nowhere on PATH. That
 * is the location V's own `cmd/tools/translate.v` runs, so it is the only place
 * to look, and a missing executable is the state an install leaves behind.
 */
export function c2vExecutable(vmodulesDirectory = defaultVModulesDirectory()): string | undefined {
	const executableName = process.platform === "win32" ? "c2v.exe" : "c2v"
	const executable = path.join(vmodulesDirectory, "c2v", executableName)
	return isExecutable(executable) ? executable : undefined
}

/** The message for a machine where c2v is not built.
 *
 * Both commands are the ones V's own C2V CI runs (`.github/workflows/c2v_ci.yml`):
 * the install only clones, so the second is what produces the executable. c2v is
 * a Clang front end, so a missing `clang` is the next failure, and naming it here
 * saves the user a second round trip.
 */
export const c2vNotInstalledMessage =
	"c2v is not installed. Run `v install --git https://github.com/vlang/c2v` to clone it, " +
	"then `v -g ~/.vmodules/c2v/` to build it, and try again. " +
	"c2v also needs a `clang` binary on your PATH."
