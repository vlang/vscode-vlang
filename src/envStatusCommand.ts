import { execFile as _execFile } from "child_process"
import { promisify } from "util"
import * as vscode from "vscode"
import { getVls, isVlsEnabled } from "./langserver"
import { EnvironmentInfo, renderEnvironment } from "./envStatus"
import { vCommandFor } from "./vExecutable"

const execFile = promisify(_execFile)

/** How long to wait for a version query. */
const versionTimeoutMs = 10_000

/** Ask a binary for its version, or `undefined` when it cannot be asked.
 *
 * A binary that is missing, not executable, or too old to support `--version`
 * all return `undefined` rather than throwing, because the caller is reporting
 * the environment and a missing version is part of that report.
 */
async function versionOf(command: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFile(command, ["--version"], { timeout: versionTimeoutMs })
		return stdout.trim() || undefined
	} catch {
		return undefined
	}
}

/** Ask VLS for its path, or `undefined` when it cannot be resolved.
 *
 * `getVls` throws when the binary is missing, which is a normal state to report
 * rather than an error to propagate.
 */
function safeGetVls(): string | undefined {
	try {
		return getVls()
	} catch {
		return undefined
	}
}

/** Gather the environment for a folder.
 *
 * Every field is best-effort. A missing compiler or an old VLS is reported as
 * such rather than failing the whole query, because the point is to show what is
 * actually there.
 */
export async function gatherEnvironment(
	folder: vscode.WorkspaceFolder | undefined,
	vlsRunning: boolean,
): Promise<EnvironmentInfo> {
	const vPath = folder ? vCommandFor(folder) : undefined
	const vlsPath = folder ? safeGetVls() : undefined
	// Awaited one at a time rather than through Promise.all, because the two
	// branches have different types and the combined tuple is harder to read than
	// two lines.
	const vVersion = vPath ? await versionOf(vPath) : undefined
	const vlsVersion = vlsPath ? await versionOf(vlsPath) : undefined
	return {
		vPath,
		vVersion,
		vlsPath,
		vlsVersion,
		vlsEnabled: isVlsEnabled(),
		vlsRunning,
	}
}

/** `V: Show Environment Status`
 *
 * Shows which `v` and which VLS the extension resolved, what versions they
 * report, and whether the server is running. The answer is written to a document
 * so it can be copied into a bug report.
 */
export async function showEnvironmentStatus(vlsRunning: boolean): Promise<void> {
	const editor = vscode.window.activeTextEditor
	const folder = editor
		? vscode.workspace.getWorkspaceFolder(editor.document.uri)
		: vscode.workspace.workspaceFolders?.[0]
	const info = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: "Reading V environment..." },
		() => gatherEnvironment(folder, vlsRunning),
	)
	const document = await vscode.workspace.openTextDocument({
		language: "markdown",
		content: renderEnvironment(info),
	})
	await vscode.window.showTextDocument(document, { preview: true })
}
