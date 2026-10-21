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

/** A status bar item for the V compiler the extension actually resolved.
 *
 * One item, for V. The server has its own, and it is the better one: the
 * manager reports starting, stopped, unsupported and not-installed, and offers
 * the fix on the click. A second item here would state the VLS path twice with
 * two different click targets, and would appear while the server is disabled
 * and not running at all.
 *
 * The state comes from the resolution the task and run paths already do, so
 * the bar cannot disagree with what a run uses.
 */
export function registerStatusBar(context: vscode.ExtensionContext): void {
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10)
	item.name = "V compiler"
	const text = statusBarText(resolveToolState("v", vscode.workspace.workspaceFolders?.[0]))
	item.text = text.text
	item.tooltip = text.tooltip
	item.command = text.command
	item.show()
	context.subscriptions.push(item)
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
