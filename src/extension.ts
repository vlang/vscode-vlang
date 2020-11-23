import * as vscode from "vscode";
import * as commands from "./commands";
import { registerFormatter } from "./format";
import { attachOnCloseTerminalListener } from "./exec";
import * as linter from "./linter";
import { clearTempFolder, getWorkspaceConfig, makeTempFolder } from "./utils";
import { activateLSP } from "./langserver";

const vLanguageId = "v";

const cmds = {
	"v.run": commands.run,
	"v.ver": commands.ver,
	"v.help": commands.help,
	"v.prod": commands.prod,
	"v.test.file": commands.testFile,
	"v.playground": commands.playground,
	"v.devbits_playground": commands.devbitsPlayground,
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

	// Make a temp folder for linter
	makeTempFolder();
	context.subscriptions.push(registerFormatter(), attachOnCloseTerminalListener());

	if (getWorkspaceConfig().get("enableLinter")) {
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
			linter.lint(vscode.window.activeTextEditor.document);
		}
	}

	activateLSP(context);
}

/**
 *  Handles the `onDidChangeVisibleTextEditors` event
 */
function didChangeVisibleTextEditors(editors: Array<vscode.TextEditor>) {
	editors.forEach((editor) => {
		if (editor.document.languageId === vLanguageId) {
			linter.lint(editor.document);
		}
	});
}

/**
 *  Handles the `onDidSaveTextDocument` event
 */
function didSaveTextDocument(document: vscode.TextDocument) {
	if (document.languageId === vLanguageId) {
		linter.lint(document);
	}
}

/**
 *  Handles the `onDidCloseTextDocument` event
 */
function didCloseTextDocument(document: vscode.TextDocument) {
	if (!vscode.window.visibleTextEditors.length) {
		linter.clear();
	}
	if (document.languageId === vLanguageId) {
		linter._delete(document.uri);
	}
}

/**
 * This method is called when the extension is deactivated.
 */
export function deactivate() {
	clearTempFolder();
}
