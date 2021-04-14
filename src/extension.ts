import vscode, {
	workspace,
	ExtensionContext,
	ConfigurationChangeEvent,
	TextEditor,
	window,
} from "vscode";
import * as commands from "./commands";
import { activateVls, deactivateVls } from "./langserver";
import { registerFormatter } from "./format";
import { attachOnCloseTerminalListener } from "./exec";
import { clearTempFolder, getWorkspaceConfig, makeTempFolder } from "./utils";
import { FormatterStatus, statusBar } from "./status";

const vLanguageId = "v";

const cmds = {
	"v.run": commands.run,
	"v.ver": commands.ver,
	"v.help": commands.help,
	"v.prod": commands.prod,
	"v.openOutput": commands.openOutput,
	// "v.playground": commands.playground,
	"v.devbits_playground": commands.devbitsPlayground,
	"v.vls.update": commands.updateVls,
	// "v.test.package": commands.testPackage,
};

const handleActiveTextEditorChanged = async (textEditor: TextEditor | undefined) => {
	if (!textEditor) {
		statusBar.hide();
		return;
	}
	const { document } = textEditor;

	if (document.languageId !== vLanguageId) {
		statusBar.hide();
		return;
	}

	if (document.uri.scheme !== "file" && !document.isUntitled) {
		statusBar.hide();
		return;
	}

	statusBar.update(FormatterStatus.Ready);
};

/**
 * This method is called when the extension is activated.
 * @param context The extension context
 */
async function _activate(context: ExtensionContext) {
	for (const cmd in cmds) {
		const handler = cmds[cmd];
		const disposable = vscode.commands.registerCommand(cmd, handler);
		context.subscriptions.push(disposable);
	}
	const isVlsEnabled = getWorkspaceConfig().get<boolean>("vls.enable");

	const configurator = workspace.onDidChangeConfiguration(
		(e: ConfigurationChangeEvent) => {
			if (e.affectsConfiguration("v.vls.enable")) {
				const isVlsEnabled = getWorkspaceConfig().get<boolean>("vls.enable");
				if (isVlsEnabled) {
					activateVls(context);
				} else {
					deactivateVls();
				}
			}
		}
	);

	if (isVlsEnabled) {
		await activateVls(context);
	}

	context.subscriptions.push(
		registerFormatter(),
		attachOnCloseTerminalListener(),
		window.onDidChangeActiveTextEditor(handleActiveTextEditorChanged),
		vscode.workspace.onDidChangeConfiguration(didChangeConfiguration),
		configurator
	);
}

export function activate(context: ExtensionContext) {
	return _activate(context).then(() => {});
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
