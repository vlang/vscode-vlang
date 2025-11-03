import { exec as _exec } from "child_process"
import { promisify } from "util"
import { Terminal, window } from "vscode"
import { config } from "./utils"

let vRunTerm: Terminal | null = null

const exec = promisify(_exec)

// Get V executable command.
export function getVExecCommand(): string {
	return config().get<string>("executablePath") //default is v
}

export function execVInTerminal(args: string[]): void {
	const vexec = getVExecCommand()
	const cmd = `${vexec} ${args.join(" ")}`

	if (!vRunTerm) vRunTerm = window.createTerminal("V")

	vRunTerm.show()
	vRunTerm.sendText(cmd)
}

export async function execVInTerminalOnBG(args: string[], cwd = "/"): Promise<void> {
	const vexec = getVExecCommand()
	const cmd = `${vexec} ${args.join(" ")}`

	try {
		await exec(cmd, { cwd })
	} catch (error) {
		console.error("Error executing command:", error)
	}
}
