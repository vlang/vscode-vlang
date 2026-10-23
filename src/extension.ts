import { registerCommands, registerNumberHover, registerVlsCommands } from "commands"
import { registerCodeActions } from "./codeActions"
import { registerDebugger } from "./debugger"
import { registerFolding } from "./folding"
import { registerDocumentFormatting } from "./formatProvider"
import { isVlsEnabled, VlsManager } from "langserver"
import { registerStatusBar } from "./statusBar"
import { registerSelectExecutable } from "./selectExecutable"
import { log, outputChannel, vlsOutputChannel } from "logger"
import vscode, { ConfigurationChangeEvent, ExtensionContext, workspace } from "vscode"
import { installV, isVInstalled } from "./utils"
import { registerVTasks } from "./vTasks"
import { registerTestGutter } from "./testGutter"
import { ToolManager } from "./toolManager"

/** The owner of the language server, once it has been started.
 *
 * Held rather than constructed unconditionally: the server stays off when the
 * user has disabled it, and `undefined` is what says so.
 */
let vlsManager: VlsManager | undefined

export async function activate(context: ExtensionContext): Promise<void> {
	// Register output channels so users can open them even without VLS.
	context.subscriptions.push(outputChannel, vlsOutputChannel)
	const taskManager = registerVTasks(context)

	// Offer a code action that generates a test skeleton. Registered here so it is
	// available as soon as a V file is opened, without waiting for anything else.
	registerCodeActions(context)
	// Register the debugger so a V program can be launched under gdb. The compile
	// step happens inside the factory, so no task needs to be defined first.
	registerDebugger(context)
	registerNumberHover(context)
	// Fold blocks, import runs and //#region markers. This takes over the
	// document's folding from the editor, so it has to cover all three itself.
	registerFolding(context)
	// A lens over each `fn test_` that runs it through the same task path as the
	// run lens, and the status bar for the resolved toolchain. Both are offered
	// while VLS is off, because neither depends on it.
	registerTestGutter(context, taskManager)
	registerStatusBar(context)
	registerSelectExecutable(context)
	// Formatting with the configured compiler, which defers to VLS while the
	// server is up and answers when it is not. The server check reads `vlsManager`
	// lazily because the manager is constructed further down.
	registerDocumentFormatting(context, () => vlsManager?.isRunning() ?? false)

	// Own the managed V and VLS builds and their update checks. Its constructor
	// calls initializeManagedTools, so a managed executable is preferred over PATH
	// by the VLS start, tasks, and run commands below.
	const toolManager = new ToolManager(context, async (update) => update())
	context.subscriptions.push(toolManager)
	void toolManager.check()

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
	// VlsManager owns the client: it version-gates the server, serializes starts
	// and configuration changes, and recovers a crashed server instead of leaving
	// no intellisense with only an error toast. The failure path here is the one
	// it cannot recover from on its own.
	if (isVlsEnabled()) {
		vlsManager = new VlsManager(taskManager)
		try {
			await vlsManager.restart()
		} catch (error) {
			// Starting the client failing is not fatal: non-LSP features still work,
			// and the manager has already reported it through the status bar.
			log(`Failed to start VLS: ${error instanceof Error ? error.message : String(error)}`)
			vlsOutputChannel.show()
			vlsManager.dispose()
			vlsManager = undefined
		}
	} else {
		log("VLS is disabled in settings.")
	}

	registerVlsCommands(context, async () => {
		if (!isVlsEnabled()) {
			void vscode.window.showInformationMessage("VLS is disabled in settings.")
			return
		}
		if (!vlsManager) {
			vlsManager = new VlsManager(taskManager)
		}
		await vlsManager.restart()
	})

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
			if (vlsManager) {
				await vlsManager.sendSettingsNow()
			}

			if (e.affectsConfiguration("v.vls.enable")) {
				if (vlsEnabled && !vlsManager) {
					// Start the client now that the user enabled it.
					vlsManager = new VlsManager(taskManager)
					try {
						await vlsManager.restart()
					} catch (error) {
						log(
							`Failed to start VLS: ${error instanceof Error ? error.message : String(error)}`,
						)
						vlsOutputChannel.show()
						vlsManager.dispose()
						vlsManager = undefined
					}
				} else if (!vlsEnabled && vlsManager) {
					// Stop the client if it was running and the user disabled it.
					vlsManager.dispose()
					vlsManager = undefined
					log("VLS has been stopped.")
				}
			} else if (
				(e.affectsConfiguration("v.vls.command") ||
					e.affectsConfiguration("v.vls.args") ||
					e.affectsConfiguration("vls.command") ||
					e.affectsConfiguration("vls.args") ||
					e.affectsConfiguration("v.executablePath") ||
					e.affectsConfiguration("vls.vCommand")) &&
				vlsEnabled &&
				vlsManager
			) {
				void vscode.window
					.showInformationMessage(
						"VLS: Restart is required for changes to take effect. Proceed?",
						"Yes",
						"No",
					)
					.then(async (selected) => {
						if (selected === "Yes") {
							await vlsManager?.restart()
						}
					})
			}
		}),
	)
}

export function deactivate(): Promise<void> | undefined {
	vlsManager?.dispose()
	return undefined
}
