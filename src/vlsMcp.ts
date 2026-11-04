import * as vscode from "vscode"
import { ExtensionContext, workspace } from "vscode"
import { getVls } from "./langserver"
import { log } from "./logger"

const PROVIDER_ID = "vLanguageServer"

export function registerVlsMcpServers(context: ExtensionContext): void {
	const changed = new vscode.EventEmitter<void>()
	context.subscriptions.push(changed)

	context.subscriptions.push(
		workspace.onDidChangeConfiguration((event) => {
			if (
				event.affectsConfiguration("v.vls.mcp.enable") ||
				event.affectsConfiguration("v.vls.command") ||
				event.affectsConfiguration("v.vls.args") ||
				event.affectsConfiguration("v.executablePath")
			) {
				changed.fire()
			}
		}),
		workspace.onDidChangeWorkspaceFolders(() => changed.fire()),
	)

	context.subscriptions.push(
		vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
			onDidChangeMcpServerDefinitions: changed.event,
			provideMcpServerDefinitions: async () => {
				const settings = workspace.getConfiguration("v.vls.mcp")
				if (!settings.get<boolean>("enable", false)) {
					return []
				}
				const definitions: vscode.McpStdioServerDefinition[] = []
				for (const folder of workspace.workspaceFolders ?? []) {
					let command: string
					try {
						command = getVls(folder)
					} catch (error) {
						log(`No VLS MCP server for ${folder.name}: ${error}`)
						continue
					}
					const definition = new vscode.McpStdioServerDefinition(
						`VLS (${folder.name})`,
						command,
						["--mcp"],
					)
					definition.cwd = folder.uri
					definitions.push(definition)
				}
				return definitions
			},
			resolveMcpServerDefinition: (definition) => Promise.resolve(definition),
		}),
	)
}