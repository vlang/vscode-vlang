import * as vscode from "vscode";
import * as commands from "./commands";
import { registerFormatter } from "./format";
import { attachOnCloseTerminalListener } from "./exec";
import { clearTempFolder, makeTempFolder } from "./utils";
import { activateLsp } from "./langserver";

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

	activateLsp(context);
}

/**
 * This method is called when the extension is deactivated.
 */
export function deactivate() {
	clearTempFolder();
}
