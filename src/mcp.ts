import { execFile as _execFile } from "child_process"
import { promisify } from "util"
import * as vscode from "vscode"
import { ConfigurationChangeEvent, ExtensionContext, WorkspaceFolder, workspace } from "vscode"
import { log } from "./logger"
import { describeServer, McpToolCatalog, mcpServerArgs, parseToolCatalog } from "./mcpProbe"
import { migratedSetting } from "./settings"
import { configuredCommand, resolvedCommand } from "./vCommand"

const execFile = promisify(_execFile)

const PROVIDER_ID = "vCompiler"

/** How long to wait for `v mcp tools` before giving up on this compiler. */
const probeTimeoutMs = 10_000

/** One probe result per compiler path.
 *
 * Probing spawns the compiler, which compiles nothing but is not free, and
 * `v.executablePath` rarely changes while a window is open.
 */
const catalogCache = new Map<string, Promise<McpToolCatalog | undefined>>()

/** The `v` to use for a folder, resolved the same way VLS and the tasks resolve it. */
export function vCommandFor(folder: WorkspaceFolder): string {
	const configured = migratedSetting(
		"v",
		"executablePath",
		"vls",
		"vCommand",
		"v",
		folder.uri,
	)
	return resolvedCommand(configured, folder.uri.fsPath) ?? configuredCommand(configured, folder.uri.fsPath)
}

/** Ask a compiler for its MCP tool list.
 *
 * `v mcp` is recent, so a compiler may not have it. Every failure is the same
 * answer: this compiler cannot serve MCP, and the folder simply gets no server.
 */
async function probeCatalog(vCommand: string): Promise<McpToolCatalog | undefined> {
	try {
		const { stdout } = await execFile(vCommand, ["mcp", "tools"], { timeout: probeTimeoutMs })
		return parseToolCatalog(stdout)
	} catch (error) {
		log(`No V MCP server in ${vCommand}: ${error}`)
		return undefined
	}
}

function catalogFor(vCommand: string): Promise<McpToolCatalog | undefined> {
	const cached = catalogCache.get(vCommand)
	if (cached !== undefined) {
		return cached
	}
	const pending = probeCatalog(vCommand)
	catalogCache.set(vCommand, pending)
	return pending
}

/** Stop trusting a probe.
 *
 * A new `v.executablePath` may point at a different compiler, and the user may
 * have replaced the binary at the same path, so the answer has to be asked again.
 */
export function forgetCatalog(): void {
	catalogCache.clear()
}

interface FolderServer {
	folder: WorkspaceFolder
	vCommand: string
	root: string
	readOnly: boolean
}

/** The server to offer for each open folder.
 *
 * Each folder gets its own, because the server's tools answer about one project.
 * An empty list means MCP is switched off.
 */
function foldersToServe(): FolderServer[] {
	const settings = workspace.getConfiguration("v.mcp")
	if (!settings.get<boolean>("enable", true)) {
		return []
	}
	const readOnly = settings.get<boolean>("readOnly", true)
	const rootOverride = settings.get<string>("root", "").trim()
	return (workspace.workspaceFolders ?? []).map((folder) => ({
		folder,
		vCommand: vCommandFor(folder),
		root: rootOverride || folder.uri.fsPath,
		readOnly,
	}))
}

/** Offer the V compiler as an MCP server for every workspace folder.
 *
 * The server calls the V parser, checker and formatter in process, so it answers
 * correctly about code that does not compile yet, which a language server working
 * from a failed parse cannot.
 *
 * Nothing is started here. VS Code asks for the definitions and starts a server
 * only when an agent actually calls one of its tools.
 */
export function registerMcpServers(context: ExtensionContext): void {
	const changed = new vscode.EventEmitter<void>()
	context.subscriptions.push(changed)

	context.subscriptions.push(
		workspace.onDidChangeConfiguration((event: ConfigurationChangeEvent) => {
			if (!event.affectsConfiguration("v.mcp")) {
				if (!event.affectsConfiguration("v.executablePath")) {
					return
				}
				forgetCatalog()
			}
			changed.fire()
		}),
		workspace.onDidChangeWorkspaceFolders(() => changed.fire()),
	)

	context.subscriptions.push(
		vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
			onDidChangeMcpServerDefinitions: changed.event,
			provideMcpServerDefinitions: async () => {
				const definitions = []
				for (const { folder, vCommand, root, readOnly } of foldersToServe()) {
					const catalog = await catalogFor(vCommand)
					if (!catalog) {
						log(`No MCP server for ${folder.name}: this V has no \`v mcp\`.`)
						continue
					}
					// `cwd` is a property rather than a constructor argument, and the
					// environment is left alone so the server inherits the extension host's.
					const definition = new vscode.McpStdioServerDefinition(
						describeServer(folder.name, catalog, readOnly),
						vCommand,
						mcpServerArgs({ root, readOnly }),
					)
					definition.cwd = folder.uri
					definitions.push(definition)
				}
				return definitions
			},
			// No authentication and nothing to prompt for: the server is a local
			// process the user already has, started with a path the user configured.
			resolveMcpServerDefinition: (definition) => Promise.resolve(definition),
		}),
	)
}
