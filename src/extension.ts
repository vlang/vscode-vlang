import {
	registerCommands,
	registerNumberHover,
	registerVlsCommands,
	registerVmlHover,
} from "commands"
import { registerCodeActions } from "./codeActions"
import { createExtensionAPI } from "./extensionAPI"
import { vDocumentSelector } from "./documentSelector"
import { registerDebugger } from "./debugger"
import { registerFolding } from "./folding"
import { registerDocumentFormatting } from "./formatProvider"
import { isVlsEnabled, VlsManager } from "langserver"
import { registerStatusBar } from "./statusBar"
import { registerSelectExecutable } from "./selectExecutable"
import { log, outputChannel, vlsOutputChannel } from "logger"
import { registerMcpServers } from "mcp"
import { PathIntellisenseProvider } from "./pathIntellisense"
import { detectTemplateScriptKind, isVebTemplateFile, parseVebDirective } from "./vebTemplate"
import { ImportCostController } from "./importCost"
import { ErrorLensController } from "./errorLens"
import { registerVlsMcpServers } from "./vlsMcp"
import { registerSkillCommands } from "skills"
import { registerTestExplorer } from "testExplorer"
import { requiresServerRestart } from "./serverRestart"
import vscode, { ConfigurationChangeEvent, ExtensionContext, workspace } from "vscode"
import { installV, isVInstalled } from "./utils"
import { registerVTasks, VTaskManager } from "./vTasks"
import { registerTestGutter } from "./testGutter"
import { ToolManager } from "./toolManager"

/** The owner of the language server, once it has been started.
 *
 * Held rather than constructed unconditionally: the server stays off when the
 * user has disabled it, and `undefined` is what says so.
 */
let vlsManager: VlsManager | undefined

/** The API other extensions can use to resolve the V compiler.
 *
 * Exported rather than registered, because VS Code makes an extension's exports
 * available to other extensions through `vscode.extensions.getExtension(...)`.
 * There is nothing to register and nothing to keep in sync.
 */
export const api = createExtensionAPI()

/** Whether the window is worth starting the toolchain for.
 *
 * The extension also activates for JSON, XML and CSV files (decoder commands),
 * where starting VLS, probing for updates and prompting to install V would be
 * pure overhead. Those commands stay registered; only the heavy startup waits
 * until a V document is open or the workspace holds V sources.
 */
async function workspaceTouchesV(): Promise<boolean> {
	if (
		vscode.workspace.textDocuments.some(
			(document) => document.languageId === "v" || document.languageId === "v.mod",
		)
	) {
		return true
	}
	if (!vscode.workspace.workspaceFolders?.length) {
		return false
	}
	const hits = await vscode.workspace.findFiles(
		"{**/*.v,**/*.vsh,**/*.vh,**/*.vv,**/v.mod}",
		null,
		1,
	)
	return hits.length > 0
}

/** Start the language server, reporting the failures its own recovery cannot. */
async function startVls(taskManager: VTaskManager): Promise<boolean> {
	const manager = new VlsManager(taskManager)
	if (await manager.restart()) {
		vlsManager = manager
		return true
	}
	// A failed start is not fatal: non-LSP features still work. The manager has
	// already reported the failure, and returning false keeps the first-open
	// retry: the next V document tries again instead of leaving VLS stopped.
	log("Failed to start VLS.")
	manager.dispose()
	return false
}

