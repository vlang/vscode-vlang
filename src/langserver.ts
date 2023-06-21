import cp, { ChildProcess } from 'child_process';
import * as net from 'net';
import { window, workspace, ProgressLocation } from 'vscode';
import { LanguageClient, LanguageClientOptions, StreamInfo, ServerOptions, CloseAction, ErrorAction } from 'vscode-languageclient/node';
import { terminate } from 'vscode-languageclient/lib/node/processes';

import { getVExecCommand, getWorkspaceConfig } from './utils';
import { log, outputChannel, vlsOutputChannel } from './debug';
import { once } from 'events';

export let client: LanguageClient;

let crashCount = 0;
let vlsProcess: cp.ChildProcess;

const vexe = getVExecCommand();
const defaultLauncherArgs: string[] = ['--json'];

function spawnLauncher(...args: string[]): cp.ChildProcess {
	const finalArgs: string[] = ['ls'].concat(...defaultLauncherArgs).concat(...args);
	log(`Spawning v ${finalArgs.join(' ')}...`);
	return cp.spawn(vexe, finalArgs, {shell: true});
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

interface CBInput {
	error?: { code: number, message: string },
	message: string
}

function receiveLauncherJsonData(cb: (d: CBInput) => void) {
	return (rawData: string | Buffer) => {
		const data = typeof rawData === 'string' ? rawData : rawData.toString('utf8');
		const escapedData: string = data.replace(/\\/g, '/'); // replace backslashes found in Windows paths to prevent JSON parsing errors, TODO: proper JSON escaping solution needed
		log(`[v ls] new data: ${data}\tescaped: ${escapedData}`);
		cb(JSON.parse(escapedData) as CBInput);
	};
}

function receiveLauncherError(rawData: string | Buffer) {
	const msg = typeof rawData === 'string' ? rawData : rawData.toString('utf8');
	const launcherMessage = `[v ls] error: ${msg}`;
	log(launcherMessage);
	void window.showErrorMessage(launcherMessage);
}

export async function isVlsInstalled(): Promise<boolean> {
	let isInstalled = false;
	const launcher = spawnLauncher('--check');

	launcher.stdout.on('data', receiveLauncherJsonData(({ error, message }) => {
		if (error) {
			void window.showErrorMessage(`Error (${error.code}): ${error.message}`);
		} else if (!message.includes('not installed')) {
			isInstalled = true;
		}
	}));

	launcher.stderr.on('data', receiveLauncherError);
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
			title: update ? 'Updating VLS' : 'Installing VLS',
			cancellable: true,
		}, async (progress, token) => {
			const launcher = spawnLauncher(update ? '--update' : '--install');
			token.onCancellationRequested(() => launcher.kill());

			launcher.stdout.on('data', receiveLauncherJsonData((payload) => {
				if (payload.error) {
					void window.showErrorMessage(`Error (${payload.error.code}): ${payload.error.message}`);
				} else if (payload.message.includes('was updated') || payload.message.includes('was already updated')) {
					void window.showInformationMessage(payload.message);
				} else {
					progress.report(payload);
				}
			}));

			launcher.stderr.on('data', receiveLauncherError);
			await once(launcher, 'close');
		});
	} catch (e) {
		log((e as Error).toString());
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

	const config = getWorkspaceConfig();
	const connMode = config.get<string>('vls.connectionMode');
	const tcpPort = config.get<number>('vls.tcpMode.port');

	// Arguments to be passed to VLS
	const vlsArgs: string[] = config.get<string>('vls.customArgs').split(' ').filter(Boolean);
	const hasArg = (flag: string): boolean => vlsArgs.findIndex(a => a === flag || a.startsWith(flag)) !== -1;
	const pushArg = (flags: string[], value?: string | number | boolean) => {
		if ((typeof value === 'string' && value.length === 0) || value === null) {
			return;
		}

		const validFlags = flags.filter(Boolean);
		if (validFlags.length !== 0 && validFlags.every(flag => !hasArg(flag))) {
			if (typeof value === 'undefined' || (typeof value === 'boolean' && value)) {
				vlsArgs.push(validFlags[0]);
			} else {
				vlsArgs.push(`${validFlags[0]}=${value.toString()}`);
			}
		}
	};

	pushArg(['--enable', '-e'], config.get<string>('vls.enableFeatures'));
	pushArg(['--disable', '-d'], config.get<string>('vls.disableFeatures'));
	pushArg(['--vroot'], config.get<string>('vls.customVrootPath'));
	pushArg(['--debug'], config.get<boolean>('vls.debug'));

	if (connMode === 'tcp') {
		pushArg(['--socket']);
		pushArg(['--port'], tcpPort);

		// This will instruct the extension to not skip launching
		// a new VLS process and use an existing one with TCP enabled instead.
		if (config.get<boolean>('vls.tcpMode.useRemoteServer')) {
			shouldSpawnProcess = false;
		}
	}

	if (shouldSpawnProcess) {
		// Kill first the existing VLS process
		// before launching a new one.
		killVlsProcess();
		vlsProcess = spawnLauncher('--ls', ...vlsArgs);
	}

	const serverOptions: ServerOptions = connMode === 'tcp'
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
					return { action: CloseAction.Restart };
				}
				return { action: CloseAction.DoNotRestart };
			},
			error(err, msg, count) {
				// taken from: https://github.com/golang/vscode-go/blob/HEAD/src/goLanguageServer.ts#L533-L539
				if (count < 5) {
					return { action: ErrorAction.Continue};
				}
				void window.showErrorMessage(
					// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
					`VLS: Error communicating with the language server: ${err}: ${msg}.`
				);

				return { action: ErrorAction.Shutdown};
			}
		},
	};

	client = new LanguageClient(
		'V Language Server',
		serverOptions,
		clientOptions,
		true
	);

	client.start()
		.then(() => {
			window.setStatusBarMessage('The V language server is ready.', 3000);
		})
		.catch(() => {
			window.setStatusBarMessage('The V language server failed to initialize.', 3000);
		});
}

export async function activateVls(): Promise<void> {
	if (!isVlsEnabled()) return;

	const customVlsPath = getWorkspaceConfig().get<string>('vls.customPath');
	if (customVlsPath && customVlsPath.trim().length !== 0) {
		defaultLauncherArgs.push('--path');
		defaultLauncherArgs.push(customVlsPath);
	}

	const installed = await checkVlsInstallation();
	if (installed) {
		connectVls();
	}
}

export async function deactivateVls(): Promise<void> {
	if (client) {
		await client.dispose();
	} else {
		killVlsProcess();
	}
}

export function killVlsProcess(): void {
	if (vlsProcess && !vlsProcess.killed) {
		log('Terminating existing VLS process.');
		// Not sure, how the terminate function works
		// but it requires pid which is not present in the
		// vlsProcess currently. For now, I am keeping it
		// to make eslint happy. This should not brake it
		// even more than it already was.
		// TODO: Investigate further
		terminate(vlsProcess as unknown as ChildProcess & { pid: number });
	}
}
