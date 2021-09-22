import os from 'os';
import path from 'path';
import fs from 'fs';
import cp from 'child_process';
import util from 'util';
import * as net from 'net';
import { window, workspace, ProgressLocation } from 'vscode';
import { LanguageClient, LanguageClientOptions, StreamInfo, ServerOptions } from 'vscode-languageclient/node';

import { getVExecCommand, getWorkspaceConfig } from './utils';
import { outputChannel, vlsOutputChannel } from './status';

const execAsync = util.promisify(cp.exec);
const mkdirAsync = util.promisify(fs.mkdir);
const existsAsync = util.promisify(fs.exists);

const vlsDir = path.join(os.homedir(), '.vls');
const vlsBin = path.join(vlsDir, 'bin');
const vexe = getVExecCommand();
const isWin = process.platform === 'win32';
export let vlsPath = path.join(vlsBin, isWin ? 'vls.exe' : 'vls');
export let client: LanguageClient;
let vlsProcess: cp.ChildProcess;
let shouldSpawnProcess = true;

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

export function isVlsEnabled(): boolean {
	return getWorkspaceConfig().get<boolean>('vls.enable') ?? false;
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

function connectVlsViaTcp(port: number): Promise<StreamInfo> {
	const socket = net.connect({ port });
	const result: StreamInfo = {
		writer: socket,
		reader: socket
	};
	return Promise.resolve(result);
}

export function connectVls(pathToVls: string): void {
	const connMode = getWorkspaceConfig().get<string>('vls.connectionMode');
	const tcpPort = getWorkspaceConfig().get<number>('vls.tcpMode.port');

	// Arguments to be passed to VLS
	const vlsArgs: string[] = getWorkspaceConfig().get<string>('vls.customArgs').split(' ').filter(Boolean);
	const hasArg = (flag: string): boolean => vlsArgs.findIndex(a => a == flag || a.startsWith(flag)) != -1;
	const pushArg = (flags: string[], value?: string | number | boolean) => {
		if ((typeof value == 'string' && value.length == 0) || value == null) {
			return;
		}

		const validFlags = flags.filter(Boolean);
		if (validFlags.length != 0 && validFlags.every(flag => !hasArg(flag))) {
			if (typeof value == 'undefined' || (typeof value == 'boolean' && value)) {
				vlsArgs.push(validFlags[0]);
			} else {
				vlsArgs.push(`${validFlags[0]}=${value.toString()}`);
			}
		}
	};

	pushArg(['--enable', '-e'], getWorkspaceConfig().get<string>('vls.enableFeatures'));
	pushArg(['--disable', '-d'], getWorkspaceConfig().get<string>('vls.disableFeatures'));
	pushArg(['--vroot'], getWorkspaceConfig().get<string>('vls.customVrootPath'));
	pushArg(['--debug'], getWorkspaceConfig().get<boolean>('vls.debug'));

	if (connMode == 'tcp') {
		pushArg(['--socket']);
		pushArg(['--port'], tcpPort);

		// This will instruct the client to not launch the VLS process
		// and use an existing one with TCP enabled.
		if (getWorkspaceConfig().get<boolean>('vls.tcpMode.useRemoteServer')) {
			shouldSpawnProcess = false;
		}
	}

	if (shouldSpawnProcess) {
		// Kill first the existing VLS process
		// before launching a new one.
		terminateVlsProcess();

		console.log('Spawning VLS process...');
		vlsProcess = cp.spawn(pathToVls.trim(), vlsArgs);
	}

	const serverOptions: ServerOptions = connMode == 'tcp'
											? () => connectVlsViaTcp(tcpPort)
											: () => Promise.resolve(vlsProcess);

	// LSP Client options
	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'v' }],
		synchronize: {
			fileEvents: workspace.createFileSystemWatcher('**/*.v')
		},
		outputChannel: vlsOutputChannel
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

	// NOTE: the language client was remove in the context subscriptions
	// because of it's error-handling behavior which causes the progress/message
	// box to hang and produce unnecessary errors in the output/devtools log.
	client.start();
}

export async function activateVls(): Promise<void> {
	if (!isVlsEnabled()) return;
	const customVlsPath = getWorkspaceConfig().get<string>('vls.customPath');
	if (!customVlsPath) {
		// if no vls path is given, try to used the installed one or install it.
		const installed = await checkIsVlsInstalled();
		if (installed) {
			connectVls(vlsPath);
		}
	} else {
		// It is very important to set this or start/stopping
		// the VLS process won't work.
		vlsPath = customVlsPath;
		connectVls(customVlsPath);
	}
}

export async function deactivateVls(): Promise<void> {
	if (client && isVlsEnabled()) {
		return client.stop();
	}
}

export function terminateVlsProcess(): void {
	if (shouldSpawnProcess && typeof vlsProcess != 'undefined' && vlsProcess && !vlsProcess.killed) {
		vlsProcess.kill();
	}
}
