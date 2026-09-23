import { execFile as _execFile } from "child_process"
import { promisify } from "util"
import { Terminal, window, workspace } from "vscode"
import { migratedSetting } from "./settings"
import { configuredCommand, resolvedCommand } from "./vCommand"

let vRunTerm: Terminal | null = null

const execFile = promisify(_execFile)

// Get V executable command.
export function getVExecCommand(): string {
	const folder = window.activeTextEditor
		? workspace.getWorkspaceFolder(window.activeTextEditor.document.uri)
		: workspace.workspaceFolders?.[0]
	const setting = migratedSetting("v", "executablePath", "vls", "vCommand", "v", folder?.uri)
	return resolvedCommand(setting, folder?.uri.fsPath) ?? configuredCommand(setting, folder?.uri.fsPath)
}

function terminalCommand(value: string): string {
	if (process.platform === "win32") return `"${value.replace(/"/g, "\\\"")}"`
	return `'${value.replace(/'/g, "'\"'\"'")}'`
}

export function execVInTerminal(args: string[]): void {
	const vexec = getVExecCommand()
	const cmd = `${terminalCommand(vexec)} ${args.join(" ")}`

	if (!vRunTerm) vRunTerm = window.createTerminal("V")

	vRunTerm.show()
	vRunTerm.sendText(cmd)
}

export async function execVInTerminalOnBG(args: string[], cwd = "/"): Promise<void> {
	const vexec = getVExecCommand()
	await execFile(vexec, args, { cwd })
}
