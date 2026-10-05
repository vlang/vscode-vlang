import * as vscode from "vscode"
import {
	CloseAction,
	ErrorAction,
	LanguageClient,
	LanguageClientOptions,
	State,
} from "vscode-languageclient/node"
import { vlsOutputChannel } from "./logger"
import { migratedSetting } from "./settings"
import { resolvedCommand } from "./vCommand"
import { runCodeLensCommand, VTaskManager, vCommandForServer } from "./vTasks"
import { requireSupportedVls, UnsupportedVlsError } from "./vlsSupport"

const serverSettings = [
	"v.vls.enable",
	"v.vls.command",
	"v.vls.args",
	"v.executablePath",
	"v.vls.inlayHints.enabled",
	"v.vls.diagnostics",
	"vls.command",
	"vls.args",
	"vls.vCommand",
	"vls.inlayHints.enabled",
	"vls.diagnostics.enabled",
]

function featureEnabled(feature: "inlayHints.enabled" | "diagnostics"): boolean {
	return migratedSetting(
		"v.vls",
		feature,
		"vls",
		feature === "diagnostics" ? "diagnostics.enabled" : feature,
		true,
	)
}

async function sendSettings(client: LanguageClient): Promise<void> {
	await client.sendNotification("workspace/didChangeConfiguration", {
		settings: {
			vls: {
				inlayHints: { enabled: featureEnabled("inlayHints.enabled") },
				diagnostics: { enabled: featureEnabled("diagnostics") },
			},
		},
	})
}

