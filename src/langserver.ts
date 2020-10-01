import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient";
import { clearTempFolder, getWorkspaceConfig } from "./utils";
import * as net from "net";
import { ExtensionContext, window, StatusBarAlignment, workspace } from "vscode";

export let client: LanguageClient;
export function activateLSP(context: ExtensionContext) {
	let prepareStatus = window.createStatusBarItem(StatusBarAlignment.Left);
	console.log("Commencing V language server...");
	if (!getWorkspaceConfig().get("vls.enable")) {
		return;
	}
	// Path to VLS executable.
	const serverPath: string = getWorkspaceConfig().get("vls.path");
	// Server Options for STDIO
	const serverOptionsStd: ServerOptions = {
		command: serverPath,
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
		"vLanguageServer",
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
