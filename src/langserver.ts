import os from 'os';
import path from 'path';
import fs from 'fs';
import cp from 'child_process';
import util from 'util';
import { window, StatusBarAlignment, ExtensionContext, workspace, ProgressLocation } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient";

import { getVExecCommand, getWorkspaceConfig } from './utils';
import { outputChannel } from './status';

const execAsync = util.promisify(cp.exec);
const mkdirAsync = util.promisify(fs.mkdir);
const existsAsync = util.promisify(fs.exists);

const vmodules = path.join(os.homedir(), '.vmodules');
const vbin = path.join(vmodules, 'bin');
const vexe = getVExecCommand();
const isWin = process.platform === "win32";
export const vlsPath = path.join(vbin, isWin ? 'vls.exe' : 'vls');
export let client: LanguageClient;

export async function checkIsVlsInstalled(): Promise<boolean> {
	const vlsInstalled = await isVlsInstalled();
	if (!vlsInstalled) {
		const selected = await window.showInformationMessage('VLS is not installed. Do you want to install it now?', 'Yes', 'No')
		if (selected === 'Yes') {
			await installVls()
			return await isVlsInstalled();
		} else {
			return false;
		}
	}
	return true;
}

export async function isVlsInstalled(): Promise<boolean> {
	return await existsAsync(vlsPath);
}

export async function installVls() {
	try {
		await window.withProgress({
			location: ProgressLocation.Notification,
			title: 'Installing VLS',
			cancellable: false,
		}, async progress => {
			const vlsCmd = path.join(vmodules, 'vls', 'cmd', 'vls');
			progress.report({ message: 'Fetching module' });
			await execAsync(`v install vls`, { maxBuffer: Infinity });
			progress.report({ message: 'Creating ~/.vmodules/bin' });
			// build vls module to ~/.vmodules/bin
			const existsVBin = await existsAsync(vbin);
			if (!existsVBin) {
				await mkdirAsync(vbin)
			}
			progress.report({ message: 'Building module' });
			await execAsync(`${vexe} -prod -o ${vlsPath} ${vlsCmd}`, { maxBuffer: Infinity });
		});
	} catch (e) {
		outputChannel.appendLine(e);
		await window.showErrorMessage('Failed installing VLS. See output for more information.');
	}
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
	const customVlsPath = getWorkspaceConfig().get<string>("vls.customPath");
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
