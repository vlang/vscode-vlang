import * as path from "path"
import {
	commands,
	env,
	ExtensionContext,
	Range,
	TextDocument,
	Uri,
	window,
	workspace,
	WorkspaceEdit,
} from "vscode"
import { executeV } from "./exec"
import { outputChannel, vlsOutputChannel } from "./logger"

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
	try {
		const version = document.version
		const content = document.getText()
		if (document.fileName.includes("_vfmt_off")) return true
		// stdin keeps the buffer unsaved while resolving imports from its original directory.
		// Preserve the formatter's opt-out from JSON migration for .vv fixtures.
		const args = document.fileName.endsWith(".vv") ? ["fmt", "-no-migrate-json2"] : ["fmt"]
		const formatted = await executeV(args, document.uri, {
			input: content,
			cwd: path.dirname(document.fileName),
		})
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
	}
}

export async function ver(): Promise<string | undefined> {
	try {
		const version = (await executeV(["version"])).trim()
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

async function updateVls(): Promise<void> {
	// Managed installation lives in the tool manager, which this activation
	// does not construct. Point at the releases instead of failing silently.
	const action = await window.showInformationMessage(
		"Update VLS by installing the latest build, then set v.vls.command.",
		"Open VLS releases",
	)
	if (action === "Open VLS releases") {
		await env.openExternal(Uri.parse("https://github.com/vlang/vls/releases"))
	}
}

/** Register the VLS lifecycle commands for a client owned elsewhere. */
export function registerVlsCommands(context: ExtensionContext, restart: () => Promise<void>): void {
	context.subscriptions.push(
		commands.registerCommand("v.vls.restart", () => restart()),
		commands.registerCommand("v.vls.update", () => updateVls()),
		commands.registerCommand("v.vls.openOutput", () => {
			vlsOutputChannel.show()
		}),
	)
}
