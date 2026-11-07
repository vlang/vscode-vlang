import * as vscode from "vscode"
import { executeV } from "./exec"

/** Whether the server should answer a formatting request instead of this provider.
 *
 * The language server answers `textDocument/documentFormatting` with the same
 * `v fmt` this provider shells out to, so registering both would be two paths to
 * the same answer. The server wins while it is up, because it is already in
 * memory; this provider exists for when it is not — the case a user hits when
 * VLS will not start at all and formatting is the one thing they still want.
 */
export function serverShouldFormat(isRunning: boolean): boolean {
	return isRunning
}

/** Format a V document with the configured compiler, over stdio.
 *
 * `v fmt -` reads the buffer on stdin and writes the formatted source on stdout,
 * so no temporary file is created and no path is interpolated into a shell. The
 * compiler is resolved the same way tasks and commands resolve it, so a user who
 * set `v.executablePath` gets that compiler here.
 *
 * Deferring to the language server returns **nothing at all**, not an empty list:
 * VS Code takes the first provider that answers with an array, so an empty list
 * would answer before the server got its turn.
 */
export class VDocumentFormattingProvider implements vscode.DocumentFormattingEditProvider {
	public async provideDocumentFormattingEdits(
		document: vscode.TextDocument,
	): Promise<vscode.TextEdit[] | undefined> {
		if (serverShouldFormat(this.isServerRunning())) {
			return undefined
		}

		const source = document.getText()
		let formatted: string
		try {
			formatted = await executeV(["fmt", "-"], document.uri, { input: source })
		} catch (error) {
			// A formatter rejects source it cannot parse, and its exit status is how it
			// says so. Nothing can be offered then, and the compiler's own message —
			// including the one it gives for a missing executable — is the useful one.
			void vscode.window.showErrorMessage(
				`V: could not format ${vscode.workspace.asRelativePath(document.uri)}. ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
			return []
		}
		if (formatted === source) {
			return []
		}
		return [
			vscode.TextEdit.replace(
				new vscode.Range(document.positionAt(0), document.positionAt(source.length)),
				formatted,
			),
		]
	}

	constructor(private readonly isServerRunning: () => boolean) {}
}

/** Register the formatting provider for V documents.
 *
 * The server check is injected rather than read here, so the provider can be
 * exercised without a live editor or a running server.
 */
export function registerDocumentFormatting(
	context: vscode.ExtensionContext,
	isServerRunning: () => boolean,
): void {
	context.subscriptions.push(
		vscode.languages.registerDocumentFormattingEditProvider(
			{ scheme: "file", language: "v" },
			new VDocumentFormattingProvider(isServerRunning),
		),
	)
}
