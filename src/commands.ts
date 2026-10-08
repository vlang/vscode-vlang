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
import { documentFormats, renderModule, rootNameForFile, structsFromValue } from "./decodeStruct"
import { sharePlaygroundCode } from "./playground"

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
		commands.registerCommand("v.generateJsonDecoder", generateJsonDecoder),
	)
}

/** Generate decoder structs for the active JSON document.
 *
 * Parses with the builtin JSON reader (no dependency), infers structs,
 * and opens the result as an untitled V file. TOML and YAML share the
 * core but need parser dependencies first.
 */
export async function generateJsonDecoder(): Promise<void> {
	const document = vscode.window.activeTextEditor?.document
	if (!document || document.languageId !== "json") {
		void vscode.window.showErrorMessage("Open a JSON file to generate a decoder from.")
		return
	}
	let value: unknown
	try {
		value = JSON.parse(document.getText())
	} catch {
		void vscode.window.showErrorMessage("The file is not valid JSON.")
		return
	}
	let content: string
	try {
		const schema = structsFromValue(
			rootNameForFile(document.fileName),
			value,
			documentFormats.json.anyType,
		)
		content = renderModule(documentFormats.json, schema)
	} catch (error) {
		void vscode.window.showErrorMessage(
			error instanceof Error ? error.message : `Could not infer structs: ${String(error)}`,
		)
		return
	}
	const generated = await vscode.workspace.openTextDocument({ language: "v", content })
	await vscode.window.showTextDocument(generated, { preview: false })
}

/** Share the active file on the V playground.
 *
 * The link is copied to the clipboard and offered to open, mirroring
 * the playground's own share flow.
 */
export async function sharePlayground(): Promise<void> {
	const document = activeVDocument()
	if (!document) {
		void window.showErrorMessage("No active V file to share.")
		return
	}
	let link: string
	try {
		link = await sharePlaygroundCode(document.getText())
	} catch (error) {
		void window.showErrorMessage(
			error instanceof Error
				? error.message
				: `Could not share on the playground: ${String(error)}`,
		)
		return
	}
	await env.clipboard.writeText(link)
	const action = await window.showInformationMessage(`Playground link copied: ${link}`, "Open")
	if (action === "Open") {
		await env.openExternal(Uri.parse(link))
	}
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

