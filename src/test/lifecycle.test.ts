import * as assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
	assertEveryInitializedVlsConfigured,
	assertVlsStartupConfiguration,
	currentVlsSettings,
	ServerEvent,
} from "./lifecycle.integration"

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

/** The sequence the fixture run produces for the first server: one configuration at startup,
 * then one per later setting change, all delivered while the same client is still running.
 */
function startupThenSevenChanges(): ServerEvent[] {
	const events: ServerEvent[] = [
		{ event: "initialize", pid: 3673 },
		{ event: "initialized", pid: 3673 },
	]
	events.push(disabledSettings(3673))
	for (let change = 0; change < 7; change++) {
		events.push({ event: "settings", pid: 3673 })
	}
	return events
}

describe("VLS startup configuration assertions", () => {
	it("rejects a startup that sends configuration twice", () => {
		assert.throws(
			() =>
				assertVlsStartupConfiguration([
					{ event: "initialize", pid: 1 },
					{ event: "initialized", pid: 1 },
					{ event: "settings", pid: 1 },
					{ event: "settings", pid: 1 },
				]),
			/must receive exactly one startup configuration/,
		)
	})

	it("rejects a startup that sends configuration to no server", () => {
		assert.throws(
			() => assertVlsStartupConfiguration([{ event: "initialize", pid: 1 }]),
			/must initialize before checking configuration/,
		)
	})

	it("requires exactly one configuration at the startup checkpoint", () => {
		assertVlsStartupConfiguration([
			{ event: "initialize", pid: 1 },
			{ event: "initialized", pid: 1 },
			{ event: "settings", pid: 1 },
		])
	})

	it("accepts later setting changes at the end of a run", () => {
		assertEveryInitializedVlsConfigured(startupThenSevenChanges())
	})

	it("rejects an initialized server that never received configuration", () => {
		assert.throws(
			() =>
				assertEveryInitializedVlsConfigured([
					{ event: "initialize", pid: 1 },
					{ event: "initialized", pid: 1 },
					disabledSettings(2),
				]),
			/VLS 1 must receive its startup configuration/,
		)
	})
})
