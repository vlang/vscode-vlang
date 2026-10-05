import * as os from "os"
import * as path from "path"

export const V_REPO_URL = "https://github.com/vlang/v"

/** One action the installer takes.
 *
 * `optional` marks a step whose failure is reported to the user rather than
 * aborting the install: the symlink needs elevated rights that `git clone` does
 * not.
 *
 * `remove` exists so the destructive shape is explicit rather than absent: the
 * plan below never produces one, and a test asserts that. Deleting a directory
 * is only ever a deliberate change to this file.
 */
export type InstallStep =
	| { kind: "mkdir"; dir: string; message: string }
	| {
			kind: "run"
			command: string
			args: string[]
			cwd: string
			message: string
			optional?: boolean
	  }
	| { kind: "remove"; target: string }

export interface InstallPlan {
	/** The user's bin directory. It holds every tool the user installed, not just
	 * V, so nothing here may delete it. */
	binDir: string
	/** Where the V checkout goes. A child of `binDir`. */
	repoDir: string
	/** Absolute path to the V binary the build produces. */
	executable: string
	steps: InstallStep[]
}

/** The bin directory the installer writes into.
 * @param homeDir Home directory to resolve against. Defaults to the current user.
 */
export function userBinDir(homeDir: string = os.homedir()): string {
	return path.join(homeDir, ".local", "bin")
}

/** The V binary a checkout at `repoDir` builds.
 * @param repoDir Directory holding the V source tree.
 */
export function vExecutable(repoDir: string): string {
	return path.join(repoDir, process.platform === "win32" ? "v.exe" : "v")
}

/** Describe how to install V into `homeDir`, without touching the filesystem.
 *
 * Nothing is deleted. An earlier version removed the whole bin directory before
 * cloning, which destroyed every other tool the user had installed there. A
 * directory the user owns is theirs to remove; the installer only ever adds to
 * it, and reports a leftover checkout instead of clearing it.
 *
 * Every command is a program and an argument array, so nothing is re-read as a
 * shell word, and the symlink step names the binary by absolute path rather than
 * relying on `v` already being on PATH.
 */
export function installPlan(homeDir: string = os.homedir()): InstallPlan {
	const binDir = userBinDir(homeDir)
	const repoDir = path.join(binDir, "v")
	const executable = vExecutable(repoDir)
	return {
		binDir,
		repoDir,
		executable,
		steps: [
			{ kind: "mkdir", dir: binDir, message: "Preparing directory..." },
			{
				kind: "run",
				command: "git",
				args: ["clone", "--depth=1", V_REPO_URL],
				cwd: binDir,
				message: "Cloning V repository...",
			},
			{
				kind: "run",
				command: "make",
				args: [],
				cwd: repoDir,
				message: "Building V from source (this may take a moment)...",
			},
			{
				kind: "run",
				command: executable,
				args: ["symlink"],
				cwd: repoDir,
				message: "Attempting to create symlink...",
				optional: true,
			},
		],
	}
}
