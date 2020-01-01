import * as vscode from 'vscode';
import { exec, ExecOptions, ExecException } from 'child_process';

export function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
	const lastLineId = document.lineCount - 1;
	return new vscode.Range(0, 0, lastLineId, document.lineAt(lastLineId).text.length);
}

export function executeV(args: string, options: ExecOptions, callback: Function) {
	const cmd = getVExecCommand(args);
	console.log(`Executing ${cmd}`);
	exec(cmd, options, (err, stdout, stderr) => {
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
