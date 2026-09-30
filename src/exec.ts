import { execFile } from "child_process"
import * as path from "path"
import { promisify } from "util"
import { Uri, window, workspace } from "vscode"
import { processLaunchCommand } from "./processExecution"
import { migratedSetting } from "./settings"
import { resolvedCommand } from "./vCommand"

const executeFile = promisify(execFile)

/** Execute the configured compiler without interpolating source paths into a shell. */
export async function executeV(args: string[], resource?: Uri): Promise<string> {
	const uri = resource ?? window.activeTextEditor?.document.uri
	const folder =
		(uri ? workspace.getWorkspaceFolder(uri) : undefined) ?? workspace.workspaceFolders?.[0]
	const setting = migratedSetting("v", "executablePath", "vls", "vCommand", "v", folder?.uri)
	const command = resolvedCommand(setting, folder?.uri.fsPath)
	if (!command) throw new Error(`V compiler not found: ${setting}. Set v.executablePath.`)
	const launch = processLaunchCommand(command, args)
	const result = await executeFile(launch.command, launch.args, {
		cwd: folder?.uri.fsPath ?? (uri?.scheme === "file" ? path.dirname(uri.fsPath) : undefined),
		windowsVerbatimArguments: launch.windowsVerbatimArguments,
		timeout: 30_000,
		maxBuffer: 4 * 1024 * 1024,
	})
	return result.stdout.trim()
}
