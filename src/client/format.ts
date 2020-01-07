import * as vscode from 'vscode';
import { ExecException } from 'child_process';
import { execV } from './exec';
import { fullDocumentRange } from './utils';

function format(document: vscode.TextDocument): Promise<vscode.TextEdit[]> {
	return new Promise((resolve, reject) => {
		const vfmtArgs = vscode.workspace.getConfiguration('v.format').get('args', '');
		const args = `fmt ${vfmtArgs} ${document.fileName}`;

		// Create new `callback` function for
		function callback(error: ExecException, stdout: string, stderr: string) {
			const isErr = error !== null;
			if (isErr) {
				const errMessage = `Cannot format due to the following errors: ${stderr}`;
				vscode.window.showErrorMessage(errMessage);
				return reject(errMessage);
			}
			return resolve([
				vscode.TextEdit.replace(fullDocumentRange(document), stdout)
			]);
		}

		execV(args, callback);
	});
}

export function registerFormatter() {
	const provider: vscode.DocumentFormattingEditProvider = {
		provideDocumentFormattingEdits(
			document: vscode.TextDocument
		): Thenable<vscode.TextEdit[]> {
			return document.save().then(() => format(document));
		}
	};
	vscode.languages.registerDocumentFormattingEditProvider('v', provider);
}
