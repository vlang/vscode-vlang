import type { Memento } from "vscode"
import type { ToolName } from "./toolInstallation"
import { isExecutable } from "./vCommand"

// Managed executables live in this machine's extension storage. Their paths stay
// in globalState, which Settings Sync does not share, instead of in settings.
let store: Pick<Memento, "get"> | undefined

export function managedToolKey(tool: ToolName): string {
	return `tools.managed.${tool}`
}

export function initializeManagedTools(memento: Pick<Memento, "get"> | undefined): void {
	store = memento
}

/** The default command names select a managed installation before PATH. */
export function isAutomaticCommand(tool: ToolName, configured: string): boolean {
	const value = configured.trim()
	return value === "" || value === tool
}

export function automaticCommand(tool: ToolName): string {
	return tool === "v" ? "v" : ""
}

export function managedToolExecutable(tool: ToolName): string | undefined {
	const executable = store?.get<unknown>(managedToolKey(tool))
	return typeof executable === "string" && isExecutable(executable) ? executable : undefined
}

/** Replace an automatic setting with this machine's managed executable, if any. */
export function effectiveToolSetting(tool: ToolName, configured: string): string {
	return (isAutomaticCommand(tool, configured) && managedToolExecutable(tool)) || configured
}
