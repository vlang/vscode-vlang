import vscode from "vscode";
import * as commands from "./commands";
import { getWorkspaceConfig } from './utils';
import { activateLsp, checkVlsInstalled, vlsPath } from "./langserver";

const cmds = {
	"v.run": commands.run,
	"v.ver": commands.ver,
	"v.help": commands.help,
	"v.prod": commands.prod,
	"v.devbits_playground": commands.devbitsPlayground,
};

/**
 * This method is called when the extension is activated.
 * @param context The extension context
 */
export function activate(context: vscode.ExtensionContext) {
	for (const cmd in cmds) {
		const handler = cmds[cmd];
		const disposable = vscode.commands.registerCommand(cmd, handler);
		context.subscriptions.push(disposable);
	}
	const customVlsPath = getWorkspaceConfig().get<string>("vls.path");

	if (!customVlsPath) {
		// if no vls path is given, try to used the installed one or install it.
		checkVlsInstalled()
			.then(installed => {
				if (installed) {
					activateLsp(vlsPath, context);
				}
			});
	} else {
		activateLsp(customVlsPath, context);
	}
}
