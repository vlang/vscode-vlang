import os from 'os';
import path from 'path';
import fs from 'fs';
import cp from 'child_process';
import util from 'util';
import { window, ExtensionContext, workspace, ProgressLocation } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

import { getVExecCommand, getWorkspaceConfig } from './utils';
import { outputChannel } from './status';

const execAsync = util.promisify(cp.exec);
const mkdirAsync = util.promisify(fs.mkdir);
const existsAsync = util.promisify(fs.exists);

const vlsDir = path.join(os.homedir(), '.vls');
const vlsBin = path.join(vlsDir, 'bin');
const vexe = getVExecCommand();
const isWin = process.platform === 'win32';
export const vlsPath = path.join(vlsBin, isWin ? 'vls.exe' : 'vls');
export let client: LanguageClient;

export async function checkIsVlsInstalled(): Promise<boolean> {
	const vlsInstalled = await isVlsInstalled();
	if (!vlsInstalled) {
		const selected = await window.showInformationMessage('VLS is not installed. Do you want to install it now?', 'Yes', 'No');
		if (selected === 'Yes') {
			await installVls();
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

export async function installVls(): Promise<void> {
	try {
		await window.withProgress({
			location: ProgressLocation.Notification,
			title: 'Installing VLS',
			cancellable: false,
		}, async (progress) => {
			progress.report({ message: 'Fetching module' });
			const existsVlsDir = await existsAsync(vlsDir);
			if (existsVlsDir) {
				await execAsync('git clean -xf', { maxBuffer: Infinity, cwd: vlsDir });
				await execAsync('git pull --rebase origin master', { maxBuffer: Infinity, cwd: vlsDir });
			} else {
				await execAsync(`git clone --single-branch https://github.com/vlang/vls ${vlsDir}`, { maxBuffer: Infinity });
			}
			progress.report({ message: 'Creating ~/.vls/bin' });
			// build vls module to ~/.vmodules/bin
			const existsVBin = await existsAsync(vlsBin);
			if (!existsVBin) {
				await mkdirAsync(vlsBin);
			}
			progress.report({ message: 'Building module' });
			// TODO: add -gc boehm when libgc library is not needed anymore
			await execAsync(`${vexe} -prod -o ${vlsPath} cmd/vls`, { maxBuffer: Infinity, cwd: vlsDir });
		});
	} catch (e) {
		outputChannel.appendLine(e);
		outputChannel.show();
		await window.showErrorMessage('Failed installing VLS. See output for more information.');
	}
}

export function connectVls(pathToVls: string, context: ExtensionContext): void {
	// Arguments to be passed to VLS
	const vlsArgs: string[] = [];

	const isDebug = getWorkspaceConfig().get<boolean>('vls.debug');
	const customVrootPath = getWorkspaceConfig().get<string>('vls.customVrootPath');
	const enableFeatures = getWorkspaceConfig().get<string>('vls.enableFeatures');
	const disableFeatures = getWorkspaceConfig().get<string>('vls.disableFeatures');
	if (enableFeatures.length > 0) {
		vlsArgs.push(`--enable=${enableFeatures}`);
	}
	if (disableFeatures.length > 0) {
		vlsArgs.push(`--disable=${disableFeatures}`);
	}
	if (customVrootPath.length != 0) {
		vlsArgs.push(`--vroot=${customVrootPath}`);
	}
	if (isDebug) {
		vlsArgs.push('--debug');
	}

	// Path to VLS executable.
	// Server Options for STDIO
	const serverOptions: ServerOptions = {
		command: pathToVls,
		args: vlsArgs,
		transport: TransportKind.stdio
	};
	// LSP Client options
	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'v' }],
		synchronize: {
			fileEvents: workspace.createFileSystemWatcher('**/*.v')
		},
	};

	client = new LanguageClient(
		'V Language Server',
		serverOptions,
		clientOptions,
		true
	);

	client.onReady()
		.then(() => {
			window.setStatusBarMessage('The V language server is ready.', 3000);
		})
		.catch(() => {
			window.setStatusBarMessage('The V language server failed to initialize.', 3000);
		});

	context.subscriptions.push(client.start());
}

export async function activateVls(context: ExtensionContext): Promise<void> {
	const customVlsPath = getWorkspaceConfig().get<string>('vls.customPath');
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

export async function deactivateVls(): Promise<void> {
	if (!client) {
		return;
	}
	await client.stop();
}
