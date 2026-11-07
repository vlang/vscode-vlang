import * as assert from "assert"
import { describe, it } from "node:test"
import { saveDocuments } from "../taskSpec"

/** Documents are saved together before a task runs, so the caller learns about a
 * failure only after every document has been given its chance. These tests pin that
 * behaviour and that the parallel form reports a partial failure as a failure.
 */
describe("saveDocuments", () => {
	it("saves every document and reports success", async () => {
		const order: number[] = []
		const saved = await saveDocuments(
			[0, 1, 2].map((index) => ({
				save: () => {
					order.push(index)
					return Promise.resolve(true)
				},
			})),
		)
		assert.ok(saved)
		assert.deepStrictEqual(order, [0, 1, 2])
	})

	it("attempts the rest after one save fails", async () => {
		const attempted: number[] = []
		const saved = await saveDocuments(
			[0, 1, 2].map((index) => ({
				save: () => {
					attempted.push(index)
					return Promise.resolve(index !== 1)
				},
			})),
		)
		// A document that cannot be saved fails the task, but the others were still
		// worth saving: leaving them dirty would build stale sources.
		assert.strictEqual(saved, false)
		assert.deepStrictEqual(attempted, [0, 1, 2])
	})

	it("reports success for nothing to save", async () => {
		assert.strictEqual(await saveDocuments([]), true)
	})
})
