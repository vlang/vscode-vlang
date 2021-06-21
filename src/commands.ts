import { window, env, Uri } from 'vscode';
import { execVInTerminal, execV } from './exec';
import { installVls } from './langserver';

/** Run current file. */
export async function run(): Promise<void> {
	const document = window.activeTextEditor.document;
	await document.save();
	const filePath = `"${document.fileName}"`;

	execVInTerminal(['run', filePath]);
}

/** Build an optimized executable from current file. */
export async function prod(): Promise<void> {
	const document = window.activeTextEditor.document;
	await document.save();
	const filePath = `"${document.fileName}"`;

	execVInTerminal(['-prod', filePath]);
}

/** Show version info. */
export function ver(): void {
	execV(['-version'], (err, stdout) => {
		if (err) {
			void window.showErrorMessage('Unable to get the version number. Is V installed correctly?');
			return;
		}
		void window.showInformationMessage(stdout);
	});
}

/** Open current code on DevBits V playground. */
export function devbitsPlayground(): void {
	const url = 'https://devbits.app/play?lang=v&code64=';
	const code = window.activeTextEditor.document.getText();
	const base64Code = Buffer.from(code).toString('base64');
	void env.openExternal(Uri.parse(url + base64Code));
}

export function updateVls(): void {
	void installVls();
}
