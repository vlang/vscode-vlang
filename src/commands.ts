import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import {
	commands,
	ExtensionContext,
	Range,
	TextDocument,
	window,
	workspace,
	WorkspaceEdit,
} from "vscode"
import { executeV } from "./exec"
import { outputChannel } from "./logger"

function activeVDocument(): TextDocument | undefined {
	const document = window.activeTextEditor?.document
	return document?.uri.scheme === "file" && document.languageId === "v" ? document : undefined
}

/** Kept as an alias for existing keybindings. */
export async function run(): Promise<void> {
	if (!activeVDocument()) {
		void window.showErrorMessage("No active V file to run.")
		return
	}
	await commands.executeCommand("vls.run")
}

/** Format a snapshot, then apply an undoable edit without saving or overwriting newer text. */
export async function fmt(): Promise<boolean> {
	const document = activeVDocument()
	if (!document) {
		void window.showErrorMessage("No active V file to format.")
		return false
	}
	let directory: string | undefined
	try {
		const version = document.version
		const content = document.getText()
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "vscode-v-fmt-"))
		// V headers contain V syntax, but v fmt rejects the .vh extension.
		const name = document.fileName.endsWith(".vh")
			? "header.v"
			: path.basename(document.fileName)
		const temporaryFile = path.join(directory, name)
		await fs.writeFile(temporaryFile, content)
		await executeV(["fmt", "-w", temporaryFile], document.uri)
		const formatted = await fs.readFile(temporaryFile, "utf8")
		if (document.isClosed || document.version !== version) {
			void window.showWarningMessage(
				"V: The document changed while formatting. Run Format again.",
			)
			return false
		}
		if (formatted === content) return true
		const edit = new WorkspaceEdit()
		edit.replace(
			document.uri,
			new Range(document.positionAt(0), document.positionAt(content.length)),
			formatted,
		)
		return await workspace.applyEdit(edit)
	} catch (error) {
		outputChannel.error(String(error))
		void window.showErrorMessage(`V format failed: ${String(error)}`)
		return false
	} finally {
		if (directory) await fs.rm(directory, { recursive: true, force: true })
	}
}

export async function ver(): Promise<string | undefined> {
	try {
		const version = await executeV(["version"])
		outputChannel.info(version)
		void window.showInformationMessage(version)
		return version
	} catch (error) {
		outputChannel.error(String(error))
		void window.showErrorMessage(`Failed to get V version: ${String(error)}`)
		return undefined
	}
}

export function registerCommands(context: ExtensionContext): void {
	context.subscriptions.push(
		commands.registerCommand("v.run", run),
		commands.registerCommand("v.fmt", fmt),
		commands.registerCommand("v.ver", ver),
	)
}
