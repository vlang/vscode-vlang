import * as vscode from "vscode"
import { effectiveToolSetting } from "./managedTools"

/** What the status bar item reports.
 *
 * A missing V is not an error state to hide: it is the one state a user can act
 * on, so it gets its own text and its own click target rather than a blank
 * item or an error background.
 */
export type ToolStatus = "missing" | "found"

export interface StatusBarState {
	status: ToolStatus
	tool: "v" | "vls"
	name: string
}

export interface StatusBarText {
	text: string
	tooltip: string
	command: string
}

/** The item's text, tooltip and click target for one tool.
 *
 * Pure, so the strings are testable without a host. A tool that is present
 * reports its resolved name; a tool that is missing says so in the text, which
 * is the only state where the click resolves to fixing something.
 */
export function statusBarText(state: StatusBarState): StatusBarText {
	const label = state.tool === "v" ? "V" : "VLS"
	if (state.status === "missing") {
		return {
			text: `$(warning) ${label}: not found`,
			tooltip: `${label} was not found. Click to provide it.`,
			command: state.tool === "v" ? "v.tools.checkForUpdates" : "v.vls.update",
		}
	}
	return {
		text: `$(check) ${label}: ${state.name}`,
		tooltip: `Click for ${label} options.`,
		command: state.tool === "v" ? "v.tools.checkForUpdates" : "v.vls.update",
	}
}

/** A status bar item for the toolchain the extension actually resolved.
 *
 * Two items, V and VLS, rather than one: the VLS server can be down while V
 * works, which is the failure users file as "no intellisense at all", and one
 * item cannot say both. The state comes from the resolution the task and
 * server paths already do, so the bar cannot disagree with what a run uses.
 */
export function registerStatusBar(context: vscode.ExtensionContext): void {
	for (const tool of ["v", "vls"] as const) {
		const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10)
		item.name = `${tool === "v" ? "V" : "VLS"} status`
		const state = resolveToolState(tool, vscode.workspace.workspaceFolders?.[0])
		const text = statusBarText(state)
		item.text = text.text
		item.tooltip = text.tooltip
		item.command = text.command
		item.show()
		context.subscriptions.push(item)
	}
}

/** Whether the configured tool resolves, read the way the task path reads it.
 *
 * Not exported: the decision is deliberately one function's worth so the item
 * shows the same answer the tasks would act on, and the above stays testable.
 */
function resolveToolState(tool: "v" | "vls", folder?: vscode.WorkspaceFolder): StatusBarState {
	const configured =
		vscode.workspace
			.getConfiguration("v", folder)
			.get<string>(tool === "v" ? "executablePath" : "vls.command") ?? ""
	const resolved = effectiveToolSetting(tool, configured)
	return resolved.trim() === ""
		? { status: "missing", tool, name: "" }
		: { status: "found", tool, name: resolved }
}
