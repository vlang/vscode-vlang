import vscode, { workspace, ExtensionContext, ConfigurationChangeEvent } from "vscode";
import * as commands from "./commands";
import { activateVls, deactivateVls } from "./langserver";
import { registerFormatter } from "./format";
import { attachOnCloseTerminalListener } from "./exec";
import { clearTempFolder, getWorkspaceConfig, makeTempFolder } from "./utils";

const vLanguageId = "v";

const cmds = {
	"v.run": commands.run,
	"v.ver": commands.ver,
	"v.help": commands.help,
	"v.prod": commands.prod,
	// "v.playground": commands.playground,
	"v.devbits_playground": commands.devbitsPlayground,
	"v.vls.update": commands.updateVls,
	// "v.test.package": commands.testPackage,
};

/**
 * This method is called when the extension is activated.
 * @param context The extension context
 */
export function activate(context: ExtensionContext) {
	for (const cmd in cmds) {
		const handler = cmds[cmd];
		const disposable = vscode.commands.registerCommand(cmd, handler);
		context.subscriptions.push(disposable);
	}
	const isVlsEnabled = getWorkspaceConfig().get<boolean>("vls.enable");

	workspace.onDidChangeConfiguration((e: ConfigurationChangeEvent) => {
		if (e.affectsConfiguration("v.vls.enable")) {
			const isVlsEnabled = getWorkspaceConfig().get<boolean>("vls.enable");
			if (isVlsEnabled) {
				activateVls(context);
			} else {
				deactivateVls();
			}
		}
	});

	if (isVlsEnabled) {
		activateVls(context);
	}

	context.subscriptions.push(
		registerFormatter(),
		attachOnCloseTerminalListener(),
		vscode.workspace.onDidChangeConfiguration(didChangeConfiguration)
	);
}

/**
 *  Handles the `onDidChangeConfiguration` event
 */
function didChangeConfiguration(event: vscode.ConfigurationChangeEvent) {
	if (!event.affectsConfiguration("v")) return;
	vscode.window
		.showInformationMessage(
			"There's a new change in configuration and a restart is required. Would you like to restart it now?",
			"Yes",
			"No"
		)
		.then((choice) => {
			if (choice == "Yes") {
				vscode.commands.executeCommand("workbench.action.reloadWindow");
			}
		});
}

/**
 * This method is called when the extension is deactivated.
 */
export function deactivate() {
	clearTempFolder();
}
