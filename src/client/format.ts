import * as vscode from 'vscode';
import * as childProcess from 'child_process';
import { fullDocumentRange } from './utils';

function format(document: vscode.TextDocument): Promise<vscode.TextEdit[]> {
	return new Promise((resolve, reject) => {
		// Create `vfmt` command with entered arguments.
		const vfmtArgs: string =
			vscode.workspace.getConfiguration('v.format').get('args') || '';
		const cmd = `v fmt ${vfmtArgs} ${document.fileName}`;

		// Create new `callback` function for 
		function callback(
			error: childProcess.ExecException,
			stdout: string,
			stderr: string
		) {
			const isErr = error !== null;
			if (isErr) {
				const errMessage = `Cannot format due to the following errors: ${stderr}`;
				vscode.window.showErrorMessage(errMessage);
				return reject(errMessage);
			}
			return resolve([vscode.TextEdit.replace(fullDocumentRange(document), stdout)]);
		}

		// TODO: vscode.workspace.rootPath is deprecated.
		console.log(`Running ${cmd}...`);
		childProcess.exec(cmd, { cwd: vscode.workspace.rootPath }, callback);
	});
}

export function registerFormatter() {
	const provider: vscode.DocumentFormattingEditProvider = {
		provideDocumentFormattingEdits(document: vscode.TextDocument): Thenable<vscode.TextEdit[]> {
			return document.save().then(() => format(document));
		},
	};
	vscode.languages.registerDocumentFormattingEditProvider('v', provider);
}
