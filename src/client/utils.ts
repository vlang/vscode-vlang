import {
	Range,
	TextDocument,
	workspace,
	Uri,
	WorkspaceConfiguration,
	window
} from "vscode";

const defaultCommand = "v";

export function fullDocumentRange(document: TextDocument): Range {
	const lastLineId = document.lineCount - 1;
	return new Range(0, 0, lastLineId, document.lineAt(lastLineId).text.length);
}

export function getVExecCommand(args: string): string {
	const config = getVConfig();
	const vPath = config.get("pathToExecutableFile", "") || defaultCommand;
	return `${vPath} ${args}`;
}

export function getVConfig(): WorkspaceConfiguration {
	const currentDoc = getCurrentDocument()
	const uri = currentDoc ? currentDoc.uri : null
	return workspace.getConfiguration("v", uri);
}

export function getCwd() {
	const folder = workspace.workspaceFolders[0];
	return folder.uri.fsPath;
}

export function getCurrentDocument(): TextDocument {
	return window.activeTextEditor ? window.activeTextEditor.document : null;
}
