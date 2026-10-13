import { execFile } from "child_process"
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
import {
	c2vExecutable,
	c2vNotInstalledMessage,
	cOutputFileName,
	isCFileName,
	vOutputFileName,
} from "./cInterop"
import { executeV } from "./exec"
import { outputChannel, vlsOutputChannel } from "./logger"
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
		commands.registerCommand("v.ver", ver),
		commands.registerCommand("v.generateCOutput", generateCOutput),
		commands.registerCommand("v.translateWithC2v", translateWithC2v),
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
