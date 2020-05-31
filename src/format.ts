import {
	DocumentFormattingEditProvider,
	languages,
	TextDocument,
	TextEdit,
	window,
	Disposable,
} from "vscode";
import { execV } from "./exec";
import { writeFile, unlink } from "fs";
import { fullDocumentRange, getVConfig } from "./utils";

function format(document: TextDocument): Promise<TextEdit[]> {
	const vfmtArgs = getVConfig().get("format.args", "");
	const rand = Math.random().toString(36).substring(7);
	const tempFile = document.fileName.replace(".v", `${rand}tmp.v`);
	const args = ["fmt", vfmtArgs, tempFile];

	return new Promise((resolve, reject) => {
		writeFile(tempFile, document.getText(), () => {
			execV(args, (err, stdout, stderr) => {
				unlink(tempFile, () => {
					if (err) {
						const errMessage = `Cannot format due to the following errors: ${stderr}`.replace(tempFile, document.fileName);
						window.showErrorMessage(errMessage);
						return reject(errMessage);
					}
					return resolve([TextEdit.replace(fullDocumentRange(document), stdout)]);
				});
			});
		});
	});
}

export function registerFormatter(): Disposable {
	const provider: DocumentFormattingEditProvider = {
		provideDocumentFormattingEdits(document: TextDocument): Thenable<TextEdit[]> {
			return format(document);
		}
	};
	return languages.registerDocumentFormattingEditProvider("v", provider);
}
