import * as assert from "assert"
import { describe, it } from "node:test"
import { playgroundShareLink, sharePlaygroundCode } from "../playground"

function fakeFetch(response: { ok: boolean; status: number; json: unknown }): typeof fetch {
	return (async () => {
		return {
			ok: response.ok,
			status: response.status,
			json: async () => {
				if (typeof response.json === "string") {
					throw new SyntaxError("Unexpected token")
				}
				return response.json
			},
		} as Response
	}) as unknown as typeof fetch
}

describe("V playground sharing", () => {
	it("links a shared snippet by its hash", () => {
		assert.strictEqual(playgroundShareLink("21cf286fdb"), "https://play.vlang.io/p/21cf286fdb")
	})

	it("posts the code and resolves the link", async () => {
		let posted: { url: string; body: unknown } | undefined
		const post = (async (url: string, init: { body: unknown }) => {
			posted = { url, body: init.body }
			return {
				ok: true,
				status: 200,
				json: async () => ({ hash: "21cf286fdb", error: "" }),
			} as Response
		}) as unknown as typeof fetch
		const link = await sharePlaygroundCode("fn main() {}", post)
		assert.strictEqual(link, "https://play.vlang.io/p/21cf286fdb")
		assert.strictEqual(posted?.url, "https://play.vlang.io/share")
		const form = posted?.body as FormData
		assert.strictEqual(form.get("code"), "fn main() {}")
	})

	it("reports the server error", async () => {
		await assert.rejects(
			sharePlaygroundCode(
				"fn main() {}",
				fakeFetch({
					ok: true,
					status: 200,
					json: { hash: "", error: "No code was provided." },
				}),
			),
			/No code was provided\./,
		)
	})

	it("reports an HTTP failure", async () => {
		await assert.rejects(
			sharePlaygroundCode(
				"fn main() {}",
				fakeFetch({ ok: false, status: 502, json: { hash: "", error: "" } }),
			),
			/answered 502/,
		)
	})

	it("reports an unreachable server", async () => {
		const post = (() => Promise.reject(new Error("fetch failed"))) as unknown as typeof fetch
		await assert.rejects(sharePlaygroundCode("fn main() {}", post), /Could not reach/)
	})

	it("reports an unparseable answer", async () => {
		await assert.rejects(
			sharePlaygroundCode(
				"fn main() {}",
				fakeFetch({ ok: true, status: 200, json: "<html>" }),
			),
			/not a share response/,
		)
	})
})
