import * as assert from "node:assert/strict"

export type ServerEvent = {
	event: string
	pid: number
	uri?: string
	settings?: { vls?: { diagnostics?: { enabled?: boolean }; inlayHints?: { enabled?: boolean } } }
}

/** Settings belong to the newest initialized server only while it has not shut down. */
export function currentVlsSettings(events: ServerEvent[]): ServerEvent | undefined {
	const current = events.filter((event) => event.event === "initialize").at(-1)
	if (!current) return undefined
	if (
		events.some(
			(event) =>
				event.pid === current.pid && (event.event === "shutdown" || event.event === "exit"),
		)
	) {
		return undefined
	}
	return events.filter((event) => event.pid === current.pid && event.event === "settings").at(-1)
}

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
