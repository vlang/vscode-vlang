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

function format(document: TextDocument): Promise<TextEdit[]> {
	return new Promise((resolve, reject) => {
		const vfmtArgs = getWorkspaceConfig().get("format.args", "");
		let args: string[];
		if (vfmtArgs.length) {
			args = ["fmt", vfmtArgs, document.uri.fsPath];
		} else {
			args = ["fmt", document.uri.fsPath];
		}

		execV(args, (err, stdout, stderr) => {
			if (err) {
				const errMessage = `Cannot format due to the following errors: ${stderr}`;
				window.showErrorMessage(errMessage);
				document = null;
				return reject(errMessage);
			}
			const res = [TextEdit.replace(fullDocumentRange(document), stdout)];
			document = null;
			resolve(res);
		});
	});
}

export function registerFormatter(): Disposable {
	const provider: DocumentFormattingEditProvider = {
		provideDocumentFormattingEdits(document: TextDocument): Thenable<TextEdit[]> {
			return format(document);
		},
	};
	return languages.registerDocumentFormattingEditProvider("v", provider);
}
