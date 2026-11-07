import type { TextDocument } from "vscode"
import * as assert from "assert"
import { describe, it } from "node:test"
import { parseByVersion, resetParseCache } from "../documentMemo"

function document(source: string, uri = "file:///main.v", version = 1): TextDocument {
	return {
		uri: { toString: () => uri },
		version,
		getText: () => source,
	} as unknown as TextDocument
}

/** Stands in for the providers that memoise different parses of the same document. */
const withoutTests = (_source: string): undefined => undefined
const mainLines = (source: string): number[] =>
	source.split("\n").flatMap((line, index) => (line.startsWith("fn main") ? [index] : []))

describe("parseByVersion", () => {
	it("memoises a parse per document version", () => {
		resetParseCache()
		let calls = 0
		const parse = (source: string): string[] => {
			calls += 1
			return source.split("\n")
		}
		const doc = document("a\nb")
		assert.deepEqual(parseByVersion(doc, parse), ["a", "b"])
		assert.deepEqual(parseByVersion(doc, parse), ["a", "b"])
		assert.equal(calls, 1)
	})

	it("does not hand one provider the result memoised for another", () => {
		// The test gutter and the debug lens provider both memoise a different parse of the
		// same document at the same version. Sharing the entry let the gutter's "no tests
		// here" undefined reach the debug provider, which then called .map on it.
		resetParseCache()
		const doc = document("module main\n\nfn main() {}")
		assert.equal(parseByVersion(doc, withoutTests), undefined)
		assert.deepEqual(parseByVersion(doc, mainLines), [2])
	})

	it("re-parses after the document changes", () => {
		resetParseCache()
		assert.deepEqual(parseByVersion(document("fn main() {}", "file:///a.v", 1), mainLines), [0])
		assert.deepEqual(
			parseByVersion(document("fn main() {}\nx", "file:///a.v", 2), mainLines),
			[0],
		)
	})
})
