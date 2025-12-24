import * as vscode from "vscode"

export class VDocumentFormatProvider implements vscode.DocumentFormattingEditProvider {
	public provideDocumentFormattingEdits(): vscode.ProviderResult<vscode.TextEdit[]> {
		// Run custom V command to format the current active document ( commands.ts -> fmt() )
		vscode.commands.executeCommand("vscode-vlang.fmt")

		// Return empty edits as the formatting is handled externally
		return []
	}
}
