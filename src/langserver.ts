import os from 'os';
import path from 'path';
import fs from 'fs';
import cp from 'child_process';
import { window, StatusBarAlignment, ExtensionContext, workspace } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient";

import { outputChannel } from './status';
import { getVExecCommand, getWorkspaceConfig } from './utils';

const vmodules = path.join(os.homedir(), '.vmodules');
const vbin = path.join(vmodules, 'bin');
const vexe = getVExecCommand();
export const vlsPath = path.join(vbin, 'vls');
export let client: LanguageClient;

export async function checkIsVlsInstalled(): Promise<boolean> {
	const vlsExists = fs.existsSync(vlsPath);
	if (!vlsExists) {
		const selected = await window.showInformationMessage('VLS is not installed. Do you want to install it now?', 'Yes', 'No')
		if (selected === 'Yes') {
			return await installVls();
		} else {
			return false;
		}
	}
	return true;
}

export async function installVls(): Promise<boolean> {
	outputChannel.show();
	outputChannel.clear();
	outputChannel.appendLine(`Installing VLS to ${vlsPath}...`);
	const vlsCmd = path.join(vmodules, 'vls', 'cmd', 'vls')
	try {
		cp.execSync(`v install vls`);
	} catch {
		outputChannel.appendLine('VPM failed installing VLS.');
		return false;
	}
	// build vls module to ~/.vmodules/bin
	if (!fs.existsSync(vbin)) {
		outputChannel.appendLine(`Creating ~/.vmodules/bin`);
		fs.mkdirSync(vbin)
	}
	try {
		cp.execSync(`${vexe} -o ${vlsPath} ${vlsCmd}`);
	} catch {
		outputChannel.appendLine('Failed building VLS.');
		return false;
	}
	const isInstalled = await checkIsVlsInstalled();
	if (isInstalled) {
		outputChannel.appendLine(`Finished installing VLS.`);
	} else {
		outputChannel.appendLine(`Failed to install VLS.`);
	}
	return isInstalled;
}

export function connectVls(path: string, context: ExtensionContext) {
	const prepareStatus = window.createStatusBarItem(StatusBarAlignment.Left);

	// Path to VLS executable.
	// Server Options for STDIO
	const serverOptionsStd: ServerOptions = {
		command: path,
		args: [],
		transport: TransportKind.stdio
	};
	// LSP Client options
	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: "v" }],
		synchronize: {
			fileEvents: workspace.createFileSystemWatcher('**/*.v')
		}
	}

	client = new LanguageClient(
		"V Language Server",
		serverOptionsStd,
		clientOptions,
		true
	);

	prepareStatus.dispose();

	client.onReady()
		.then(() => {
			window.setStatusBarMessage('The V language server is ready.', 3000);
		})
		.catch(() => {
			window.setStatusBarMessage('The V language server failed to initialize.', 3000);
		});

	context.subscriptions.push(client.start());
}

export async function activateVls(context: ExtensionContext) {
	const customVlsPath = getWorkspaceConfig().get<string>("vls.path");
	if (!customVlsPath) {
		// if no vls path is given, try to used the installed one or install it.
		const installed = await checkIsVlsInstalled();
		if (installed) {
			connectVls(vlsPath, context);
		}
	} else {
		connectVls(customVlsPath, context);
	}
}

export async function deactivateVls() {
	if (!client) {
		return;
	}
	await client.stop();
}
