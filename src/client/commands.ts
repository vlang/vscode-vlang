import { window } from "vscode";
import { execVInTerminal, execV } from "./exec";

/**
 * Run current file.
 */
export async function run() {
	const document = window.activeTextEditor.document;
	await document.save();
	const filePath = `"${document.fileName}"`

	execVInTerminal(["run", filePath]);
}

/**
 * Build an optimized executable from current file.
 */
export async function prod() {
	const document = window.activeTextEditor.document;
	await document.save();
	const filePath = `"${document.fileName}"`

	execVInTerminal(["-prod", filePath]);
}

/**
 * Show help info.
 */
export function help() {}

/**
 * Show version info.
 */
export function ver() {
	execV(["-v"], (err, stdout) => {
		if (err) {
			window.showErrorMessage(
				"Unable to get the version number. Is V installed correctly?"
			);
			return;
		}

		window.showInformationMessage(stdout);
	});
}

/**
 * Test current file.
 */
export function testFile() {}

/**
 * Test current package.
 */
export function testPackage() {}

/**
 * Upload and share current code to V playground.
 */
export function playground() {}
