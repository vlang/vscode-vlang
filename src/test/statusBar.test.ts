import type { ExtensionContext } from "vscode"
import * as assert from "assert"
import { describe, it } from "node:test"
import { registerStatusBar, statusBarText } from "../statusBar"
import { resetVscode, state } from "./fixtures/vscode"

/** The bar is the first place a user learns the toolchain does not resolve, which
 * is the failure behind "there is no intellisense". These pin the strings and the
 * click target for every state it can be in.
 */
describe("status bar text", () => {
	it("names the resolved V", () => {
		assert.deepStrictEqual(
			statusBarText({ status: "found", tool: "v", name: "C:\\V\\v.exe" }),
			{
				text: "$(check) V: C:\\V\\v.exe",
				tooltip: "Click for V options.",
				command: "v.tools.checkForUpdates",
			},
		)
	})

	it("says so when V is missing, and offers the fixing action", () => {
		assert.deepStrictEqual(statusBarText({ status: "missing", tool: "v", name: "" }), {
			text: "$(warning) V: not found",
			tooltip: "V was not found. Click to provide it.",
			command: "v.tools.checkForUpdates",
		})
	})

	it("reports VLS separately, because it can be down while V works", () => {
		assert.strictEqual(
			statusBarText({ status: "found", tool: "vls", name: "vls" }).text,
			"$(check) VLS: vls",
		)
		assert.strictEqual(
			statusBarText({ status: "missing", tool: "vls", name: "" }).text,
			"$(warning) VLS: not found",
		)
	})
})

describe("register status bar", () => {
	it("shows one item per tool and disposes them with the extension", () => {
		resetVscode()
		const subscriptions: { dispose(): void }[] = []
		registerStatusBar({ subscriptions } as unknown as ExtensionContext)
		assert.strictEqual(state.statusBarItems.length, 2)
		assert.strictEqual(subscriptions.length, 2)
		assert.ok(state.statusBarItems.every((item) => item.text.length > 0))
	})
})
