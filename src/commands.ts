import { vlsOutputChannel } from "logger"
import { commands, ExtensionContext, window } from "vscode"
import type { LanguageClient } from "vscode-languageclient/node"
import { execVInTerminal, execVInTerminalOnBG } from "./exec"

/** Run the currently active V file using `v run`. */
export async function run(): Promise<void> {
	const document = window.activeTextEditor?.document
	if (!document) {
		void window.showErrorMessage("No active V file to run.")
		return
	}

	await document.save()
	const filePath = `"${document.fileName}"`
	execVInTerminal(["run", filePath])
}

/** Format the currently active V file in-place using `v fmt -w`. */
export async function fmt(): Promise<void> {
	const document = window.activeTextEditor?.document
	if (!document) {
		void window.showErrorMessage("No active V file to format.")
		return
	}

	await document.save()
	const filePath = `"${document.fileName}"`
	await execVInTerminalOnBG(["fmt", "-w", filePath])
}

/** Build an optimized executable from the current file using `v -prod`. */
export async function prod(): Promise<void> {
	const document = window.activeTextEditor?.document
	if (!document) {
		void window.showErrorMessage("No active V file to build.")
		return
	}

	await document.save()
	const filePath = `"${document.fileName}"`
	execVInTerminal(["-prod", filePath])
}

/** Show version information of the configured `v` executable. */
export function ver(): void {
	execVInTerminalOnBG(["-version"]).catch((err) => {
		void window.showErrorMessage(`Failed to get V version: ${err}. Is V installed correctly?`)
	})
}

export async function updateVls(client?: LanguageClient): Promise<void> {
	// For now, show an informational message. If we had an update mechanism
	// (download/install), it would be invoked here and possibly restart the client.
	void window.showInformationMessage("Update VLS: not implemented.")
	// If a client is provided, optionally restart to pick up a new binary.
	if (client) {
		try {
			await client.stop()
			await client.start()
			void window.showInformationMessage("VLS has been restarted after update.")
		} catch {
			// ignore error details for now
			void window.showErrorMessage("Failed to restart VLS after update.")
		}
	}
}

export async function restartVls(cli?: LanguageClient): Promise<void> {
	if (!cli) {
		void window.showErrorMessage("VLS client is not running.")
		return
	}

	try {
		await cli.restart()
		void window.showInformationMessage("VLS restarted successfully.")
	} catch {
		void window.showErrorMessage("Failed to restart VLS.")
	}
}

export function registerCommands(context: ExtensionContext): Promise<void> {
	context.subscriptions.push(
		commands.registerCommand("v.run", run),
		commands.registerCommand("v.fmt", fmt),
		commands.registerCommand("v.ver", ver),
		commands.registerCommand("v.prod", prod),
	)
	return Promise.resolve()
}

export function registerVlsCommands(
	context: ExtensionContext,
	getClient?: () => LanguageClient | undefined,
): void {
	context.subscriptions.push(
		commands.registerCommand("v.vls.update", () => updateVls(getClient?.())),
		commands.registerCommand("v.vls.restart", () => restartVls(getClient?.())),
		commands.registerCommand("v.vls.openOutput", () => {
			vlsOutputChannel.show()
		}),
	)
}
