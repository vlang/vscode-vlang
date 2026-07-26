import { exec as _exec } from "child_process"
import { getVExecCommand } from "exec"
import * as fs from "fs"
import { log } from "logger"
import * as os from "os"
import * as path from "path"
import { promisify } from "util"
import { ProgressLocation, Uri, window, workspace, WorkspaceFolder } from "vscode"

export const config = () => workspace.getConfiguration("v")

export const vlsConfig = () => workspace.getConfiguration("v.vls")

const exec = promisify(_exec)
const userBinPath = path.join(os.homedir(), ".local", "bin")

/** Get current working directory.
 * @param uri The URI of document
 */
export function getCwd(uri?: Uri): string {
	const folder = getWorkspaceFolder(uri || null)
	return folder.uri.fsPath
}

/** Get workspace of current document.
 * @param uri The URI of document
 */
export function getWorkspaceFolder(uri?: Uri): WorkspaceFolder {
	if (uri) {
		return workspace.getWorkspaceFolder(uri)
	} else if (window.activeTextEditor && window.activeTextEditor.document) {
		return workspace.getWorkspaceFolder(window.activeTextEditor.document.uri)
	} else {
		return workspace.workspaceFolders[0]
	}
}

/**
 * Checks if the 'v' command is available in the system's PATH.
 * @returns A promise that resolves to true if 'v' is installed, otherwise false.
 */
export async function isVInstalled(): Promise<boolean> {
	const vexec = getVExecCommand()
	try {
		// A simple command to check if V is installed and in the PATH.
		const version = await exec(`${vexec} --version`)
		log(`V is already installed, version: ${version.stdout.trim()}`)
		return true
	} catch (error) {
		log(`V is not detected in PATH: ${error}`)
		return false
	}
}

/**
 * Clone and build the `v` compiler
 *
 * Returns: absolute path to the `v` binary (string)
 * Error: rejects if any git/make step fails
 */
export async function installV(): Promise<void> {
	const installDir = userBinPath
	const vRepoPath = path.join(installDir, "v")
	const repoUrl = "https://github.com/vlang/v"

	await window.withProgress(
		{
			location: ProgressLocation.Notification,
			title: "Installing V Language",
			cancellable: false,
		},
		async (progress) => {
			try {
				// 0. Clean up any previous failed attempts
				progress.report({ message: "Preparing workspace..." })
				if (fs.existsSync(installDir)) {
					fs.rmSync(installDir, { recursive: true, force: true })
				}
				fs.mkdirSync(installDir)

				// 1. Clone the repository
				progress.report({ message: "Cloning V repository..." })
				await exec(`git clone --depth=1 ${repoUrl}`, { cwd: installDir })

				// 2. Build V using make
				progress.report({ message: "Building V from source (this may take a moment)..." })
				await exec("make", { cwd: vRepoPath })

				// 3. Create a symlink
				// This command often requires sudo/admin privileges.
				// We run it and inform the user to run it manually if it fails.
				progress.report({ message: "Attempting to create symlink..." })

				try {
					// On Windows, the build script handles the path. On Linux/macOS, symlink is used.
					const symlinkCommand =
						os.platform() === "win32" ? "v.exe symlink" : "./v symlink"
					await exec(symlinkCommand, { cwd: vRepoPath })

					window.showInformationMessage(
						"V language installed and linked successfully! Please restart VS Code to use the `v` command.",
					)
				} catch (symlinkError) {
					console.error(symlinkError)
					window.showWarningMessage(
						`V was built successfully, but the automatic symlink failed (likely due to permissions). Please run '${path.join(vRepoPath, "v")} symlink' manually with administrator/sudo rights.`,
						"OK",
					)
				}
			} catch (error) {
				console.error(error)
				window.showErrorMessage(
					`Failed to install V. Please check the logs for details. Error: ${error}`,
				)
			}
		},
	)
}