export async function activate(context: ExtensionContext): Promise<void> {
	// Register output channels so users can open them even without VLS.
	context.subscriptions.push(outputChannel, vlsOutputChannel)
	const taskManager = registerVTasks(context)

	// Register the debugger so a V program can be launched under gdb. The compile
	// step happens inside the factory, so no task needs to be defined first.
	registerDebugger(context)
	registerNumberHover(context)
	registerVmlHover(context)
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
	// The update check phones home, so it waits for a V window like the rest
	// of the heavy startup below.
	const vRelevant = await workspaceTouchesV()
	if (vRelevant) {
		void toolManager.check()
	}

	// Offer the compiler to agents. Registered before the language server starts so
	// the two are available at the same time regardless of how startup goes.
	registerMcpServers(context)
	registerVlsMcpServers(context)

	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			{ language: "v" },
			new PathIntellisenseProvider(),
			"/",
			"\\",
			'"',
			"'",
			"`",
		),
		vscode.languages.registerCompletionItemProvider(
			{ language: "html" },
			new PathIntellisenseProvider(),
			"/",
			"\\",
			'"',
			"'",
		),
		vscode.languages.registerHoverProvider(
			{ language: "html" },
			{
				provideHover(document, position) {
					if (!isVebTemplateFile(document.uri.fsPath)) return undefined
					const line = document.lineAt(position.line).text
					const directive = parseVebDirective(line, position.line)
					if (!directive) return undefined
					const kind = vscode.workspace
						.getConfiguration("v.templates")
						.get<boolean>("jsxAutoDetect", true)
						? detectTemplateScriptKind(document.uri.fsPath, document.getText())
						: "html"
					return new vscode.Hover(
						`VEB \`${directive.kind}\`${directive.value ? ` — ${directive.value}` : ""} (template script: ${kind})`,
					)
				},
			},
		),
	)

	const errorLens = new ErrorLensController()
	context.subscriptions.push(errorLens)

	const importCost = new ImportCostController()
	context.subscriptions.push(importCost)
	context.subscriptions.push(
		vscode.commands.registerCommand("v.errorLens.toggle", async () => {
			const config = vscode.workspace.getConfiguration("v.errorLens")
			const current = config.get<boolean>("enabled", true)
			await config.update("enabled", !current, vscode.ConfigurationTarget.Global)
		}),
	)
	// This needs the V compiler, which may be absent or older than the command is,
	// so it reports its own unavailability rather than failing activation.
	registerSkillCommands(context)
	// Show the tests in the Test Explorer. Discovery is best-effort, so a workspace
	// with no `_test.v` files shows an empty tree rather than failing activation.
	registerTestExplorer(context)
	// Offer code actions that generate tests. The coverage-aware one reads the
	// controller the V test task drives, so it is registered where that task is.
	registerCodeActions(context, taskManager.coverage)

	// Check for V only if it's not installed and this window wants it.
	if (vRelevant && !(await isVInstalled())) {
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
	// no intellisense with only an error toast. The failure path lives in
	// `startVls`, for the errors recovery cannot handle on its own. In a window
	// with no V relevance the start waits for the first V document instead of
	// paying for a server nothing will talk to.
	// Retry trigger when no server is running: the next V document retries
	// the start, so installing VLS or correcting its command needs no manual
	// restart. Installed once and dropped once a start succeeds.
	let vlsRetry: vscode.Disposable | undefined
	// Compiler detection ran only for a window holding V sources at
	// activation; a V file opened later gets one check of its own.
	let toolsChecked = vRelevant
	const ensureVlsRetry = () => {
		if (vlsRetry || vlsManager) {
			return
		}
		vlsRetry = vscode.workspace.onDidOpenTextDocument(async (document) => {
			if (document.languageId !== "v" && document.languageId !== "v.mod") {
				return
			}
			if (!toolsChecked) {
				toolsChecked = true
				void toolManager.check()
			}
			if (vlsManager || !isVlsEnabled()) {
				return
			}
			// A failed start keeps the trigger: the next V document retries,
			// and V: Restart VLS is always available in between.
			if (await startVls(taskManager)) {
				vlsRetry?.dispose()
				vlsRetry = undefined
			}
		})
		context.subscriptions.push(vlsRetry)
	}
	const dropVlsRetry = () => {
		vlsRetry?.dispose()
		vlsRetry = undefined
	}
	if (isVlsEnabled()) {
		// In a window with no V relevance the start waits for the first V
		// document instead of paying for a server nothing will talk to. When the
		// workspace already holds V sources the start runs eagerly, and a failed
		// eager start keeps the same retry rather than staying stopped.
		if (vRelevant && !(await startVls(taskManager))) {
			ensureVlsRetry()
		} else if (!vRelevant) {
			ensureVlsRetry()
		}
	} else {
		log("VLS is disabled in settings.")
	}

	registerVlsCommands(
		context,
		async () => {
			if (!isVlsEnabled()) {
				void vscode.window.showInformationMessage("VLS is disabled in settings.")
				return
			}
			if (!vlsManager) {
				vlsManager = new VlsManager(taskManager)
			}
			await vlsManager.restart()
		},
		() => vlsManager?.isRunning() ?? false,
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("v.vls.generateTest", async () => {
			if (vlsManager) {
				await vlsManager.generateTests()
			} else {
				void vscode.window.showInformationMessage("VLS is not running.")
			}
		}),
	)

	const inlayHintsEmitter = new vscode.EventEmitter<void>()
	context.subscriptions.push(inlayHintsEmitter)
	context.subscriptions.push(
		vscode.languages.registerInlayHintsProvider([...vDocumentSelector], {
			onDidChangeInlayHints: inlayHintsEmitter.event,
			provideInlayHints: () => [],
		}),
	)

	// React to configuration changes: enable/disable or request restart.
	context.subscriptions.push(
		workspace.onDidChangeConfiguration(async (e: ConfigurationChangeEvent) => {
			const vlsEnabled = isVlsEnabled()

			if (
				e.affectsConfiguration("v.vls.inlayHints") ||
				e.affectsConfiguration("vls.inlayHints")
			) {
				inlayHintsEmitter.fire()
			}
			if (vlsManager) {
				if (
					e.affectsConfiguration("v.vls") ||
					e.affectsConfiguration("vls") ||
					e.affectsConfiguration("v.executablePath")
				) {
					await vlsManager.sendSettingsNow()
				}
			}

			if (e.affectsConfiguration("v.vls.enable")) {
				if (vlsEnabled && !vlsManager) {
					// Start the client now that the user enabled it.
					if (await startVls(taskManager)) {
						dropVlsRetry()
					} else {
						ensureVlsRetry()
					}
				} else if (!vlsEnabled && vlsManager) {
					// Stop the client if it was running and the user disabled it.
					vlsManager.dispose()
					vlsManager = undefined
					log("VLS has been stopped.")
				}
			} else if (vlsEnabled && !vlsManager && requiresServerRestart(e)) {
				// No manager is left to observe this change — a failed start
				// disposes it — so a corrected command, arguments or compiler
				// path retries the start now instead of waiting for the next V
				// document. A failed retry keeps the document-open trigger.
				if (await startVls(taskManager)) {
					dropVlsRetry()
				} else {
					ensureVlsRetry()
				}
			}
			// Command and argument changes need no prompt here: the manager
			// restarts for them on its own, exactly once. Asking after that
			// restart was already queued made "No" unable to prevent it and
			// "Yes" queue a second one.
		}),
	)
}

export function deactivate(): Promise<void> | undefined {
	vlsManager?.dispose()
	return undefined
}
