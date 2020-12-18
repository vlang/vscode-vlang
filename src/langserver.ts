import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient";
import { getWorkspaceConfig } from "./utils";
import { ExtensionContext, window, StatusBarAlignment, workspace } from "vscode";

export let client: LanguageClient;
export function activateLsp(context: ExtensionContext) {
	let prepareStatus = window.createStatusBarItem(StatusBarAlignment.Left);
	const vlsPath: string = getWorkspaceConfig().get("vls.path");

	console.log("Commencing V language server...");
	// Path to VLS executable.
	// Server Options for STDIO
	const serverOptionsStd: ServerOptions = {
		command: vlsPath,
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
