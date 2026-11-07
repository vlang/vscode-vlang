import * as path from "path"
import { WorkspaceFolder } from "vscode"
import { migratedSetting } from "./settings"
import { configuredCommand, resolvedCommand } from "./vCommand"

/** The `v` compiler to use for a folder.
 *
 * Resolved the way VLS and the tasks resolve it, including the settings kept from
 * the former VLS extension, so a user who pointed `v.executablePath` somewhere
 * once gets the same compiler everywhere.
 *
 * A folder is required rather than taken from the active editor, because the
 * features that use this can serve more than one folder at a time, and a server
 * pointed at one project must not answer about another.
 *
 * Falls back to the configured command when it cannot be resolved to an existing
 * executable, so the caller reports a compiler that is missing rather than a
 * setting that is blank.
 */
export function vCommandFor(folder: WorkspaceFolder): string {
	const configured = migratedSetting("v", "executablePath", "vls", "vCommand", "v", folder.uri)
	return (
		resolvedCommand(configured, folder.uri.fsPath) ??
		configuredCommand(configured, folder.uri.fsPath)
	)
}

/** The `v` compiler for a program that may live outside any workspace folder.
 *
 * A file opened on its own has no folder, so there is no folder-scoped setting
 * to read; the global `v.executablePath` still applies, resolved against the
 * program's own directory. Falling back to a literal `v` here bypasses that
 * setting and breaks single-file users who rely on it.
 */
export function vCommandForProgram(programPath: string, folder?: WorkspaceFolder): string {
	if (folder) {
		return vCommandFor(folder)
	}
	const configured = migratedSetting("v", "executablePath", "vls", "vCommand", "v", undefined)
	const cwd = path.dirname(programPath)
	return resolvedCommand(configured, cwd) ?? configuredCommand(configured, cwd)
}
