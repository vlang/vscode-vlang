import { execFile } from "child_process"
import * as path from "path"
import { promisify } from "util"
import { Uri, window, workspace } from "vscode"
import { effectiveToolSetting } from "./managedTools"
import { processLaunchCommand } from "./processExecution"
import { migratedSetting } from "./settings"
import { resolvedCommand } from "./vCommand"

const executeFile = promisify(execFile)

interface VExecutionOptions {
	input?: string
	cwd?: string
}

/** Execute the configured compiler without interpolating source paths into a shell. */
export async function executeV(
	args: string[],
	resource?: Uri,
	options: VExecutionOptions = {},
): Promise<string> {
	const uri = resource ?? window.activeTextEditor?.document.uri
	const folder = uri ? workspace.getWorkspaceFolder(uri) : workspace.workspaceFolders?.[0]
	const setting = migratedSetting("v", "executablePath", "vls", "vCommand", "v", folder?.uri)
	const command = resolvedCommand(effectiveToolSetting("v", setting), folder?.uri.fsPath)
	if (!command) throw new Error(`V compiler not found: ${setting}. Set v.executablePath.`)
	const launch = processLaunchCommand(command, args)
	const execution = executeFile(launch.command, launch.args, {
		cwd:
			options.cwd ??
			folder?.uri.fsPath ??
			(uri?.scheme === "file" ? path.dirname(uri.fsPath) : undefined),
		windowsVerbatimArguments: launch.windowsVerbatimArguments,
		timeout: 30_000,
		maxBuffer: 4 * 1024 * 1024,
	})
	// A formatter can reject input before consuming it. Its exit status reports the error.
	execution.child.stdin?.on("error", () => undefined)
	execution.child.stdin?.end(options.input)
	const result = await execution
	return result.stdout
}
