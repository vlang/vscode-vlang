import vscode, { workspace, ExtensionContext, ConfigurationChangeEvent } from 'vscode';
import * as commands from './commands';
import { activateVls, deactivateVls, isVlsEnabled } from './langserver';

const cmds = {
	'v.run': commands.run,
	'v.ver': commands.ver,
	'v.prod': commands.prod,
	'v.devbits_playground': commands.devbitsPlayground,
	'v.vls.update': commands.updateVls,
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

	const restartVls = vscode.commands.registerCommand('v.vls.restart', () => {
		const restartMsg = vscode.window.setStatusBarMessage('Restarting VLS...', 3000);
		deactivateVls()
			.then(() => { 
				restartMsg.dispose(); 
			})
			.then(() => activateVls(context))
			.catch((err) => vscode.window.showErrorMessage(err));
	});

	context.subscriptions.push(restartVls);

	workspace.onDidChangeConfiguration((e: ConfigurationChangeEvent) => {
		if (e.affectsConfiguration('v.vls.enable')) {
			if (isVlsEnabled()) {
				void activateVls(context);
			} else {
				void deactivateVls();
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
		void activateVls(context);
	}
}
