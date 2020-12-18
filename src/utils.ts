import {
	TextDocument,
	workspace,
	WorkspaceConfiguration,
	window,
	Uri,
	WorkspaceFolder,
} from "vscode";
import { platform } from "os";
import { execFileSync } from "child_process";

const defaultCommand = "v";

/** Get V executable command.
 * Will get from user setting configuration first.
 * If user don't specify it, then get default command
 */
export function getVExecCommand(): string {
	const config = getWorkspaceConfig();
	const vPath = config.get("pathToExecutableFile", "") || defaultCommand;
	return vPath;
}

/** Get V configuration. */
export function getWorkspaceConfig(): WorkspaceConfiguration {
	const currentDoc = getCurrentDocument();
	const uri = currentDoc ? currentDoc.uri : null;
	return workspace.getConfiguration("v", uri);
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
	if (uri) return workspace.getWorkspaceFolder(uri);
	const currentDoc = getCurrentDocument();
	return currentDoc
		? workspace.getWorkspaceFolder(currentDoc.uri)
		: workspace.workspaceFolders[0];
}

export function getCurrentDocument(): TextDocument {
	return window.activeTextEditor ? window.activeTextEditor.document : null;
}

export function openUrl(url: string) {
	const os = platform();
	const open = {
		win32: "start",
		linux: "xdg-open",
		darwin: "open",
	};
	execFileSync(open[os], [url]);
}
