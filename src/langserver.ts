import cp from 'child_process';
import * as net from 'net';
import { window, workspace, ProgressLocation, Disposable } from 'vscode';
import { LanguageClient, LanguageClientOptions, StreamInfo, ServerOptions, CloseAction, ErrorAction } from 'vscode-languageclient/node';
import { terminate } from 'vscode-languageclient/lib/node/processes';

import { getVExecCommand, getWorkspaceConfig } from './utils';
import { log, outputChannel, vlsOutputChannel } from './status';
import { once } from 'events';

export let client: LanguageClient;
export let clientDisposable: Disposable;

let crashCount = 0;
let vlsProcess: cp.ChildProcess;

const vexe = getVExecCommand();
const defaultLauncherArgs: string[] = ['--json'];

function spawnLauncher(...args: string[]): cp.ChildProcess {
	const finalArgs: string[] = ['ls'].concat(...defaultLauncherArgs).concat(...args);
	log(`Spawning v ${finalArgs.join(' ')}...`);
	return cp.spawn(vexe, finalArgs);
}

export async function checkVlsInstallation(): Promise<boolean> {
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

function receiveLauncherJsonData(cb: (d: { message: string }) => void) {
	return (rawData: string | Buffer) => {
		if (typeof rawData == 'string') {
			log(`[v ls] new data: ${rawData}`);
			cb(JSON.parse(rawData));
		} else {
			log(`[v ls] new data from buffer: ${rawData.toString('utf8')}`);
			cb(JSON.parse(rawData.toString('utf8')));
		}
	};
}

function receiveLauncherErrorJsonData(cb: (d: { code: number, message: string }) => void) {
	return (rawData: string) => {
		cb(JSON.parse(rawData));
	};
}

export async function isVlsInstalled(): Promise<boolean> {
	let isInstalled = false;
	const launcher = spawnLauncher('--check');

	launcher.stdout.on('data', receiveLauncherJsonData(({ message }) => {
		if (!message.includes('not installed')) {
			isInstalled = true;
		}
	}));

	launcher.stderr.on('data', receiveLauncherErrorJsonData(({ message }) => {
		void window.showErrorMessage(message);
	}));

	await once(launcher, 'close');
	return isInstalled;
}

export function isVlsEnabled(): boolean {
	return getWorkspaceConfig().get<boolean>('vls.enable') ?? false;
}

export async function installVls(update = false): Promise<void> {
	try {
		await window.withProgress({
			location: ProgressLocation.Notification,
			title: 'Installing VLS',
			cancellable: true,
		}, async (progress, token) => {
			const launcher = spawnLauncher(update ? '--update' : '--install');
			token.onCancellationRequested(() => launcher.kill());

			launcher.stdout.on('data', receiveLauncherJsonData((payload) => {
				if (payload.message.includes('was updated') || payload.message.includes('was already updated')) {
					void window.showInformationMessage(payload.message);
				} else {
					progress.report(payload);
				}
			}));

			launcher.stderr.on('data', receiveLauncherErrorJsonData(({ code, message }) => {
				throw new Error(`Error (${code}): ${message}`);
			}));

			await once(launcher, 'close');
		});
	} catch (e) {
		log(e);
		outputChannel.show();
		if (e instanceof Error) {
			await window.showErrorMessage(e.message);
		} else {
			await window.showErrorMessage('Failed installing VLS. See output for more information.');
		}
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

export function connectVls(): void {
	let shouldSpawnProcess = true;

	const connMode = getWorkspaceConfig().get<string>('vls.connectionMode');
	const tcpPort = getWorkspaceConfig().get<number>('vls.tcpMode.port');

	// Arguments to be passed to VLS
	const vlsArgs: string[] = getWorkspaceConfig().get<string>('vls.customArgs').split(' ').filter(Boolean);
	const hasArg = (flag: string): boolean => vlsArgs.findIndex(a => a == flag || a.startsWith(flag)) != -1;
	const pushArg = (flags: string[], value?: string | number | boolean) => {
		if ((typeof value === 'string' && value.length == 0) || value === null) {
			return;
		}

		const validFlags = flags.filter(Boolean);
		if (validFlags.length != 0 && validFlags.every(flag => !hasArg(flag))) {
			if (typeof value === 'undefined' || (typeof value === 'boolean' && value)) {
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

		// This will instruct the extension to not skip launching
		// a new VLS process and use an existing one with TCP enabled instead.
		if (getWorkspaceConfig().get<boolean>('vls.tcpMode.useRemoteServer')) {
			shouldSpawnProcess = false;
		}
	}

	if (shouldSpawnProcess) {
		// Kill first the existing VLS process
		// before launching a new one.
		killVlsProcess();
		vlsProcess = spawnLauncher('--ls', ...vlsArgs);
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
		outputChannel: vlsOutputChannel,
		errorHandler: {
			closed() {
				crashCount++;
				if (crashCount < 5) {
					return CloseAction.Restart;
				}
				return CloseAction.DoNotRestart;
			},
			error(err, msg, count) {
				// taken from: https://github.com/golang/vscode-go/blob/HEAD/src/goLanguageServer.ts#L533-L539
				if (count < 5) {
					return ErrorAction.Continue;
				}
				void window.showErrorMessage(
					// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
					`VLS: Error communicating with the language server: ${err}: ${msg}.`
				);

				return ErrorAction.Shutdown;
			}
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

	// NOTE: the language client was removed in the context subscriptions
	// because of it's error-handling behavior which causes the progress/message
	// box to hang and produce unnecessary errors in the output/devtools log.
	clientDisposable = client.start();
}

export async function activateVls(): Promise<void> {
	if (!isVlsEnabled()) return;

	const customVlsPath = getWorkspaceConfig().get<string>('vls.customPath');
	if (customVlsPath) {
		defaultLauncherArgs.push('--path');
		defaultLauncherArgs.push(customVlsPath);
	}

	const installed = await checkVlsInstallation();
	if (installed) {
		connectVls();
	}
}

export function deactivateVls(): void {
	if (client) {
		clientDisposable.dispose();
	} else {
		killVlsProcess();
	}
}

export function killVlsProcess(): void {
	if (vlsProcess && !vlsProcess.killed) {
		log('Terminating existing VLS process.');
		terminate(vlsProcess);
	}
}
