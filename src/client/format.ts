import {
	DocumentFormattingEditProvider,
	languages,
	TextDocument,
	TextEdit,
	window,
	Disposable
} from "vscode";
import { execV } from "./exec";
import { fullDocumentRange, getVConfig, TEMP_DIR } from "./utils";
import * as path from 'path'
import { writeFileSync } from "fs";

function format(document: TextDocument): Promise<TextEdit[]> {
	return new Promise((resolve, reject) => {
		const vfmtArgs = getVConfig().get("format.args", "");
		const TMP_FILE = path.resolve(TEMP_DIR, 'FORMAT_TEMP.v')
		const args = ["fmt", vfmtArgs, TMP_FILE];
		writeFileSync(TMP_FILE, document.getText())

		execV(args, (err, stdout, stderr) => {
			if (err) {
				const errMessage = `Cannot format due to the following errors: ${stderr}`;
				window.showErrorMessage(errMessage);
				return reject(errMessage);
			}
			return resolve([TextEdit.replace(fullDocumentRange(document), stdout)]);
		});
	});
}

export function registerFormatter(): Disposable {
	const provider: DocumentFormattingEditProvider = {
		provideDocumentFormattingEdits(document: TextDocument): Thenable<TextEdit[]> {
			// return document.save().then(() => format(document));
			return format(document)
		}
	};
	return languages.registerDocumentFormattingEditProvider("v", provider);
}
