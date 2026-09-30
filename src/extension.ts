import { ExtensionContext } from "vscode"
import { registerCommands } from "./commands"
import { VlsManager } from "./langserver"
import { outputChannel, vlsOutputChannel } from "./logger"
import { registerVTasks } from "./vTasks"
import { ToolManager } from "./toolManager"

let server: VlsManager | undefined
let tools: ToolManager | undefined

export async function activate(context: ExtensionContext): Promise<void> {
	context.subscriptions.push(outputChannel, vlsOutputChannel)
	const tasks = registerVTasks(context)
	registerCommands(context)
	const languageServer = new VlsManager(tasks)
	server = languageServer
	tools = new ToolManager(context, (update) => languageServer.updateConfiguration(update))
	context.subscriptions.push(server, tools)
	void tools.check().catch((error: unknown) => outputChannel.error(String(error)))
	await server.restart()
}

export async function deactivate(): Promise<void> {
	tools?.dispose()
	tools = undefined
	await server?.shutdown()
	server = undefined
}
