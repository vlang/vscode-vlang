import { window, ProgressLocation } from 'vscode';
import { execVInTerminal, execVInTerminalOnBG, execV } from './exec';
import { activateVls, deactivateVls, installVls } from './langserver';
import { log, outputChannel, vlsOutputChannel } from './status';

/** Run current file. */
export async function run(): Promise<void> {
	const document = window.activeTextEditor.document;
	await document.save();
	const filePath = `"${document.fileName}"`;

	execVInTerminal(['run', filePath]);
}

/** Format current file. */
export async function fmt(): Promise<void> {
	const document = window.activeTextEditor.document;
	await document.save();
	const filePath = `"${document.fileName}"`;

	execVInTerminalOnBG(['fmt', '-w', filePath]);
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
			void window.showErrorMessage(
				'Unable to get the version number. Is V installed correctly?'
			);
			return;
		}
		void window.showInformationMessage(stdout);
	});
}

export function updateVls(): void {
	void installVls(true);
}

export function restartVls(): void {
	window.withProgress({
		location: ProgressLocation.Notification,
		cancellable: false,
		title: 'VLS'
	}, async (progress) => {
		progress.report({ message: 'Restarting' });
		deactivateVls();
		vlsOutputChannel.clear();
		await activateVls();
	}).then(
		() => {
			return;
		},
		(err) => {
			log(err);
			outputChannel.show();
			void window.showErrorMessage(
				'Failed restarting VLS. See output for more information.'
			);
		}
	);
}
