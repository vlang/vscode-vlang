import * as vscode from 'vscode';
import { exec, ExecOptions, ExecException } from 'child_process';

export function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
	const lastLineId = document.lineCount - 1;
	return new vscode.Range(0, 0, lastLineId, document.lineAt(lastLineId).text.length);
}

export function executeV(args: string, callback: Function) {
	const cmd = getVExecCommand(args);
	const cwd = getCwd();

	console.log(`Executing ${cmd}`);
	exec(cmd, { cwd }, (err, stdout, stderr) => {
		callback(err, stdout, stderr);
	});
}

export function getVExecCommand(args: string): string {
	const config = vscode.workspace.getConfiguration('v');
	const vPath = config.get('pathToExecutableFile', '');
	if (vPath) {
		return `${vPath} ${args}`;
	}

	return `v ${args}`;
}

function getCwd() {
	const workspace = vscode.workspace.workspaceFolders[0];
	return workspace.uri.fsPath;
}
