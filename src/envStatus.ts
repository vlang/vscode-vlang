import * as path from "path"

/** Describing the V environment a workspace is using.
 *
 * The formatting is pure so it can be tested without a compiler. The gathering,
 * which runs `v version` and `vls --version`, lives in `envStatus.ts`.
 *
 * This answers the question that is otherwise hard to answer when two V
 * extensions exist and either can provide language support: which `v`, which
 * VLS, and is the server actually running.
 */

export interface EnvironmentInfo {
	/** Absolute path to the resolved `v`, or `undefined` when it cannot be resolved. */
	vPath: string | undefined
	/** The version `v` reported, or `undefined` when it could not be asked. */
	vVersion: string | undefined
	/** Absolute path to the resolved VLS, or `undefined` when it cannot be resolved. */
	vlsPath: string | undefined
	/** The version VLS reported, or `undefined` when it could not be asked. */
	vlsVersion: string | undefined
	/** Whether VLS is enabled in settings. */
	vlsEnabled: boolean
	/** Whether the VLS client is currently running. */
	vlsRunning: boolean
}

/** Render the environment as a document.
 *
 * A document rather than a notification, because the answer is longer than a
 * notification holds and the user may want to copy it into a bug report.
 */
export function renderEnvironment(info: EnvironmentInfo): string {
	const lines = ["# V environment", ""]
	lines.push(`V compiler: ${info.vPath ?? "not found"}`)
	if (info.vVersion) {
		lines.push(`V version: ${info.vVersion}`)
	}
	lines.push("")
	lines.push(`V language server: ${info.vlsPath ?? "not found"}`)
	if (info.vlsVersion) {
		lines.push(`VLS version: ${info.vlsVersion}`)
	}
	lines.push("")
	lines.push(`VLS enabled: ${info.vlsEnabled ? "yes" : "no"}`)
	lines.push(`VLS running: ${info.vlsRunning ? "yes" : "no"}`)
	lines.push("")
	lines.push(
		"Set `v.executablePath` to choose a different compiler, and `v.vls.command` to choose a different language server.",
	)
	return lines.join("\n")
}

/** A one-line summary, for a status bar item. */
export function summarizeEnvironment(info: EnvironmentInfo): string {
	const v = info.vPath ? path.basename(info.vPath) : "not found"
	const vls = info.vlsRunning ? "running" : info.vlsEnabled ? "stopped" : "disabled"
	return `V: ${v}, VLS: ${vls}`
}
