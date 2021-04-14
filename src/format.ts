import {
	DocumentFormattingEditProvider,
	languages,
	TextDocument,
	TextEdit,
	window,
	Disposable,
} from "vscode";
import { execV } from "./exec";
import { fullDocumentRange, getWorkspaceConfig } from "./utils";

function doFormat(document: TextDocument, resolve: Function, reject: Function) {
	if (document.isClosed) {
		resolve([]);
		return;
	}

	const callback = (err, stdout, stderr) => {
		if (document.isClosed) {
			document = null;
			resolve([]);
			return;
		}

		if (err) {
			const errMessage = `Cannot format due to the following errors: ${stderr}`;
			window.showErrorMessage(errMessage);
			document = null;
			return reject(errMessage);
		}
		const res = [TextEdit.replace(fullDocumentRange(document), stdout)];
		document = null;
		resolve(res);
	};

	const vfmtArgs = getWorkspaceConfig().get("format.args", "");

	if (vfmtArgs.length) {
		execV(["fmt", vfmtArgs, document.uri.fsPath], callback);
	} else {
		execV(["fmt", document.uri.fsPath], callback);
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
