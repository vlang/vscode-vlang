import vscode, {
	workspace,
	ExtensionContext,
	ConfigurationChangeEvent,
	TextEditor,
	window,
	TextDocument,
} from "vscode";
import * as commands from "./commands";
import { activateVls, deactivateVls } from "./langserver";
import { registerFormatter } from "./format";
import { attachOnCloseTerminalListener } from "./exec";
import {
	clearTempFolder,
	getWorkspaceConfig,
	getWorkspaceFolder,
	makeTempFolder,
} from "./utils";
import { FormatterStatus, statusBar } from "./status";
import { clients, ENABLE_VLS_BY_DEFAULT } from "./client";

const vLanguageId = "v";

const cmds = {
	"v.run": commands.run,
	"v.ver": commands.ver,
	"v.help": commands.help,
	"v.prod": commands.prod,
	"v.openOutput": commands.openOutput,
	"v.devbits_playground": commands.devbitsPlayground,
	"v.vls.update": commands.updateVls,
	// "v.playground": commands.playground,

	// "v.test.package": commands.testPackage,
};

const handleActiveTextEditorChanged = async (textEditor: TextEditor | undefined) => {
	updateStatusBar(textEditor);
	const isVLSEnabled = workspace
		.getConfiguration("v", textEditor.document)
		.get("vls.enable", ENABLE_VLS_BY_DEFAULT);

	if (!isVLSEnabled) {
		statusBar.enableAutoShow = true;
	}

	if (
		textEditor &&
		textEditor.document &&
		textEditor.document.languageId === vLanguageId &&
		textEditor.document.uri.scheme === "file" &&
		!textEditor.document.isUntitled &&
		!textEditor.document.isClosed &&
		isVLSEnabled
	) {
		await ensureVLSActivated(
			workspace.getWorkspaceFolder(textEditor.document.uri),
			_context
		);
	}
};

function updateStatusBar(textEditor: TextEditor | undefined) {
	if (!textEditor || !textEditor.document || textEditor.document.isClosed) {
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
}

const pendingClients = new Map<string, boolean>();
let _context: ExtensionContext;

async function ensureVLSActivated(
	folder: vscode.WorkspaceFolder,
	context: ExtensionContext
) {
	let uri = folder.uri.toString(true);
	if (clients.has(uri) || pendingClients.has(uri)) {
		return;
	}
	pendingClients.set(uri, true);

	const client = await activateVls(folder, context);
	if (client) {
		clients.set(uri, client);
		uri = null;
	}

	pendingClients.delete(uri);
}

async function didOpenTextDocument(document: TextDocument) {
	if (!document || !document.uri) return;

	const { uri } = document;
	let folder = workspace.getWorkspaceFolder(uri);
	// Files outside a folder can't be handled. This might depend on the language.
	// Single file languages like JSON might handle files outside the workspace folders.
	if (
		!folder ||
		document.languageId !== vLanguageId ||
		uri.scheme !== "file" ||
		document.isUntitled
	) {
		return;
	}

	if (
		workspace
			.getConfiguration("v", folder)
			.get<boolean>("vls.enable", ENABLE_VLS_BY_DEFAULT)
	) {
		await ensureVLSActivated(folder, _context);
	}
}

/**
 * This method is called when the extension is activated.
 * @param context The extension context
 */
async function _activate(context: ExtensionContext) {
	_context = context;

	for (const cmd in cmds) {
		const handler = cmds[cmd];
		const disposable = vscode.commands.registerCommand(cmd, handler);
		context.subscriptions.push(disposable);
	}

	try {
		for (let doc of workspace.textDocuments) {
			await didOpenTextDocument(doc);
		}
	} catch (exception) {
		console.error(exception);
	}

	context.subscriptions.push(
		workspace.onDidOpenTextDocument(didOpenTextDocument),
		registerFormatter(),
		attachOnCloseTerminalListener(),
		window.onDidChangeActiveTextEditor(handleActiveTextEditorChanged),
		vscode.workspace.onDidChangeConfiguration(didChangeConfiguration)
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
	if (event.affectsConfiguration("v.vls.enable")) {
		if (!workspace.getConfiguration("v").get("vls.enable", ENABLE_VLS_BY_DEFAULT)) {
			deactivateVls();
		}
	}

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
	deactivateVls();
}
