import {
	Range,
	TextDocument,
	workspace,
	WorkspaceConfiguration,
	window,
	Uri,
	WorkspaceFolder,
} from "vscode";
import { existsSync, mkdirSync, readdir, unlink } from "fs";
import { tmpdir, platform } from "os";
import { join } from "path";
import { execFileSync } from "child_process";

const TEMP_DIR = join(tmpdir(), "vscode_vlang");
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
	const config = getWorkspaceConfig();
	const vPath = config.get("pathToExecutableFile", "") || defaultCommand;
	return vPath;
}

/** Get V configuration. */
export function getWorkspaceConfig(): WorkspaceConfiguration {
	const currentWorkspaceFolder = getWorkspaceFolder();
	return workspace.getConfiguration("v", currentWorkspaceFolder.uri);
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

export function openUrl(url: string) {
	const os = platform();
	const open = {
		win32: "start",
		linux: "xdg-open",
		darwin: "open",
	};
	execFileSync(open[os], [url]);
}
