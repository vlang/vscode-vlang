import * as path from "path"
import * as vscode from "vscode"
import { managedToolExecutable } from "./managedTools"
import { isExecutable, findInPath, resetPathLookupCache } from "./vCommand"

/** What the picker can offer, as the inputs a decision needs.
 *
 * Passed in rather than read from the workspace so the decision is testable:
 * the same three values produce the same list in the editor and in a test, and
 * no test has to fake a settings store to check ordering.
 */
export interface ExecutablePickerInputs {
	configured: string
	onPath: string | undefined
	managed: string | undefined
}

export interface ExecutableCandidate {
	label: string
	value: string
	description: string
}

/** The entry that opens a file dialog instead of choosing a candidate. */
export const browseEntryLabel = "Browse..."

/** The candidates to offer, most specific first.
 *
 * The configured value comes first because it is what the extension is using:
 * a picker that cannot show the current choice cannot be used to understand the
 * state. The PATH hit and the managed build follow. A machine with nothing
 * founded gets only the browse entry, so choosing it is the only action rather
 * than one of four.
 */
export function executableCandidates(inputs: ExecutablePickerInputs): ExecutableCandidate[] {
	const candidates: ExecutableCandidate[] = []
	const seen = new Set<string>()
	const add = (label: string, value: string, description: string): void => {
		const key = value.toLowerCase()
		if (!value || seen.has(key)) {
			return
		}
		seen.add(key)
		candidates.push({ label, value, description })
	}
	const configuredValue = inputs.configured.trim()
	// The default is the command name, not a path, and offering it next to the
	// files it resolves to is noise: it does not name a compiler.
	if (configuredValue && path.isAbsolute(configuredValue)) {
		add("Current setting", configuredValue, "What the extension is using now")
	}
	add(path.basename(inputs.onPath ?? ""), inputs.onPath ?? "", "Found on PATH")
	add(path.basename(inputs.managed ?? ""), inputs.managed ?? "", "Managed by this extension")
	if (candidates.length === 0) {
		candidates.push({
			label: browseEntryLabel,
			value: "",
			description: "V was not found. Choose an executable.",
		})
	}
	return candidates
}

/** The V compiler in use, and the two alternatives to offer for it. */
function readPickerInputs(folder?: vscode.WorkspaceFolder): ExecutablePickerInputs {
	return {
		configured: vscode.workspace
			.getConfiguration("v", folder)
			.get<string>("executablePath", "v"),
		onPath: findInPath("v"),
		managed: managedToolExecutable("v"),
	}
}

/** Register `v.selectExecutable`.
 *
 * The choice is written back to `v.executablePath`, which every task, run and
 * server start already resolves through, so one write is enough. A path the
 * user browses to is written only once it has been shown to exist, because a
 * configured command that does not resolve turns every later task into the
 * error the picker was opened to fix.
 */
export function registerSelectExecutable(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("v.selectExecutable", async () => {
			const folder = vscode.workspace.workspaceFolders?.[0]
			const candidates = executableCandidates(readPickerInputs(folder))
			const items = candidates.map((candidate) => ({
				label: candidate.label,
				description: candidate.description,
				value: candidate.value,
			}))
			items.push({ label: browseEntryLabel, description: "Pick a file", value: "" })
			const picked = await vscode.window.showQuickPick(items, {
				title: "V executable",
				placeHolder: "Which V compiler should this workspace use?",
			})
			if (!picked) {
				return
			}
			let chosen = picked.value
			if (chosen === "") {
				const browsed = await vscode.window.showOpenDialog({
					canSelectFiles: true,
					canSelectFolders: false,
					openLabel: "Use as V",
				})
				chosen = browsed?.[0]?.fsPath ?? ""
			}
			if (!chosen || !isExecutable(chosen)) {
				void vscode.window.showErrorMessage(
					`V: ${chosen || "No file"} is not an executable.`,
				)
				return
			}
			// A PATH lookup already served the old choice, so it cannot be reused
			// for the new one.
			resetPathLookupCache()
			await vscode.workspace
				.getConfiguration("v", folder)
				.update("executablePath", chosen, vscode.ConfigurationTarget.Workspace)
		}),
	)
}
