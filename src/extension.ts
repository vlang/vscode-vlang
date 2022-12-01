import vscode, { workspace, ExtensionContext, ConfigurationChangeEvent } from 'vscode';
import * as commands from './commands';
import { activateVls, deactivateVls, isVlsEnabled } from './langserver';

const cmds = {
	'v.run': commands.run,
	'v.fmt': commands.fmt,
	'v.ver': commands.ver,
	'v.prod': commands.prod,
	'v.vls.update': commands.updateVls,
	'v.vls.restart': commands.restartVls,
};

/**
 * This method is called when the extension is activated.
 * @param context The extension context
 */
export function activate(context: ExtensionContext): void {
	for (const cmd in cmds) {
		const handler = cmds[cmd] as () => void;
		const disposable = vscode.commands.registerCommand(cmd, handler);
		context.subscriptions.push(disposable);
	}

	workspace.onDidChangeConfiguration(async (e: ConfigurationChangeEvent) => {
		if (e.affectsConfiguration('v.vls.enable')) {
			if (isVlsEnabled()) {
				void activateVls();
			} else {
				await deactivateVls();
			}
		} else if (e.affectsConfiguration('v.vls') && isVlsEnabled()) {
			void vscode.window.showInformationMessage('VLS: Restart is required for changes to take effect. Would you like to proceed?', 'Yes', 'No')
				.then(selected => {
					if (selected === 'Yes') {
						void vscode.commands.executeCommand('v.vls.restart');
					}
				});
		}
	});

	const shouldEnableVls = isVlsEnabled();
	if (shouldEnableVls) {
		void activateVls();
	}
}

export async function deactivate(): Promise<void> {
	if (isVlsEnabled()) {
		await deactivateVls();
	}
}
