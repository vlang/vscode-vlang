import vscode, { workspace, ExtensionContext, ConfigurationChangeEvent } from 'vscode';
import * as commands from './commands';
import { activateVls, deactivateVls, isVlsEnabled, terminateVlsProcess } from './langserver';

const cmds = {
	'v.run': commands.run,
	'v.ver': commands.ver,
	'v.prod': commands.prod,
	'v.devbits_playground': commands.devbitsPlayground,
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

	workspace.onDidChangeConfiguration((e: ConfigurationChangeEvent) => {
		if (e.affectsConfiguration('v.vls.enable')) {
			if (isVlsEnabled()) {
				void activateVls();
			} else {
				void deactivateVls();
				void terminateVlsProcess();
			}
		} else if (e.affectsConfiguration('v.vls') && isVlsEnabled()) {
			void vscode.window.showInformationMessage('VLS: Restart is required for changes to take effect. Would you like to proceed?', 'Yes', 'No')
				.then(selected => {
					if (selected == 'No') return;
					void vscode.commands.executeCommand('v.vls.restart');
				});
		}
	});

	const shouldEnableVls = isVlsEnabled();
	if (shouldEnableVls) {
		void activateVls();
	}
}
