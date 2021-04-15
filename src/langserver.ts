import os from "os";
import path from "path";
import fs from "fs";
import cp, { exec, spawn } from "child_process";
import util from "util";
import {
	window,
	ExtensionContext,
	workspace,
	ProgressLocation,
	WorkspaceFolder,
	RelativePattern,
} from "vscode";
import {
	CloseAction,
	ErrorAction,
	LanguageClient,
	LanguageClientOptions,
	Message,
	RevealOutputChannelOn,
	ServerOptions,
	TransportKind,
	VersionedTextDocumentIdentifier,
} from "vscode-languageclient/lib/node/main";
import { timestampString } from "./format";

import { getVExecCommand, getWorkspaceConfig } from "./utils";
import { outputChannel, statusBar } from "./status";
import { clients } from "./client";

const execAsync = util.promisify(cp.exec);
const mkdirAsync = util.promisify(fs.mkdir);
const existsAsync = util.promisify(fs.exists);

const vlsDir = path.join(os.homedir(), ".vls");
const vlsBin = path.join(vlsDir, "bin");
const vexe = getVExecCommand();
const isWin = process.platform === "win32";
export const vlsPath = path.join(vlsBin, isWin ? "vls.exe" : "vls");
export async function checkIsVlsInstalled(): Promise<boolean> {
	const vlsInstalled = await isVlsInstalled();
	if (!vlsInstalled) {
		const selected = await window.showInformationMessage(
			"VLS is not installed. Do you want to install it now?",
			"Yes",
			"No"
		);
		if (selected === "Yes") {
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

export async function installVls() {
	try {
		await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: "Installing VLS",
				cancellable: false,
			},
			async (progress) => {
				progress.report({ message: "Fetching module" });
				const existsVlsDir = await existsAsync(vlsDir);
				if (existsVlsDir) {
					await execAsync("git clean -xf", {
						maxBuffer: Infinity,
						cwd: vlsDir,
					});
					await execAsync("git pull --rebase origin master", {
						maxBuffer: Infinity,
						cwd: vlsDir,
					});
				} else {
					await execAsync(
						`git clone --single-branch https://github.com/vlang/vls ${vlsDir}`,
						{ maxBuffer: Infinity }
					);
				}
				progress.report({ message: "Creating ~/.vls/bin" });
				// build vls module to ~/.vmodules/bin
				const existsVBin = await existsAsync(vlsBin);
				if (!existsVBin) {
					await mkdirAsync(vlsBin);
				}
				progress.report({ message: "Building module" });
				// TODO: add -gc boehm when libgc library is not needed anymore
				await execAsync(`${vexe} -prod -o ${vlsPath} cmd/vls`, {
					maxBuffer: Infinity,
					cwd: vlsDir,
				});
			}
		);
	} catch (e) {
		outputChannel.appendLine(e);
		await window.showErrorMessage(
			"Failed installing VLS. See output for more information."
		);
	}
}

export async function connectVls(
	folder: WorkspaceFolder,
	path: string,
	context: ExtensionContext
): Promise<LanguageClient | null> {
	// Arguments to be passed to VLS
	let vlsArgs = [];

	const config = workspace.getConfiguration("v", folder);
	const enableFeatures = config.get<string>("vls.enableFeatures", "");
	const disableFeatures = config.get<string>(
		"vls.disableFeatures",
		"textDocument/formatting"
	);
	if (enableFeatures && enableFeatures.length > 0) {
		vlsArgs.push(`--enable=${enableFeatures}`);
	}

	if (disableFeatures && disableFeatures.length > 0) {
		vlsArgs.push(`--disable=${disableFeatures}`);
	}

	outputChannel.appendLine(
		`[${timestampString()}] Starting V Language Server...\n		Workspace: ${
			folder.uri.fsPath
		}\n		Args: ${JSON.stringify(vlsArgs)}\n		VLS Binary: ${path}`
	);

	const serverOptions: ServerOptions = {
		command: path,
		args: vlsArgs,
		transport: TransportKind.stdio,
		options: {
			cwd: folder.uri.fsPath,
			env: process.env,
		},
	};

	const relativePattern = new RelativePattern(folder, `**/*.v`);
	const workspaceWatcher = workspace.createFileSystemWatcher(
		relativePattern,
		false,
		false,
		false
	);

	const errorHandler = {
		restartCount: 0,
		error: (err, message, count) => {
			console.error(err, message);
			outputChannel.append(
				`[VLS Error] ${err.name} - ${err.message || message}}\n${err.stack}`
			);

			if (count > 1) {
				return ErrorAction.Shutdown;
			}

			return ErrorAction.Continue;
		},
		closed: () => {
			if (errorHandler.restartCount < 2) {
				errorHandler.restartCount++;
				return CloseAction.Restart;
			}
			statusBar.enableAutoShow = true;
			return CloseAction.DoNotRestart;
		},
	};

	// LSP Client options
	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: "file", language: "v" }],
		workspaceFolder: folder,
		errorHandler,
		synchronize: {
			fileEvents: workspaceWatcher,
		},
	};

	const client = new LanguageClient(
		`vlang-${folder.uri.fsPath}`,
		`V Language Server`,
		serverOptions,
		clientOptions,
		true
	);

	const orig = client.handleFailedRequest;
	client.handleFailedRequest = (message, err, defaultV) => {
		outputChannel.append(err.toString());
		return orig(message, err, defaultV);
	};
	const onReady = client.onReady();

	context.subscriptions.push(client.start(), workspaceWatcher);
	try {
		await onReady;
		window.setStatusBarMessage("The V language server is ready.", 3000);
		context = null;
		outputChannel.appendLine(`[${timestampString()}] Started V Language Server!`);
		return client;
	} catch (err) {
		window.showErrorMessage(`V: ${err.toString()}`);
		console.error(err);
		context = null;
		return null;
	}
}

export async function activateVls(folder: WorkspaceFolder, context: ExtensionContext) {
	const customVlsPath = workspace
		.getConfiguration("v", folder)
		.get<string>("vls.customPath");
	if (!customVlsPath) {
		const installed = await checkIsVlsInstalled();
		if (installed) {
			return await connectVls(folder, vlsPath, context);
		}
	}

	return await connectVls(folder, customVlsPath, context);
}

export async function deactivateVls() {
	for (let [id, client] of clients.entries()) {
		try {
			await client.stop();
		} catch (exception) {
			console.error(exception);
		}
		clients.delete(id);
	}
}
