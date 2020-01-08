import { Range, TextDocument, window, workspace } from 'vscode';

const defaultCommand = 'v';

export function fullDocumentRange(document: TextDocument): Range {
	const lastLineId = document.lineCount - 1;
	return new Range(0, 0, lastLineId, document.lineAt(lastLineId).text.length);
}

export function getVExecCommand(args: string): string {
	const config = workspace.getConfiguration('v');
	const vPath = config.get('pathToExecutableFile', '') || defaultCommand;
	return `${vPath} ${args}`;
}

export function getCurrentFilePath(): string {
	return window.activeTextEditor.document.fileName;
}

export function getCwd() {
	const folder = workspace.workspaceFolders[0];
	return folder.uri.fsPath;
}


export function saveCurrentFile(): Thenable<boolean> {
	return window.activeTextEditor.document.save();
}
