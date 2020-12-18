import os from 'os';
import path from 'path';
import fs from 'fs';
import cp from 'child_process';
import vscode, { StatusBarAlignment, ExtensionContext } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient";

import { outputChannel } from './status';
import { getVExecCommand, getWorkspaceConfig } from './utils';

const vmodules = path.join(os.homedir(), '.vmodules');
const vbin = path.join(vmodules, 'bin');
const vexe = getVExecCommand();
export const vlsPath = path.join(vbin, 'vls');
export let client: LanguageClient;

export async function checkVlsInstalled(): Promise<boolean> {
	const vlsExists = fs.existsSync(vlsPath);
	if (!vlsExists) {
		const selected = await vscode.window.showInformationMessage('VLS is not installed. Do you want to install it now?', 'Yes', 'No')
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
	const vlsModule = path.join(vmodules, 'vls');
	const vlsCmd = path.join(vlsModule, 'cmd', 'vls')
	// TODO: cp.execFileSync(`${vexe} install vls`);
	if (fs.existsSync(vlsModule)) {
		// modules already downloaded, update it
		outputChannel.appendLine(`cd ${vlsModule} && git pull`);
		try {
			cp.execSync(`cd ${vlsModule} && git pull`);
		} catch {
			outputChannel.appendLine('Failed updating VLS.');
			return false;
		}
	} else {
		outputChannel.appendLine(`git clone https://github.com/vlang/vls ${vlsModule}`);
		try {
			cp.execSync(`git clone https://github.com/vlang/vls ${vlsModule}`);
		} catch {
			outputChannel.appendLine('Failed cloning VLS.');
			return false;
		}
	}
	// build vls module to ~/.vmodules/bin
	if (!fs.existsSync(vbin)) {
		outputChannel.appendLine(`Creating ~/.vmodules/bin`);
		fs.mkdirSync(vbin)
	}
	outputChannel.appendLine(`${vexe} -o ${vlsPath} ${vlsCmd}`);
	try {
		cp.execSync(`${vexe} -o ${vlsPath} ${vlsCmd}`);
	} catch {
		outputChannel.appendLine('Failed building VLS.');
		return false;
	}
	const isInstalled = await checkVlsInstalled();
	if (isInstalled) {
		outputChannel.appendLine(`Finished installing VLS.`);
	} else {
		outputChannel.appendLine(`Failed to install VLS.`);
	}
	return isInstalled;
}

export function activateLsp(path: string, context: ExtensionContext) {
	const prepareStatus = vscode.window.createStatusBarItem(StatusBarAlignment.Left);

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
			fileEvents: vscode.workspace.createFileSystemWatcher('**/*.v')
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
			vscode.window.setStatusBarMessage('The V language server is ready.', 3000);
		})
		.catch(() => {
			vscode.window.setStatusBarMessage('The V language server failed to initialize.', 3000);
		});

	context.subscriptions.push(client.start());
}
