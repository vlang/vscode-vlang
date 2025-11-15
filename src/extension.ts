import { registerCommands, registerVlsCommands } from "commands"
import { getVls, isVlsEnabled } from "langserver"
import { log, outputChannel, vlsOutputChannel } from "logger"
import vscode, { ConfigurationChangeEvent, ExtensionContext, workspace } from "vscode"
import { LanguageClient, LanguageClientOptions, ServerOptions } from "vscode-languageclient/node"
import { installV, isVInstalled } from "./utils"
import { VDocumentFormattingProvider } from "./formatProvider"

export let client: LanguageClient | undefined

// The verified dynamic linker path for Debian 64-bit systems
const linkerPath = "/lib64/ld-linux-x86-64.so.2"
const isLinux = process.platform === "linux"
// The absolute path to your V installation root
const vRootPath = "/home/tshimo/v"
// The required arguments for VLS to use the standard I/O communication method
const vlsArgs = ["--stdio"]

async function createAndStartClient(): Promise<void> {
	// getVls() will resolve VLS path now that it's in ~/.local/bin/
	const vlsPath = await getVls()

	// CRITICAL FIX: Define Environment variables for VLS execution
	const vlsEnvironment = {
		// 1. Tell VLS where the V installation is located
		V_HOME: vRootPath,
		// 2. Ensure the V executable is discoverable in the PATH
		PATH: `${vRootPath}:${process.env.PATH || ""}`,
		// Preserve existing environment variables
		...process.env,
	}

	let serverOptions: ServerOptions

	if (isLinux) {
		// FIX: Use the linker path to execute the VLS binary
		serverOptions = {
			run: {
				command: linkerPath,
				// Pass the VLS path first, then its arguments
				args: [vlsPath, ...vlsArgs],
				options: {
					env: vlsEnvironment, // Inject environment variables
					cwd: vRootPath, // Set working directory
				},
			},
			debug: {
				command: linkerPath,
				args: [vlsPath, ...vlsArgs],
				options: {
					env: vlsEnvironment,
					cwd: vRootPath,
				},
			},
		}
	} else {
		// Original logic for non-Linux systems
		serverOptions = {
			run: { command: vlsPath, args: vlsArgs },
			debug: { command: vlsPath, args: vlsArgs },
		}
	}

	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: "file", language: "v" }],
		initializationOptions: {
			enableHover: true,
		},
		outputChannel: vlsOutputChannel,
		synchronize: {
			fileEvents: vscode.workspace.createFileSystemWatcher("**/*.v"),
		},
	}

	client = new LanguageClient("vls", "V Language Server", serverOptions, clientOptions)
	vscode.window.showInformationMessage("V Language Server is starting.")
	await client.start()
	vscode.window.showInformationMessage("V Language Server is now active.")
}

export async function activate(context: ExtensionContext): Promise<void> {
	// Register output channels
	context.subscriptions.push(outputChannel, vlsOutputChannel)

	// Original V installation check logic
	if (!(await isVInstalled())) {
		const selection = await vscode.window.showInformationMessage(
			"The V programming language is not detected on this system. Would you like to install it?",
			{ modal: true },
			"Yes",
			"No",
		)

		if (selection === "Yes") {
			await installV()
		}
	}

	// Register commands regardless of whether VLS is enabled
	await registerCommands(context)

	// --- Register Document Formatter ---
	const formattingProvider = new VDocumentFormattingProvider()
	context.subscriptions.push(
		vscode.languages.registerDocumentFormattingEditProvider(
			{ scheme: "file", language: "v" },
			formattingProvider,
		),
	)
	// --- END Register Document Formatter ---

	// Only start the language server if the user enabled it in settings.
	if (isVlsEnabled()) {
		try {
			await createAndStartClient()
		} catch (err) {
			// If starting the client fails, log and continue.
			console.error("Failed to start VLS:", err)
			vscode.window.showErrorMessage("Failed to start VLS. See output for details.")
			outputChannel.show()
		}
	} else {
		log("VLS is disabled in settings.")
	}

	registerVlsCommands(context, client)

	// Original configuration change handler logic
	workspace.onDidChangeConfiguration(async (e: ConfigurationChangeEvent) => {
		const vlsEnabled = isVlsEnabled()

		if (e.affectsConfiguration("v.vls.enable")) {
			if (vlsEnabled && !client) {
				// Start the client now that the user enabled it.
				try {
					await createAndStartClient()
				} catch (err) {
					console.error("Failed to start VLS:", err)
					vscode.window.showErrorMessage("Failed to start VLS. See output for details.")
					outputChannel.show()
				}
			} else if (!vlsEnabled && client) {
				// Stop the client if it was running and the user disabled it.
				try {
					await client.stop()
					log("VLS has been stopped.")
				} catch {
					// ignore
				}
				client = undefined
			}
		} else if (e.affectsConfiguration("v.vls") && vlsEnabled && client) {
			void vscode.window
				.showInformationMessage(
					"VLS: Restart is required for changes to take effect. Would you like to proceed?",
					"Yes",
					"No",
				)
				.then(async (selected) => {
					if (selected == "Yes") {
						try {
							if (client) {
								await client.restart()
							}
						} catch {
							void vscode.window.showErrorMessage("Failed to restart VLS.")
						}
					}
				})
		}
	})
}

export function deactivate(): Promise<void> | undefined {
	if (!client) return undefined
	return client.stop()
}
