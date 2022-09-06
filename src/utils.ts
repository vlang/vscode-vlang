import {
	workspace,
	WorkspaceConfiguration,
	window,
	Uri,
	WorkspaceFolder,
} from 'vscode';
const defaultCommand = 'v';

/** Get V executable command.
 * Will get from user setting configuration first.
 * If user don't specify it, then get default command
 */
export function getVExecCommand(): string {
	const config = getWorkspaceConfig();
	return config.get('v.executablePath', defaultCommand);
}

/** Get V configuration. */
export function getWorkspaceConfig(): WorkspaceConfiguration {
	const currentWorkspaceFolder = getWorkspaceFolder();
	return workspace.getConfiguration('v', currentWorkspaceFolder.uri);
}

/** Get current working directory.
 * @param uri The URI of document
 */
export function getCwd(uri?: Uri): string {
	const folder = getWorkspaceFolder(uri || null);
	return folder.uri.fsPath;
}

/** Get workspace of current document.
 * @param uri The URI of document
 */
export function getWorkspaceFolder(uri?: Uri): WorkspaceFolder {
	if (uri) {
		return workspace.getWorkspaceFolder(uri);
	} else if (window.activeTextEditor && window.activeTextEditor.document) {
		return workspace.getWorkspaceFolder(window.activeTextEditor.document.uri);
	} else {
		return workspace.workspaceFolders[0];
	}
}
