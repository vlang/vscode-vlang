import * as vscode from 'vscode';
import { vrun } from './run';

/**
 * Run current file.
 */
export function run() {
	vrun();
}

/**
 * Build an optimized executable from current file.
 */
export function prod() {}

/**
 * Show help info.
 */
export function help() {}

/**
 * Show version info.
 */
export function ver() {}

/**
 * Show local paths info.
 */
export function path() {}

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
export function playground() {
	const fileContent = vscode.window.activeTextEditor.document.getText();
	const buffer = new Buffer(fileContent).toString('base64');
	const url = vscode.Uri.parse(`https://devbits.app/play?lang=v&code64=${buffer}`);
	vscode.env.openExternal(url);
}
