import * as assert from "node:assert/strict"

/** Each successfully initialized fixture receives the configuration of its own startup once. */
export function assertVlsStartupConfiguration(events: { event: string; pid: number }[]): void {
	const initializedPids = new Set(
		events.filter((event) => event.event === "initialized").map((event) => event.pid),
	)
	assert.ok(initializedPids.size, "the fixture must initialize before checking configuration")
	for (const pid of initializedPids) {
		assert.equal(
			events.filter((event) => event.pid === pid && event.event === "settings").length,
			1,
			`VLS ${pid} must receive exactly one startup configuration, with no sender racing shutdown`,
		)
	}
}
