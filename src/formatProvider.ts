import * as vscode from "vscode"
import { execSync, ExecSyncOptionsWithStringEncoding } from "child_process"
//import * as path from "path"

export class VDocumentFormattingProvider implements vscode.DocumentFormattingEditProvider {
	public provideDocumentFormattingEdits(
		document: vscode.TextDocument,
	): vscode.ProviderResult<vscode.TextEdit[]> {
		// Use the absolute, known-working path for the V compiler
		const vExecutablePath = "/home/tshimo/v/v" // <--- ABSOLUTE PATH

		// Command: v fmt -
		const commandToRun = `"${vExecutablePath}" fmt -`

		const execOptions: ExecSyncOptionsWithStringEncoding = {
			input: document.getText(),
			encoding: "utf8",
			timeout: 5000,
			// Set CWD to V's source directory to help it find internal tools (Vfmt)
			cwd: "/home/tshimo/v",
		}

		try {
			console.log(`[V Formatter] Running command: ${commandToRun}`)

			const buffer = execSync(commandToRun, execOptions)

			const fullRange = new vscode.Range(
				document.lineAt(0).range.start,
				document.lineAt(document.lineCount - 1).range.end,
			)

			// Return the formatted text to VS Code
			return [vscode.TextEdit.replace(fullRange, buffer)]
		} catch (error) {
			if (error instanceof Error) {
				const childProcessError = error as {
					code?: string
					stderr?: Buffer | string
					path?: string
				}

				let errorMessage = "V Formatter failed: Check Debug Console."

				if (childProcessError.stderr) {
					const stderrOutput = childProcessError.stderr.toString()
					console.error("[V Formatter] V Execution Error (stderr):", stderrOutput)
					errorMessage = `V Formatter failed. Output: ${stderrOutput.substring(0, 80)}...`
				} else if (childProcessError.code) {
					console.error(
						"[V Formatter] Error Code/Path:",
						childProcessError.code,
						childProcessError.path,
					)
					errorMessage = `V Formatter failed. Code: ${childProcessError.code}.`
				}

				vscode.window.showErrorMessage(errorMessage)
			}
			return []
		}
	}
}
