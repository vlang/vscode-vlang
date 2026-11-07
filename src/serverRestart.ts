/** Which settings, when changed, need a new language server process.
 *
 * Pure and `vscode`-free so the decision is testable without an editor, the way
 * `taskSpec.ts`, `vCommand.ts` and `coverageProfile.ts` are.
 */

/** The part of a configuration change the decision reads.
 *
 * `vscode.ConfigurationChangeEvent` satisfies it, and a test can build one from
 * a list of changed keys without an editor.
 */
export interface SettingChange {
	affectsConfiguration(section: string): boolean
}

/** Settings that decide what the server runs, so a change needs a restart.
 *
 * `v.vls.command`, `v.vls.args`, `v.executablePath` and their deprecated
 * `vls.*` aliases name the VLS binary and the V compiler it is pointed at; a
 * running server cannot be re-pointed at another process, so the manager stops
 * it and starts the new one. `v.vls.enable` starts or stops the client.
 *
 * The feature toggles are deliberately absent. `v.vls.inlayHints.enabled` and
 * `v.vls.diagnostics`, and the deprecated `vls.inlayHints.enabled` and
 * `vls.diagnostics.enabled`, reach a running server as a
 * `didChangeConfiguration` notification (`sendSettingsNow`), which is the whole
 * of the change they need. Listing them here stopped the server and started it
 * again only to reach the state the notification had already reached: the
 * workspace index was rebuilt, the crash-recovery budget reset and the status
 * bar flapped, all for a setting the server honours live.
 */
export const serverRestartSettings: readonly string[] = [
	"v.vls.enable",
	"v.vls.command",
	"v.vls.args",
	"v.executablePath",
	"vls.command",
	"vls.args",
	"vls.vCommand",
]

/** Whether this configuration change requires the server to be restarted. */
export function requiresServerRestart(change: SettingChange): boolean {
	return serverRestartSettings.some((setting) => change.affectsConfiguration(setting))
}
