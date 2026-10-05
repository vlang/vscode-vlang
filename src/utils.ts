import { execFile as _execFile } from "child_process"
import { getVExecCommand } from "exec"
import { installPlan } from "installPlan"
import * as fs from "fs"
import { log } from "logger"
import { promisify } from "util"
import { ProgressLocation, Uri, window, workspace, WorkspaceFolder } from "vscode"

export const config = () => workspace.getConfiguration("v")

export const vlsConfig = () => workspace.getConfiguration("v.vls")

const execFile = promisify(_execFile)

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
		const version = await execFile(vexec, ["--version"])
		log(`V is already installed, version: ${version.stdout.trim()}`)
		return true
	} catch (error) {
		log(`V is not detected in PATH: ${error}`)
		return false
	}
}

/**
 * Clone and build the `v` compiler into `~/.local/bin/v`.
 *
 * Nothing is deleted: `~/.local/bin` holds every tool the user installed, so a
 * failed earlier attempt is left in place and reported instead of wiped.
 */
export async function installV(): Promise<void> {
	const plan = installPlan()

	await window.withProgress(
		{
			location: ProgressLocation.Notification,
			title: "Installing V Language",
			cancellable: false,
		},
		async (progress) => {
			try {
				for (const step of plan.steps) {
					progress.report({ message: step.kind === "remove" ? "" : step.message })

					if (step.kind === "mkdir") {
						fs.mkdirSync(step.dir, { recursive: true })
						continue
					}

					if (step.kind === "remove") {
						// The plan never produces one of these. Fail loudly rather than
						// delete a directory the installer does not own.
						throw new Error(`refusing to remove ${step.target}`)
					}

					try {
						await execFile(step.command, step.args, { cwd: step.cwd })
					} catch (error) {
						if (!step.optional) {
							throw error
						}
						log(`Optional install step "${step.command}" failed: ${error}`)
						window.showWarningMessage(
							`V was built successfully, but the automatic symlink failed (likely due to permissions). Please run '${plan.executable} symlink' manually with administrator/sudo rights.`,
							"OK",
						)
						return
					}
				}

				window.showInformationMessage(
					"V language installed and linked successfully! Please restart VS Code to use the `v` command.",
				)
			} catch (error) {
				log(`Failed to install V: ${error}`)
				window.showErrorMessage(
					`Failed to install V. Check the logs for details. If ${plan.repoDir} already exists, remove it and try again.`,
				)
			}
		},
	)
}
