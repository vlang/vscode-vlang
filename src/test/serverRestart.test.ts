import * as assert from "node:assert/strict"
import { describe, it } from "node:test"
import { requiresServerRestart, type SettingChange } from "../serverRestart"

/** A change to these settings, in the shape the manager's handler receives.
 *
 * `affectsConfiguration` answers for a section, so a helper that matches the
 * full dotted keys — how the extension's own settings are named — is enough to
 * drive the decision a real change makes.
 */
function changeOf(...changed: string[]): SettingChange {
	return {
		affectsConfiguration: (section) => changed.includes(section),
	}
}

describe("server restart settings", () => {
	it("restarts only when the change names the process the server runs", () => {
		for (const setting of [
			"v.vls.command",
			"v.vls.args",
			"v.executablePath",
			"vls.command",
			"vls.args",
			"vls.vCommand",
			"v.vls.enable",
		]) {
			assert.equal(
				requiresServerRestart(changeOf(setting)),
				true,
				`a change to ${setting} must restart the server`,
			)
		}
	})

	it("leaves the live-pushed feature toggles to the settings notification", () => {
		for (const setting of [
			"v.vls.diagnostics",
			"v.vls.inlayHints.enabled",
			"vls.diagnostics.enabled",
			"vls.inlayHints.enabled",
		]) {
			assert.equal(
				requiresServerRestart(changeOf(setting)),
				false,
				`a change to ${setting} must not restart the server`,
			)
		}
	})

	it("ignores a setting that is not the server's at all", () => {
		for (const setting of [
			"v.tools.checkForUpdates",
			"v.vls.coverage.enabled",
			"vls.coverage.enabled",
			"editor.tabSize",
		]) {
			assert.equal(requiresServerRestart(changeOf(setting)), false)
		}
	})

	it("still restarts when a toggle changes beside the server command", () => {
		const both = changeOf("v.vls.diagnostics", "v.vls.command")
		assert.equal(requiresServerRestart(both), true)
	})

	it("leaves the server alone when nothing the extension owns changed", () => {
		assert.equal(requiresServerRestart(changeOf()), false)
	})
})
