import { window } from "vscode"

export const outputChannel = window.createOutputChannel("V", { log: true })
export const vlsOutputChannel = window.createOutputChannel("V Language Server", { log: true })

/** Write a line to the V output channel. */
export function log(message: string): void {
	outputChannel.info(message)
}
