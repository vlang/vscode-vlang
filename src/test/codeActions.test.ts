import * as assert from "assert"
import { describe, it } from "node:test"
import { documentEnd, testFileStrategy } from "../codeActions"

/** The overwrite path offered "Overwrite" and then built an edit that could only
 * apply to an absent file, so confirming it always failed. The strategy behind
 * the prompt is its own function now, which is what these pin down.
 */
describe("test file strategy", () => {
	it("creates the file when it is not there", () => {
		assert.strictEqual(testFileStrategy(false, false), "create")
	})

	it("replaces the file when it is there and the user confirms", () => {
		assert.strictEqual(testFileStrategy(true, true), "replace")
	})

	it("cancels when it is there and the user does not confirm", () => {
		assert.strictEqual(testFileStrategy(true, false), "cancel")
	})
})

describe("document end", () => {
	it("is the end of the last line", () => {
		assert.deepStrictEqual(documentEnd(3, "fn main() {}"), { line: 2, character: 12 })
	})

	it("is the start for a document of one empty line, so a replace is an insert", () => {
		// An empty file is reported as one empty line: the range is empty, so
		// replacing it leaves nothing of the old contents behind.
		assert.deepStrictEqual(documentEnd(1, ""), { line: 0, character: 0 })
	})

	it("is the start for a document with no lines at all", () => {
		assert.deepStrictEqual(documentEnd(0, ""), { line: 0, character: 0 })
	})
})
