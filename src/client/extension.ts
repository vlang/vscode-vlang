import * as vscode from "vscode";
import * as commands from "./commands";
import { registerFormatter } from "./format";
import { attachOnCloseTerminalListener } from "./exec";
import { lint, collection } from "./linter";
import { clearTempFolder, getVConfig } from "./utils";

const vLanguageId = "v";

const cmds = {
	"v.run": commands.run,
	"v.ver": commands.ver,
	"v.help": commands.help,
	"v.prod": commands.prod,
	"v.test.file": commands.testFile,
	"v.playground": commands.playground,
	"v.test.package": commands.testPackage,
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

	context.subscriptions.push(registerFormatter(), attachOnCloseTerminalListener());

	if (getVConfig().get("enableLinter")) {
		context.subscriptions.push(
			vscode.window.onDidChangeVisibleTextEditors(didChangeVisibleTextEditors),
			vscode.workspace.onDidSaveTextDocument(didSaveTextDocument),
			vscode.workspace.onDidCloseTextDocument(didCloseTextDocument)
		);
		// If there are V files open, do the lint immediately
		if (
			vscode.window.activeTextEditor &&
			vscode.window.activeTextEditor.document.languageId === vLanguageId
		) {
			lint(vscode.window.activeTextEditor.document);
		}
	}
}

/**
 *  Handles the `onDidChangeVisibleTextEditors` event
 */
function didChangeVisibleTextEditors(editors: Array<vscode.TextEditor>) {
	editors.forEach((editor) => {
		if (editor.document.languageId === vLanguageId) {
			lint(editor.document);
		}
	});
}

/**
 *  Handles the `onDidSaveTextDocument` event
 */
function didSaveTextDocument(document: vscode.TextDocument) {
	if (document.languageId === vLanguageId) {
		lint(document);
	}
}

/**
 *  Handles the `onDidCloseTextDocument` event
 */
function didCloseTextDocument(document: vscode.TextDocument) {
	if (document.languageId === vLanguageId) {
		if (!vscode.window.activeTextEditor) collection.clear();
		collection.delete(document.uri);
	}
}

/**
 * This method is called when the extension is deactivated.
 */
export function deactivate() {
	clearTempFolder();
}
