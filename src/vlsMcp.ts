import * as vscode from "vscode"
import { ExtensionContext, workspace } from "vscode"
import { getVls } from "./langserver"
import { log } from "./logger"
import { migratedSetting } from "./settings"
import { probeVlsMcp, vlsMcpArgs } from "./vlsMcpProbe"

const PROVIDER_ID = "vLanguageServer"

/** How long a negative probe stays trusted before the next check. */
const negativeProbeTtlMs = 30_000

const probeCache = new Map<string, { ok: boolean; at: number }>()

/** Whether the VLS binary serves MCP, without trusting a stale answer.
 *
 * A positive answer is kept: the binary at this path demonstrated the mode.
 * A negative one expires, so installing a newer VLS while the session runs is
 * picked up on the next check rather than after a restart. The cache key
 * carries the arguments as well as the path: a server that needs its
 * configured arguments answers differently with and without them.
 */
async function supportsVlsMcp(command: string, args: string[]): Promise<boolean> {
	const key = JSON.stringify([command, args])
	const cached = probeCache.get(key)
	if (cached && (cached.ok || Date.now() - cached.at < negativeProbeTtlMs)) {
		return cached.ok
	}
	const ok = await probeVlsMcp(command, args)
	probeCache.set(key, { ok, at: Date.now() })
	return ok
}

export function forgetVlsMcpProbes(): void {
	probeCache.clear()
}

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
				forgetVlsMcpProbes()
				changed.fire()
			}
		}),
		workspace.onDidChangeWorkspaceFolders(() => changed.fire()),
	)

	context.subscriptions.push(
		vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
			onDidChangeMcpServerDefinitions: changed.event,
			provideMcpServerDefinitions: async () => {
				const definitions: vscode.McpStdioServerDefinition[] = []
				for (const folder of workspace.workspaceFolders ?? []) {
					// Resource-scoped like the compiler's own flag: one folder's
					// opt-in must not switch on its neighbour's server.
					if (
						!workspace
							.getConfiguration("v.vls.mcp", folder.uri)
							.get<boolean>("enable", false)
					) {
						continue
					}
					let command: string
					try {
						command = getVls(folder)
					} catch (error) {
						log(`No VLS MCP server for ${folder.name}: ${error}`)
						continue
					}
					// The configured `v.vls.args` are additional command-line
					// arguments, so they travel with both the probe and the served
					// process: a server that depends on them would otherwise be
					// rejected by the probe or started wrongly configured.
					const mcpArgs = vlsMcpArgs(
						migratedSetting("v.vls", "args", "vls", "args", [] as string[], folder.uri),
					)
					if (!(await supportsVlsMcp(command, mcpArgs))) {
						log(
							`No VLS MCP server for ${folder.name}: ${command} does not answer an MCP handshake.`,
						)
						continue
					}
					const definition = new vscode.McpStdioServerDefinition(
						`VLS (${folder.name})`,
						command,
						mcpArgs,
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
