import { registerCommands, registerVlsCommands } from "commands"
import { getVls, isVlsEnabled } from "langserver"
import { log, outputChannel, vlsOutputChannel } from "logger"
import vscode, { ConfigurationChangeEvent, ExtensionContext, workspace } from "vscode"
import { LanguageClient, LanguageClientOptions, ServerOptions } from "vscode-languageclient/node"
import { installV, isVInstalled } from "./utils"
import { migratedSetting } from "./settings"
import { registerVTasks, runCodeLensCommand, vCommandForServer } from "./vTasks"

export let client: LanguageClient | undefined

function isInlayHintsEnabled(): boolean {
	return migratedSetting("v.vls", "inlayHints.enabled", "vls", "inlayHints.enabled", true)
}

async function sendVlsSettings(runningClient: LanguageClient): Promise<void> {
	await runningClient.sendNotification("workspace/didChangeConfiguration", {
		settings: {
			vls: {
				inlayHints: { enabled: isInlayHintsEnabled() },
				diagnostics: {
					enabled: migratedSetting(
						"v.vls",
						"diagnostics",
						"vls",
						"diagnostics.enabled",
						true,
					),
				},
			},
		},
	})
}

async function createAndStartClient(taskManager: ReturnType<typeof registerVTasks>): Promise<void> {
	const vlsPath = getVls()
	const vlsArgs = migratedSetting("v.vls", "args", "vls", "args", [] as string[])
	const activeFolder = vscode.window.activeTextEditor
		? workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
		: undefined
	const vCommand = vCommandForServer(activeFolder ?? workspace.workspaceFolders?.[0])
	const serverEnvironment = { ...process.env }
	if (vCommand) serverEnvironment.VLS_V_COMMAND = vCommand

	const serverOptions: ServerOptions = {
		run: { command: vlsPath, args: vlsArgs, options: { env: serverEnvironment } },
		debug: { command: vlsPath, args: vlsArgs, options: { env: serverEnvironment } },
	}

	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: "file", language: "v" }],
		outputChannel: vlsOutputChannel,
		synchronize: {
			fileEvents: vscode.workspace.createFileSystemWatcher("**/*.v"),
		},
		middleware: {
			provideInlayHints: async (document, range, token, next) => {
				if (!isInlayHintsEnabled()) {
					return []
				}
				return next(document, range, token)
			},
			executeCommand: async (command, args, next) => {
				if (command === "vls.runFile" || command === "vls.runTests") {
					await runCodeLensCommand(command, args, taskManager)
					return undefined
				}
				return (await next(command, args)) as unknown
			},
		},
	}

	const nextClient = new LanguageClient("vls", "V Language Server", serverOptions, clientOptions)
	client = nextClient
	vscode.window.showInformationMessage("V Language Server is starting.")
	try {
		await nextClient.start()
		await sendVlsSettings(nextClient)
		vscode.window.showInformationMessage("V Language Server is now active.")
	} catch (error) {
		client = undefined
		throw error
	}
}

export async function activate(context: ExtensionContext): Promise<void> {
	// Register output channels so users can open them even without VLS.
	context.subscriptions.push(outputChannel, vlsOutputChannel)
	const taskManager = registerVTasks(context)

	// Check for V only if it's not installed
	if (!(await isVInstalled())) {
		const selection = await vscode.window.showInformationMessage(
			"The V programming language is not detected on this system. Would you like to install it?",
			{ modal: true }, // Modal makes the user have to choose before continuing
			"Yes",
			"No",
		)

		if (selection === "Yes") {
			await installV()
		}
	}

	// Register commands regardless of whether VLS is enabled
	await registerCommands(context)

	// Only start the language server if the user enabled it in settings.
	if (isVlsEnabled()) {
		try {
			await createAndStartClient(taskManager)
		} catch (err) {
			// If starting the client fails, log and continue. Users can still
			// use non-LSP features of the extension.
			console.error("Failed to start VLS:", err)
			vscode.window.showErrorMessage("Failed to start VLS. See output for details.")
			vlsOutputChannel.show()
		}
	} else {
		log("VLS is disabled in settings.")
	}

	registerVlsCommands(context, () => client)

	const inlayHintsEmitter = new vscode.EventEmitter<void>()
	context.subscriptions.push(inlayHintsEmitter)
	context.subscriptions.push(
		vscode.languages.registerInlayHintsProvider(
			{ scheme: "file", language: "v" },
			{
				onDidChangeInlayHints: inlayHintsEmitter.event,
				provideInlayHints: () => [],
			},
		),
	)

	// React to configuration changes: enable/disable or request restart.
	context.subscriptions.push(
		workspace.onDidChangeConfiguration(async (e: ConfigurationChangeEvent) => {
			const vlsEnabled = isVlsEnabled()

			if (
				e.affectsConfiguration("v.vls.inlayHints.enabled") ||
				e.affectsConfiguration("vls.inlayHints.enabled")
			) {
				inlayHintsEmitter.fire()
			}
			if (
				client &&
				(e.affectsConfiguration("v.vls.inlayHints.enabled") ||
					e.affectsConfiguration("vls.inlayHints.enabled") ||
					e.affectsConfiguration("v.vls.diagnostics") ||
					e.affectsConfiguration("vls.diagnostics.enabled"))
			) {
				await sendVlsSettings(client)
			}

			if (e.affectsConfiguration("v.vls.enable")) {
				if (vlsEnabled && !client) {
					// Start the client now that the user enabled it.
					try {
						await createAndStartClient(taskManager)
					} catch (err) {
						console.error("Failed to start VLS:", err)
						vscode.window.showErrorMessage(
							"Failed to start VLS. See output for details.",
						)
						vlsOutputChannel.show()
					}
				} else if (!vlsEnabled && client) {
					// Stop the client if it was running and the user disabled it.
					try {
						await client.stop()
						log("VLS has been stopped.")
					} catch {
						// Ignore shutdown errors; the process may already have exited.
					}
					client = undefined
				}
			} else if (
				(e.affectsConfiguration("v.vls.command") ||
					e.affectsConfiguration("v.vls.args") ||
					e.affectsConfiguration("vls.command") ||
					e.affectsConfiguration("vls.args") ||
					e.affectsConfiguration("v.executablePath") ||
					e.affectsConfiguration("vls.vCommand")) &&
				vlsEnabled &&
				client
			) {
				void vscode.window
					.showInformationMessage(
						"VLS: Restart is required for changes to take effect. Proceed?",
						"Yes",
						"No",
					)
					.then(async (selected) => {
						if (selected === "Yes") {
							try {
								if (client) {
									await client.stop()
									client = undefined
									await createAndStartClient(taskManager)
								}
							} catch {
								client = undefined
								void vscode.window.showErrorMessage("Failed to restart VLS.")
							}
						}
					})
			}
		}),
	)
}

export function deactivate(): Promise<void> | undefined {
	if (!client) return undefined
	return client.stop()
}
