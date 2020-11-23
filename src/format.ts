import {
	DocumentFormattingEditProvider,
	languages,
	TextDocument,
	TextEdit,
	Disposable,
} from "vscode";
import { execV } from "./exec";
import { fullDocumentRange, getWorkspaceConfig } from "./utils";

function format(document: TextDocument): Promise<TextEdit[]> {
	const vfmtArgs = getWorkspaceConfig().get("format.args", "");
	const args = ["fmt", vfmtArgs, document.uri.fsPath];

	return new Promise((resolve, reject) => {
		execV(args, (err, stdout, stderr) => {
			if (err) {
				const errMessage = `V formatter: Cannot format ${document.fileName} due to the following errors: ${stderr}`;
				console.error(errMessage);
				return reject(errMessage);
			}
			return resolve([TextEdit.replace(fullDocumentRange(document), stdout)]);
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
