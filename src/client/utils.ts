import {
	Range,
	TextDocument,
	workspace,
	WorkspaceConfiguration,
	window,
	Uri,
	WorkspaceFolder,
	extensions,
} from "vscode";
import { existsSync, mkdirSync, readdir, unlink } from "fs";
import { tmpdir } from "os";
import { sep, join } from "path";

const TEMP_DIR = `${tmpdir()}${sep}vscode_vlang`;
const defaultCommand = "v";

/** Get full range of the document. */
export function fullDocumentRange(document: TextDocument): Range {
	const lastLineId = document.lineCount - 1;
	return new Range(0, 0, lastLineId, document.lineAt(lastLineId).text.length);
}

/** Get V executable command.
 * Will get from user setting configuration first.
 * If user don't specify it, then get default command
 */
export function getVExecCommand(): string {
	const config = getVConfig();
	const vPath = config.get("pathToExecutableFile", "") || defaultCommand;
	return vPath;
}

/** Get V configuration.
 * Will look at
 */
export function getVConfig(): WorkspaceConfiguration {
	const currentDoc = getCurrentDocument();
	const uri = currentDoc ? currentDoc.uri : null;
	return workspace.getConfiguration("v", uri);
}

export function getCwd(uri?: Uri): string {
	const folder = getWorkspaceFolder(uri || null);
	return folder.uri.fsPath;
}

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

export function trimBoth(str: string): string {
	return str.trimStart().trimEnd();
}

export function makeTempFolder() {
	if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR);
}

export function clearTempFolder() {
	readdir(TEMP_DIR, (err, files) => {
		if (err) throw err;

		for (const file of files) {
			unlink(join(TEMP_DIR, file), (err) => {
				if (err) throw err;
			});
		}
	});
}

export function getExtensionPath() {
	return extensions.getExtension("0x9ef.vscode-vlang").extensionPath
}
