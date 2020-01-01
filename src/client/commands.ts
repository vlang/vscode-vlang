import * as vscode from 'vscode';
import { vrun } from './run';
import { executeV } from './utils';

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
export function ver() {
	executeV('-v', null, (err: Error, stdout: string) => {
		if (err) {
			vscode.window.showErrorMessage(
				'Unable to get the version number. Is V installed correctly?'
			);
			return;
		}

		vscode.window.showInformationMessage(stdout);
	});
}

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
export function playground() {}
