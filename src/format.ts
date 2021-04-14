import {
	DocumentFormattingEditProvider,
	languages,
	TextDocument,
	TextEdit,
	window,
	Disposable,
} from "vscode";
import { client } from "./client";
import { execV, execVWithDocument } from "./exec";
import { FormatterStatus, outputChannel, statusBar } from "./status";
import { fullDocumentRange, getWorkspaceConfig } from "./utils";

function timestampString() {
	return new Date().toLocaleTimeString();
}

function doFormat(document: TextDocument, resolve: Function, reject: Function) {
	if (document.isClosed) {
		resolve([]);
		return;
	}
	const start = Date.now();

	const callback = (err, stdout, stderr) => {
		if (document.isClosed) {
			document = null;
			resolve([]);
			return;
		}

		if (err && !stderr.length) {
			stderr = `ERR - [${timestampString()}] ${err.toString()}`;
			outputChannel.append(stderr);
			document = null;
			statusBar.update(FormatterStatus.Error);
			return reject(stderr);
		}

		if (stderr.length > 0) {
			if (stderr.startsWith(":")) {
				stderr = `ERR - [${timestampString()}] ${document.fileName}${stderr}`;
				// sometimes the filename shows up as something weird isntead of an empty string.
			} else if (stderr.indexOf(":") > -1) {
				stderr = `ERR - [${timestampString()}] ${
					document.fileName
				}:${stderr.substring(stderr.indexOf(":"))}`;
			} else {
				stderr = `ERR - [${timestampString()}] ${document.fileName}:${stderr}`;
			}
			outputChannel.append(stderr);
			document = null;
			statusBar.update(FormatterStatus.Error);
			return reject(stderr);
		}

		const res = [TextEdit.replace(fullDocumentRange(document), stdout)];

		outputChannel.appendLine(
			`[${timestampString()}] v fmt completed in ${Date.now() - start}ms (${
				document.uri.fsPath
			})`
		);
		document = null;
		statusBar.update(FormatterStatus.Success);
		resolve(res);
	};

	const vfmtArgs = getWorkspaceConfig().get("format.args", "");
	if (vfmtArgs.length) {
		execVWithDocument(document, ["fmt", vfmtArgs], callback);
	} else {
		execVWithDocument(document, ["fmt"], callback);
	}
}

var formatter: Disposable = null;

export function registerFormatter(): Disposable {
	if (formatter) {
		formatter.dispose();
	}

	const provider: DocumentFormattingEditProvider = {
		provideDocumentFormattingEdits(document: TextDocument): Thenable<TextEdit[]> {
			return new Promise((resolve, reject) => {
				doFormat(document, resolve, reject);
			});
		},
	};
	return (formatter = languages.registerDocumentFormattingEditProvider("v", provider));
}
