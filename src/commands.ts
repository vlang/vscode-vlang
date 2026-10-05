import { getVls } from "langserver"
import { vlsOutputChannel } from "logger"
import { commands, ExtensionContext, window } from "vscode"
import type { LanguageClient } from "vscode-languageclient/node"
import { execVInTerminal, execVInTerminalOnBG } from "./exec"

/** Run the active V module or script through the same task as `V: Run`. */
export async function run(): Promise<void> {
	const document = window.activeTextEditor?.document
	if (
		!document ||
		document.uri.scheme !== "file" ||
		(document.languageId !== "v" && !document.fileName.endsWith(".vsh"))
	) {
		void window.showErrorMessage("No active V file to run.")
		return
	}

	await commands.executeCommand("vls.run")
}

/** Format the currently active V file in-place using `v fmt -w`. */
export async function fmt(): Promise<void> {
	const document = window.activeTextEditor?.document
	if (!document) {
		void window.showErrorMessage("No active V file to format.")
		return
	}

	await document.save()
	await execVInTerminalOnBG(["fmt", "-w", document.fileName])
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

/** Report how to update VLS.
 *
 * There is no update mechanism the extension can rely on: VLS is a separate
 * binary the user builds or installs themselves. This used to stop and start the
 * client and then report "VLS has been restarted after update", which described
 * a restart as an update. It now says what is actually true.
 */
export async function updateVls(): Promise<void> {
	let location: string
	try {
		location = getVls()
	} catch {
		location = "not found on PATH"
	}
	await window.showInformationMessage(
		`VLS (${location}) is not updated automatically. Rebuild it from https://github.com/vlang/vls and make sure "vls" is on PATH, or set "v.vls.command".`,
		"OK",
	)
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
	getClient: () => LanguageClient | undefined,
): void {
	context.subscriptions.push(
		commands.registerCommand("v.vls.update", () => updateVls()),
		commands.registerCommand("v.vls.restart", () => restartVls(getClient())),
		commands.registerCommand("v.vls.openOutput", () => {
			vlsOutputChannel.show()
		}),
	)
}
