import * as assert from "assert"
import { describe, it } from "node:test"
import { EnvironmentInfo, renderEnvironment, summarizeEnvironment } from "../envStatus"

const info: EnvironmentInfo = {
	vPath: "/usr/local/bin/v",
	vVersion: "0.4.2",
	vlsPath: "/usr/local/bin/vls",
	vlsVersion: "0.0.3",
	vlsEnabled: true,
	vlsRunning: true,
}

describe("V environment status", () => {
	it("renders the environment as a document", () => {
		const document = renderEnvironment(info)
		// Every field is present, so the answer is complete rather than partial.
		assert.ok(document.includes("V compiler: /usr/local/bin/v"))
		assert.ok(document.includes("V version: 0.4.2"))
		assert.ok(document.includes("V language server: /usr/local/bin/vls"))
		assert.ok(document.includes("VLS version: 0.0.3"))
		assert.ok(document.includes("VLS enabled: yes"))
		assert.ok(document.includes("VLS running: yes"))
		// The settings that change the answer are named, so the user knows what to
		// change if the resolved path is not the one they expected.
		assert.ok(document.includes("v.executablePath"))
		assert.ok(document.includes("v.vls.command"))
	})

	it("says not found rather than leaving a blank when something is missing", () => {
		// A missing compiler is reported as such, not as an empty line.
		const document = renderEnvironment({
			vPath: undefined,
			vVersion: undefined,
			vlsPath: "/usr/local/bin/vls",
			vlsVersion: undefined,
			vlsEnabled: true,
			vlsRunning: false,
		})
		assert.ok(document.includes("V compiler: not found"))
		assert.ok(!document.includes("V version:"))
		assert.ok(document.includes("VLS enabled: yes"))
		assert.ok(document.includes("VLS running: no"))
	})

	it("summarizes the environment in one line", () => {
		assert.strictEqual(summarizeEnvironment(info), "V: v, VLS: running")
		assert.strictEqual(
			summarizeEnvironment({ ...info, vlsRunning: false, vlsEnabled: true }),
			"V: v, VLS: stopped",
		)
		assert.strictEqual(
			summarizeEnvironment({ ...info, vlsRunning: false, vlsEnabled: false }),
			"V: v, VLS: disabled",
		)
		// A missing compiler is named as such rather than showing an empty basename.
		assert.strictEqual(
			summarizeEnvironment({ ...info, vPath: undefined }),
			"V: not found, VLS: running",
		)
	})
})
