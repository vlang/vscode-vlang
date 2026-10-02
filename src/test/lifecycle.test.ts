import * as assert from "node:assert/strict"
import { describe, it } from "node:test"
import { currentVlsSettings, ServerEvent } from "./lifecycle.integration"

function disabledSettings(pid: number): ServerEvent {
	return {
		event: "settings",
		pid,
		settings: { vls: { diagnostics: { enabled: false }, inlayHints: { enabled: false } } },
	}
}

describe("VLS integration lifecycle synchronization", () => {
	it("waits for the latest initialized server instead of a stopped intermediate restart", () => {
		const events: ServerEvent[] = [
			{ event: "initialize", pid: 1 },
			disabledSettings(1),
			{ event: "shutdown", pid: 1 },
			{ event: "exit", pid: 1 },
			{ event: "initialize", pid: 2 },
			disabledSettings(2),
			{ event: "shutdown", pid: 2 },
			{ event: "exit", pid: 2 },
			{ event: "initialize", pid: 3 },
		]
		assert.equal(currentVlsSettings(events), undefined)

		const current = disabledSettings(3)
		events.push(current)
		assert.equal(currentVlsSettings(events), current)
	})

	it("rejects a server as soon as shutdown starts, before its exit is recorded", () => {
		const events: ServerEvent[] = [{ event: "initialize", pid: 1 }, disabledSettings(1)]
		assert.equal(currentVlsSettings(events)?.pid, 1)
		events.push({ event: "shutdown", pid: 1 })
		assert.equal(currentVlsSettings(events), undefined)
	})

	it("rejects an exited server even without a shutdown event", () => {
		assert.equal(
			currentVlsSettings([
				{ event: "initialize", pid: 1 },
				disabledSettings(1),
				{ event: "exit", pid: 1 },
			]),
			undefined,
		)
	})

	it("has no current settings before any server initializes", () => {
		assert.equal(currentVlsSettings([]), undefined)
		assert.equal(currentVlsSettings([{ event: "spawn", pid: 1 }]), undefined)
	})
})