/** Owns the client and serializes starts, configuration changes and shutdown. */
export class VlsManager implements vscode.Disposable {
	private client: LanguageClient | undefined
	private clientDisposables: vscode.Disposable[] = []
	private pending: Promise<void> = Promise.resolve()
	private disposed = false
	private readonly abort = new AbortController()
	private updatingConfiguration = false
	private recoveryTimer: ReturnType<typeof setTimeout> | undefined
	private crashTimes: number[] = []
	private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 9)
	private readonly subscriptions: vscode.Disposable[]

	constructor(
		private readonly tasks: VTaskManager,
		private readonly storageRoot: string,
	) {
		this.status.name = "V Language Server"
		this.status.command = "v.vls.openOutput"
		this.subscriptions = [
			this.status,
			vscode.commands.registerCommand("v.vls.restart", () => this.restart()),
			vscode.commands.registerCommand("v.vls.openOutput", () => vlsOutputChannel.show()),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (
					!this.updatingConfiguration &&
					serverSettings.some((setting) => event.affectsConfiguration(setting))
				) {
					void this.restart()
				}
			}),
		]
	}

	restart(): Promise<void> {
		this.cancelRecovery()
		this.crashTimes = []
		return this.queueRestart()
	}

	/** Change a tool path and its arguments while the old server is stopped. */
	async updateConfiguration(update: () => Promise<void>): Promise<void> {
		const operation = this.pending.then(async () => {
			await this.stopClient()
			if (this.disposed) return
			this.updatingConfiguration = true
			try {
				await update()
			} finally {
				this.updatingConfiguration = false
			}
		})
		this.pending = operation.catch(() => undefined)
		try {
			await operation
		} finally {
			await this.restart()
		}
	}

	private queueRestart(recovering = false): Promise<void> {
		this.pending = this.pending.then(async () => {
			try {
				await this.stopClient()
				if (this.disposed) return
				if (!vscode.workspace.getConfiguration("v.vls").get<boolean>("enable", true)) {
					this.setStatus("Disabled")
					return
				}
				if (recovering) {
					const now = Date.now()
					this.crashTimes = this.crashTimes.filter((time) => now - time < 180_000)
					if (this.crashTimes.length >= 5) {
						throw new Error(
							"The server repeatedly crashed. Check the output, then run V: Restart VLS.",
						)
					}
					this.crashTimes.push(now)
				}
				await this.startClient()
			} catch (error) {
				await this.stopClient()
				if (this.disposed) return
				const message = error instanceof Error ? error.message : String(error)
				this.setStatus("Error", message)
				vlsOutputChannel.error(message)
				if (error instanceof UnsupportedVlsError) {
					this.status.command = "v.vls.update"
					void vscode.window
						.showErrorMessage(`VLS: ${message}`, "Install or Update VLS", "Show Output")
						.then((action) => {
							if (action === "Install or Update VLS")
								void vscode.commands.executeCommand("v.vls.update")
							else if (action === "Show Output") vlsOutputChannel.show()
						})
					return
				}
				void vscode.window
					.showErrorMessage(`VLS: ${message}`, "Open Settings", "Show Output")
					.then((action) => {
						if (action === "Open Settings") {
							void vscode.commands.executeCommand(
								"workbench.action.openSettings",
								"v.vls",
							)
						} else if (action === "Show Output") {
							vlsOutputChannel.show()
						}
					})
			}
		})
		return this.pending
	}

	private async startClient(): Promise<void> {
		this.setStatus("Starting")
		const folder =
			(vscode.window.activeTextEditor
				? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
				: undefined) ?? vscode.workspace.workspaceFolders?.[0]
		const setting =
			migratedSetting("v.vls", "command", "vls", "command", "", folder?.uri).trim() || "vls"
		const command = resolvedCommand(setting, folder?.uri.fsPath)
		if (!command) {
			this.setStatus(
				"Not installed",
				`Executable not found: ${setting}. Click to install or configure VLS.`,
			)
			this.status.command = "v.vls.update"
			return
		}
		const args = migratedSetting("v.vls", "args", "vls", "args", [] as string[], folder?.uri)
		await requireSupportedVls(command, this.storageRoot, { args, signal: this.abort.signal })
		if (this.disposed) return
		const env = { ...process.env, VLS_V_COMMAND: vCommandForServer(folder) }
		const options: LanguageClientOptions = {
			documentSelector: [{ scheme: "file", language: "v" }],
			outputChannel: vlsOutputChannel,
			// Configuration changes restart the client through our queue. Send settings
			// after startup only; an independent synchronizer can race the old shutdown.
			errorHandler: {
				error: (error) => {
					this.scheduleRecovery(nextClient, error.message)
					return { action: ErrorAction.Continue, handled: true }
				},
				closed: () => {
					this.scheduleRecovery(nextClient, "Connection closed")
					return {
						action: CloseAction.DoNotRestart,
						handled: true,
						message: "VLS connection closed. Recovery is handled by the extension.",
					}
				},
			},
			middleware: {
				handleDiagnostics: (uri, diagnostics, next) => {
					next(uri, featureEnabled("diagnostics") ? diagnostics : [])
				},
				provideInlayHints: (document, range, token, next) => {
					return featureEnabled("inlayHints.enabled") ? next(document, range, token) : []
				},
				executeCommand: async (name, commandArgs, next) => {
					if (name === "vls.runFile" || name === "vls.runTests") {
						await runCodeLensCommand(name, commandArgs, this.tasks)
						return undefined
					}
					return (await next(name, commandArgs)) as unknown
				},
			},
		}
		// VLS dynamically registers its file watcher; a second static watcher duplicates events.
		const nextClient = new LanguageClient(
			"vls",
			"V Language Server",
			{
				command,
				args,
				options: { env },
			},
			options,
		)
		this.client = nextClient
		this.clientDisposables.push(
			nextClient.onDidChangeState(({ newState }) => {
				if (this.disposed) return
				this.setStatus(
					newState === State.Running
						? "Active"
						: newState === State.Starting
							? "Starting"
							: "Stopped",
				)
			}),
		)
		vlsOutputChannel.info(`Starting ${command}`)
		await nextClient.start()
		await sendSettings(nextClient)
	}

	private scheduleRecovery(failedClient: LanguageClient, reason: string): void {
		if (this.disposed || this.client !== failedClient || this.recoveryTimer) return
		vlsOutputChannel.warn(`VLS disconnected: ${reason}. Scheduling recovery.`)
		// Let languageclient finish clearing the failed transport before disposing it.
		this.recoveryTimer = setTimeout(() => {
			this.recoveryTimer = undefined
			if (!this.disposed && this.client === failedClient) void this.queueRestart(true)
		}, 100)
	}

	private cancelRecovery(): void {
		if (this.recoveryTimer) clearTimeout(this.recoveryTimer)
		this.recoveryTimer = undefined
	}

	private async stopClient(): Promise<void> {
		const previous = this.client
		this.client = undefined
		for (const disposable of this.clientDisposables.splice(0)) disposable.dispose()
		try {
			await previous?.dispose()
		} catch (error) {
			vlsOutputChannel.warn(`VLS shutdown: ${String(error)}`)
		}
	}

	private setStatus(state: string, detail?: string): void {
		this.status.command = "v.vls.openOutput"
		this.status.text = `$(symbol-method) VLS: ${state}`
		this.status.tooltip = detail || "V Language Server — click to show output"
		this.status.show()
	}

	shutdown(): Promise<void> {
		this.disposed = true
		this.abort.abort()
		this.cancelRecovery()
		this.pending = this.pending.then(() => this.stopClient())
		return this.pending
	}

	dispose(): void {
		void this.shutdown()
		for (const disposable of this.subscriptions) disposable.dispose()
	}
}
