import { Range, TextDocument, window, workspace, WorkspaceConfiguration } from 'vscode';

const defaultCommand = 'v';

export function fullDocumentRange(document: TextDocument): Range {
	const lastLineId = document.lineCount - 1;
	return new Range(0, 0, lastLineId, document.lineAt(lastLineId).text.length);
}

export function getVExecCommand(args: string): string {
	const config = getVConfig();
	const vPath = config.get('pathToExecutableFile', defaultCommand)

	return `${vPath} ${args}`;
}

export function getVConfig(document?: TextDocument): WorkspaceConfiguration {
	let vConfig = workspace.getConfiguration('v');
	if (document) vConfig = workspace.getConfiguration('v', document.uri);
	return vConfig;
}

export function getCurrentFilePath(): string {
	return window.activeTextEditor.document.fileName;
}

export function getCwd(document?: TextDocument): string {
	let folder = workspace.workspaceFolders[0];
	if (document) folder = workspace.getWorkspaceFolder(document.uri);
	return folder.uri.fsPath;
}
