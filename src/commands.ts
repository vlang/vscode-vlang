import { execFile } from "child_process"
import * as path from "path"
import vscode, {
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
import {
	c2vExecutable,
	c2vNotInstalledMessage,
	cOutputFileName,
	isCFileName,
	vOutputFileName,
} from "./cInterop"
import { executeV } from "./exec"
import { outputChannel, vlsOutputChannel } from "./logger"
import {
	documentFormats,
	renderModule,
	rootNameForFile,
	schemaFromCsv,
	schemaFromJson,
	schemaFromXml,
} from "./decodeStruct"
import { hoverTextFor, literalAtOffset } from "./numberHover"
import {
	decodeBase32,
	decodeBase58,
	decodeBase64,
	decodeHex,
	encodeBase32,
	encodeBase58,
	encodeBase64,
	encodeHex,
} from "./convert"
import { removeDuplicateImports, removeUnusedImports, sortImports } from "./importsCleanup"
import { parseInstalledList, parseModuleInfo, parseSearchList, vpmArgs } from "./vpm"
import { sharePlaygroundCode } from "./playground"
import { sourceFileName, testFileName } from "./testSkeleton"
import { processLaunchCommand } from "./processExecution"

function activeVDocument(): TextDocument | undefined {
	const document = window.activeTextEditor?.document
	return document?.uri.scheme === "file" && document.languageId === "v" ? document : undefined
}

function activeCDocument(): TextDocument | undefined {
	const document = window.activeTextEditor?.document
	return document?.uri.scheme === "file" && isCFileName(document.fileName) ? document : undefined
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

/** Open the other half of the `foo.v` / `foo_test.v` pair.
 *
 * Creating a test file walked the pairing in one direction only, so a test file
 * had no way back to the source it tests.
 */
export async function toggleTestFile(): Promise<void> {
	const document = activeVDocument()
	if (!document) {
		void window.showErrorMessage("No active V file to toggle a test file for.")
		return
	}
	const target = sourceFileName(document.fileName) ?? testFileName(document.fileName)
	const targetUri = Uri.file(target)
	const exists = await workspace.fs.stat(targetUri).then(
		() => true,
		() => false,
	)
	if (!exists) {
		void window.showErrorMessage(`Could not find ${target}.`)
		return
	}
	// Not a preview: the next toggle must replace neither this tab nor the one
	// it came from.
	await window.showTextDocument(targetUri, { preview: false })
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

/** Translate the active V document to a sibling `.c` file.
 *
 * `-o -` puts the C on stdout, so the buffer is translated without being saved.
 * This is the same stdin path `fmt` uses, and the working directory is still the
 * document's own, which is what resolves its imports.
 */
export async function generateCOutput(): Promise<void> {
	const document = activeVDocument()
	if (!document) {
		void window.showErrorMessage("No active V file to translate to C.")
		return
	}
	try {
		const version = document.version
		const generated = await executeV(["-o", "-"], document.uri, {
			input: document.getText(),
			cwd: path.dirname(document.fileName),
		})
		if (document.isClosed || document.version !== version) {
			void window.showWarningMessage(
				"V: The document changed while translating. Run Generate C Output again.",
			)
			return
		}
		if (generated.length === 0) {
			void window.showErrorMessage(
				"V produced no C for this file. See the V output channel for details.",
			)
			return
		}
		const targetUri = Uri.file(cOutputFileName(document.fileName))
		await workspace.fs.writeFile(targetUri, Buffer.from(generated, "utf8"))
		const lines = generated.split("\n").length
		const targetName = path.basename(targetUri.fsPath)
		outputChannel.info(`${targetUri.fsPath}: ${generated.length} bytes, ${lines} lines`)
		void window.showInformationMessage(
			`V: Wrote ${targetName} (${lines} lines, ${generated.length} bytes).`,
		)
		await window.showTextDocument(targetUri, { preview: true })
	} catch (error) {
		outputChannel.error(String(error))
		void window.showErrorMessage(`V C output failed: ${String(error)}`)
	}
}

/** Translate the active C file to a sibling `.v` file with c2v.
 *
 * c2v is not part of the V compiler and `v install` leaves it unbuilt, so the
 * machine is checked first rather than shelling out blindly. Unlike the V path
 * there is no stdin form: c2v is given a file path, so the document is saved or
 * the on-disk copy would be translated instead of what the user is looking at.
 */
export async function translateWithC2v(): Promise<void> {
	const document = activeCDocument()
	if (!document) {
		void window.showErrorMessage("No active C file to translate to V.")
		return
	}
	const binary = c2vExecutable()
	if (!binary) {
		void window.showErrorMessage(c2vNotInstalledMessage)
		return
	}
	try {
		await document.save()
		const targetUri = Uri.file(vOutputFileName(document.fileName))
		const launch = processLaunchCommand(binary, [document.fileName])
		await new Promise<void>((resolve, reject) => {
			execFile(
				launch.command,
				launch.args,
				{ cwd: path.dirname(document.fileName), maxBuffer: 4 * 1024 * 1024 },
				(error) => (error ? reject(new Error(error.message, { cause: error })) : resolve()),
			)
		})
		const written = await workspace.fs.stat(targetUri).then(
			() => true,
			() => false,
		)
		if (!written) {
			void window.showWarningMessage(
				`c2v wrote no ${path.basename(targetUri.fsPath)}. See the V output channel for details; ` +
					"a c2v.toml can redirect the output directory.",
			)
			return
		}
		await window.showTextDocument(targetUri, { preview: true })
	} catch (error) {
		outputChannel.error(String(error))
		void window.showErrorMessage(`c2v translation failed: ${String(error)}`)
	}
}

export function registerCommands(context: ExtensionContext): void {
	context.subscriptions.push(
		commands.registerCommand("v.run", run),
		commands.registerCommand("v.fmt", fmt),
		commands.registerCommand("v.toggleTestFile", toggleTestFile),
		commands.registerCommand("v.ver", ver),
		commands.registerCommand("v.generateJsonDecoder", generateJsonDecoder),
		commands.registerCommand("v.generateXmlDecoder", generateXmlDecoder),
		commands.registerCommand("v.generateCsvDecoder", generateCsvDecoder),
		commands.registerCommand("v.convertEncoding", convertEncoding),
		commands.registerCommand("v.vpmSearch", vpmSearch),
		commands.registerCommand("v.vpmList", vpmList),
		commands.registerCommand("v.organizeImports", organizeImports),
		commands.registerCommand("v.generateCOutput", generateCOutput),
		commands.registerCommand("v.translateWithC2v", translateWithC2v),
	)
}

/** Sort, dedupe and prune unused imports in the active V file.
 *
 * `v fmt` does not sort imports, so this owns ordering; removal only
 * drops names provably unused, bailing on selective or aliased imports.
 */
export async function organizeImports(): Promise<void> {
	const document = activeVDocument()
	if (!document) {
		void window.showErrorMessage("No active V file to organize imports in.")
		return
	}
	const text = document.getText()
	const cleaned = sortImports(removeUnusedImports(removeDuplicateImports(text)))
	if (cleaned === text) {
		void window.showInformationMessage("V imports are already organized.")
		return
	}
	const edit = new WorkspaceEdit()
	edit.replace(
		document.uri,
		new Range(document.positionAt(0), document.positionAt(text.length)),
		cleaned,
	)
	await workspace.applyEdit(edit)
}

/** Register the VLS lifecycle commands for a client owned elsewhere. */
export function registerVlsCommands(context: ExtensionContext, restart: () => Promise<void>): void {
	context.subscriptions.push(
		commands.registerCommand("v.vls.restart", () => restart()),
		commands.registerCommand("v.vls.openOutput", () => {
			vlsOutputChannel.show()
		}),
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
	let content: string
	try {
		const schema = schemaFromJson(rootNameForFile(document.fileName), document.getText())
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

/** Generate decoder structs for the active XML document.
 *
 * The strict reader rejects what it cannot represent faithfully
 * instead of guessing. There is no struct decoder in vlib, so the
 * example loads the document for the query API.
 */
export async function generateXmlDecoder(): Promise<void> {
	const document = vscode.window.activeTextEditor?.document
	if (!document || document.languageId !== "xml") {
		void vscode.window.showErrorMessage("Open an XML file to generate a decoder from.")
		return
	}
	let content: string
	try {
		const schema = schemaFromXml(rootNameForFile(document.fileName), document.getText())
		content = renderModule(documentFormats.xml, schema)
	} catch (error) {
		void vscode.window.showErrorMessage(
			error instanceof Error ? error.message : `Could not infer structs: ${String(error)}`,
		)
		return
	}
	const generated = await vscode.workspace.openTextDocument({ language: "v", content })
	await vscode.window.showTextDocument(generated, { preview: false })
}

/** Generate decoder structs for the active CSV document. */
export async function generateCsvDecoder(): Promise<void> {
	const document = vscode.window.activeTextEditor?.document
	if (!document || !document.fileName.toLowerCase().endsWith(".csv")) {
		void vscode.window.showErrorMessage("Open a CSV file to generate a decoder from.")
		return
	}
	let content: string
	try {
		const schema = schemaFromCsv(rootNameForFile(document.fileName), document.getText())
		content = renderModule(documentFormats.csv, schema)
	} catch (error) {
		void vscode.window.showErrorMessage(
			error instanceof Error ? error.message : `Could not infer structs: ${String(error)}`,
		)
		return
	}
	const generated = await vscode.workspace.openTextDocument({ language: "v", content })
	await vscode.window.showTextDocument(generated, { preview: false })
}

interface EncodingConversion {
	label: string
	toBytes: (text: string) => Uint8Array
	fromBytes: (bytes: Uint8Array) => string
}

const encodingConversions: EncodingConversion[] = [
	{
		label: "Base64 decode to text",
		toBytes: decodeBase64,
		fromBytes: (bytes) => new TextDecoder().decode(bytes),
	},
	{
		label: "Text encode to Base64",
		toBytes: (text) => new TextEncoder().encode(text),
		fromBytes: encodeBase64,
	},
	{
		label: "Hex decode to text",
		toBytes: decodeHex,
		fromBytes: (bytes) => new TextDecoder().decode(bytes),
	},
	{
		label: "Text encode to Hex",
		toBytes: (text) => new TextEncoder().encode(text),
		fromBytes: encodeHex,
	},
	{
		label: "Base32 decode to text",
		toBytes: decodeBase32,
		fromBytes: (bytes) => new TextDecoder().decode(bytes),
	},
	{
		label: "Text encode to Base32",
		toBytes: (text) => new TextEncoder().encode(text),
		fromBytes: encodeBase32,
	},
	{
		label: "Base58 decode to text",
		toBytes: decodeBase58,
		fromBytes: (bytes) => new TextDecoder().decode(bytes),
	},
	{
		label: "Text encode to Base58",
		toBytes: (text) => new TextEncoder().encode(text),
		fromBytes: encodeBase58,
	},
]

/** Convert the selection between text and base encodings, in place. */
export async function convertEncoding(): Promise<void> {
	const editor = vscode.window.activeTextEditor
	const selection = editor?.selection
	if (!editor || !selection || selection.isEmpty) {
		void vscode.window.showErrorMessage("Select the text to convert first.")
		return
	}
	const picked = await vscode.window.showQuickPick(
		encodingConversions.map((conversion) => conversion.label),
		{ placeHolder: "Convert the selection" },
	)
	if (!picked) {
		return
	}
	const conversion = encodingConversions.find((entry) => entry.label === picked)
	if (!conversion) {
		return
	}
	const input = editor.document.getText(selection)
	let output: string
	try {
		output = conversion.fromBytes(conversion.toBytes(input))
	} catch (error) {
		void vscode.window.showErrorMessage(
			error instanceof Error ? error.message : `Could not convert: ${String(error)}`,
		)
		return
	}
	const edit = new vscode.WorkspaceEdit()
	edit.replace(editor.document.uri, selection, output)
	await vscode.workspace.applyEdit(edit)
}

/** Search VPM modules and show the picked one. */
export async function vpmSearch(): Promise<void> {
	const keyword = await vscode.window.showInputBox({
		prompt: "Search VPM modules",
		placeHolder: "vls",
	})
	if (!keyword || keyword.trim() === "") {
		return
	}
	let output: string
	try {
		output = await executeV(vpmArgs("search", keyword))
	} catch (error) {
		void vscode.window.showErrorMessage(`VPM search failed: ${String(error)}`)
		return
	}
	const entries = parseSearchList(output)
	if (entries.length === 0) {
		void vscode.window.showInformationMessage(`No VPM modules found for "${keyword}".`)
		return
	}
	const picked = await vscode.window.showQuickPick(
		entries.map((entry) => ({
			label: entry.name,
			description: entry.description,
		})),
		{ placeHolder: "Pick a module to inspect" },
	)
	if (!picked) {
		return
	}
	await vpmShow(picked.label)
}

/** Show an installed-or-remote module's VPM info in a document. */
async function vpmShow(module: string): Promise<void> {
	let output: string
	try {
		output = await executeV(vpmArgs("show", module))
	} catch (error) {
		void vscode.window.showErrorMessage(`VPM show failed: ${String(error)}`)
		return
	}
	const info = parseModuleInfo(output)
	const lines = [`# ${info.name || module}`, ""]
	for (const key of Object.keys(info.details)) {
		lines.push(`- ${key}: ${info.details[key]}`)
	}
	const document = await vscode.workspace.openTextDocument({
		language: "markdown",
		content: `${lines.join("\n")}\n`,
	})
	await vscode.window.showTextDocument(document, { preview: false })
}

/** Pick an installed VPM module and show its info. */
export async function vpmList(): Promise<void> {
	let output: string
	try {
		output = await executeV(vpmArgs("list"))
	} catch (error) {
		void vscode.window.showErrorMessage(`VPM list failed: ${String(error)}`)
		return
	}
	const modules = parseInstalledList(output)
	if (modules.length === 0) {
		void vscode.window.showInformationMessage("No VPM modules installed.")
		return
	}
	const picked = await vscode.window.showQuickPick(modules, {
		placeHolder: "Pick an installed module to inspect",
	})
	if (!picked) {
		return
	}
	await vpmShow(picked)
}

/** Hover decimal values over non-decimal literals. */
export function registerNumberHover(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.languages.registerHoverProvider([{ language: "v" }, { language: "v.mod" }], {
			provideHover(document, position) {
				const line = document.lineAt(position.line).text
				const literal = literalAtOffset(line, position.character)
				if (!literal) {
					return undefined
				}
				return new vscode.Hover(
					hoverTextFor(literal),
					new vscode.Range(position.line, literal.start, position.line, literal.end),
				)
			},
		}),
	)
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
