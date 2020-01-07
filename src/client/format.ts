import {
	TextDocument,
	TextEdit,
	window,
	DocumentFormattingEditProvider,
	languages
} from 'vscode';
import { ExecException } from 'child_process';
import { execV } from './exec';
import { fullDocumentRange, getVConfig } from './utils';

function format(document: TextDocument): Promise<TextEdit[]> {
	return new Promise((resolve, reject) => {
		const config = getVConfig(document);
		const vfmtArgs = config.get('args', '');
		const args = `fmt ${vfmtArgs} ${document.fileName}`;

		// Create new `callback` function for
		function callback(error: ExecException, stdout: string, stderr: string) {
			if (error) {
				const errMessage = `Cannot format due to the following errors: ${stderr}`;
				window.showErrorMessage(errMessage);
				return reject(errMessage);
			}
			return resolve([TextEdit.replace(fullDocumentRange(document), stdout)]);
		}

		execV(args, callback);
	});
}

export function registerFormatter() {
	const provider: DocumentFormattingEditProvider = {
		provideDocumentFormattingEdits(document: TextDocument): Thenable<TextEdit[]> {
			return document.save().then(() => format(document));
		}
	};
	languages.registerDocumentFormattingEditProvider('v', provider);
}
