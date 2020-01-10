import { Range, TextDocument, workspace, WorkspaceConfiguration, window } from "vscode";
import { existsSync, mkdirSync, readdir, unlink } from "fs";
import { tmpdir } from "os";
import { sep, join } from "path";

const TEMP_DIR = `${tmpdir()}${sep}vscode_vlang`;
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
	const currentDoc = getCurrentDocument();
	const uri = currentDoc ? currentDoc.uri : null;
	return workspace.getConfiguration("v", uri);
}

export function getCwd() {
	const folder = workspace.workspaceFolders[0];
	return folder.uri.fsPath;
}

export function getCurrentDocument(): TextDocument {
	return window.activeTextEditor ? window.activeTextEditor.document : null;
}

export function arrayInclude(arr: Array<string>, search: string): number {
	let ind = -1;
	arr.forEach((sp, i) => {
		if (sp.indexOf(search) != -1) {
			ind = i;
			return;
		}
	});
	return ind;
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
			unlink(join(TEMP_DIR, file), err => {
				if (err) throw err;
			});
		}
	});
}
