import { registerCommands, registerVlsCommands } from "commands"
import { getVls, isVlsEnabled } from "langserver"
import { log, outputChannel, vlsOutputChannel } from "logger"
import vscode, { ConfigurationChangeEvent, ExtensionContext, workspace } from "vscode"
import { LanguageClient, LanguageClientOptions, ServerOptions } from "vscode-languageclient/node"
import { installV, isVInstalled } from "./utils"
import { migratedSetting } from "./settings"
import { registerVTasks, runCodeLensCommand, vCommandForServer } from "./vTasks"
import { presentVlsStatus, vlsServerSettings, VlsStatus } from "./vlsState"

export let client: LanguageClient | undefined

/** Reports where the server is without interrupting, and opens its output on click. */
let statusItem: vscode.StatusBarItem | undefined
/** Set while a restart is in flight, so two rapid setting changes cannot interleave. */
let restarting = false

function isInlayHintsEnabled(): boolean {
	return migratedSetting("v.vls", "inlayHints.enabled", "vls", "inlayHints.enabled", true)
}

function isDiagnosticsEnabled(): boolean {
	return migratedSetting("v.vls", "diagnostics", "vls", "diagnostics.enabled", true)
}

function setStatus(next: VlsStatus): void {
	const presentation = presentVlsStatus(next)
	if (!statusItem) {
		statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0)
		statusItem.command = "v.vls.openOutput"
	}
	statusItem.text = presentation.text
	statusItem.tooltip = presentation.tooltip
	statusItem.show()
}

async function sendVlsSettings(runningClient: LanguageClient): Promise<void> {
	await runningClient.sendNotification(
		"workspace/didChangeConfiguration",
		vlsServerSettings(isInlayHintsEnabled(), isDiagnosticsEnabled()),
	)
}

/** Report a start or restart failure where the user can act on it. */
function reportFailure(action: string, error: unknown): void {
	vlsOutputChannel.error(`Failed to ${action}: ${describeError(error)}`)
	vscode.window.showErrorMessage(`Failed to ${action}. See output for details.`)
}

function describeError(error: unknown): string {
	if (error instanceof Error) {
		return error.message
	}
	if (typeof error === "string") {
		return error
	}
	try {
		return JSON.stringify(error)
	} catch {
		return "an unreadable error value"
	}
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
	setStatus("starting")
	try {
		await nextClient.start()
		await sendVlsSettings(nextClient)
		setStatus("active")
	} catch (error) {
		client = undefined
		setStatus("error")
		throw error
	}
}

/** Stop and start the server, never two at once. */
async function restartClient(taskManager: ReturnType<typeof registerVTasks>): Promise<void> {
	if (restarting) {
		log("VLS restart already in progress.")
		return
	}
	restarting = true
	try {
		await client?.stop()
		client = undefined
		await createAndStartClient(taskManager)
	} catch (error) {
		client = undefined
		setStatus("error")
		reportFailure("restart VLS", error)
	} finally {
		restarting = false
	}
}

export async function activate(context: ExtensionContext): Promise<void> {
	// Register output channels so users can open them even without VLS.
	context.subscriptions.push(outputChannel, vlsOutputChannel)
	context.subscriptions.push({ dispose: () => statusItem?.dispose() })
	const taskManager = registerVTasks(context)

	// Offering to clone and build a compiler would run `git` and `make` outside the
	// workspace, so only ask in a workspace the user trusts.
	if (vscode.workspace.isTrusted && !(await isVInstalled())) {
		const selection = await vscode.window.showInformationMessage(
			"The V programming language is not detected on this system. Would you like to install it?",
			"Yes",
			"No",
		)

		if (selection === "Yes") {
			await installV()
		}
	}

	// Register commands regardless of whether VLS is enabled
	await registerCommands(context)
	registerVlsCommands(context, () => client)

	// Only start the language server if the user enabled it in settings.
	if (isVlsEnabled()) {
		try {
			await createAndStartClient(taskManager)
		} catch (err) {
			// If starting the client fails, log and continue. Users can still
			// use non-LSP features of the extension.
			reportFailure("start VLS", err)
		}
	} else {
		log("VLS is disabled in settings.")
		setStatus("disabled")
	}

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
						reportFailure("start VLS", err)
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
					setStatus("disabled")
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
				const selected = await vscode.window.showInformationMessage(
					"VLS: Restart is required for changes to take effect. Proceed?",
					"Yes",
					"No",
				)
				if (selected === "Yes") {
					await restartClient(taskManager)
				}
			}
		}),
	)
}

export function deactivate(): Promise<void> | undefined {
	if (!client) return undefined
	return client.stop()
}
