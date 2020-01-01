import * as vscode from 'vscode';
import { getVExecCommand } from './utils';

let vRunTerm: vscode.Terminal = null;

export function vrun() {
	const currentFilePath = vscode.window.activeTextEditor.document.fileName;
	const args = `run ${currentFilePath}`;
	const cmd = getVExecCommand(args);

	vscode.window.activeTextEditor.document.save();
	if (!vRunTerm) vRunTerm = vscode.window.createTerminal('V');
	vRunTerm.show();
	vRunTerm.sendText(cmd);
}

export function attachOnCloseTerminalListener() {
	vscode.window.onDidCloseTerminal(term => {
		if (term.name == 'V') vRunTerm = null;
	});
}
