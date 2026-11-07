import * as assert from "assert"
import { describe, it } from "node:test"
import type { ExtensionContext } from "vscode"
import { resetParseCache } from "../documentMemo"
import { editorFoldRanges, foldRanges, registerFolding } from "../folding"
import { FoldingRangeKind, resetVscode, state, Uri } from "./fixtures/vscode"

const blockSource = [
	"module shapes",
	"",
	"struct Point {",
	"\tx int",
	"}",
	"",
	"enum Colour {",
	"\tred",
	"}",
	"",
	"fn area(p Point) int {",
	"\treturn 0",
	"}",
	"",
].join("\n")

const importSource = [
	"module lists",
	"",
	"// said once and only once",
	"import os",
	"import strconv",
	"",
	"import strings",
	"",
	"fn main() {}",
	"",
].join("\n")

const selectiveImportSource = [
	"module web",
	"",
	"import net.http {",
	"\tMethod",
	"\tServer",
	"}",
	"import os",
	"",
	"fn main() {",
	"}",
	"",
].join("\n")

const regionSource = [
	"module demo",
	"",
	"// #region helpers",
	"fn helper() {}",
	"// #endregion",
	"",
].join("\n")

const nestedRegionSource = [
	"//#region outer",
	"// #region inner",
	"fn a() {}",
	"// #endregion inner",
	"//#endregion outer",
	"",
].join("\n")

const literalSource = [
	"module txt",
	"",
	"fn quote() {",
	"\tprintln('}')",
	'\tprintln("{")',
	"\t// a brace } in a comment",
	"\tif true { print('{') }",
	"}",
	"",
].join("\n")

const kindSource = [
	"import os",
	"import strconv",
	"",
	"// #region helpers",
	"fn helper() {",
	"}",
	"// #endregion",
	"",
].join("\n")

const plainSource = ["module main", "", "fn main() {}", ""].join("\n")

describe("fold ranges", () => {
	it("folds a declaration from its opening brace to the matching one", () => {
		assert.deepStrictEqual(foldRanges(blockSource), [
			{ start: 2, end: 4 },
			{ start: 6, end: 8 },
			{ start: 10, end: 12 },
		])
	})

	it("folds nothing for a brace pair on one line", () => {
		const source = ["module inline", "", "fn main() { println('hi') }", ""].join("\n")
		assert.deepStrictEqual(foldRanges(source), [])
	})

	it("folds a run of top-level imports and leaves a single import visible", () => {
		assert.deepStrictEqual(foldRanges(importSource), [{ start: 3, end: 4, kind: "imports" }])
	})

	it("reads the selective import group as one statement", () => {
		assert.deepStrictEqual(foldRanges(selectiveImportSource), [
			{ start: 2, end: 5 },
			{ start: 2, end: 6, kind: "imports" },
			{ start: 8, end: 9 },
		])
	})

	it("folds a region between its markers", () => {
		assert.deepStrictEqual(foldRanges(regionSource), [{ start: 2, end: 4, kind: "comment" }])
	})

	it("folds nested regions separately", () => {
		assert.deepStrictEqual(foldRanges(nestedRegionSource), [
			{ start: 0, end: 4, kind: "comment" },
			{ start: 1, end: 3, kind: "comment" },
		])
	})

	it("folds nothing for a region that is never closed", () => {
		const source = ["//#region never closed", "fn main() {}", ""].join("\n")
		assert.deepStrictEqual(foldRanges(source), [])
		assert.deepStrictEqual(foldRanges("// #region"), [])
	})

	it("ignores a closing marker with no region open", () => {
		const source = ["fn main() {}", "// #endregion", ""].join("\n")
		assert.deepStrictEqual(foldRanges(source), [])
	})

	it("ignores a bare #region directive, which is not V", () => {
		const source = ["#region helpers", "fn helper() {}", "#endregion", ""].join("\n")
		assert.deepStrictEqual(foldRanges(source), [])
	})

	it("reads braces inside literals and comments as text", () => {
		assert.deepStrictEqual(foldRanges(literalSource), [{ start: 2, end: 7 }])
	})

	it("folds a raw string that crosses lines without opening a fold", () => {
		const source = [
			"fn write() {",
			"\tos.write_file('a.txt', `",
			"line with a { brace",
			"`) or {}",
			"}",
			"",
		].join("\n")
		assert.deepStrictEqual(foldRanges(source), [{ start: 0, end: 4 }])
	})

	it("reports nothing for a document with no fold", () => {
		assert.deepStrictEqual(foldRanges(plainSource), [])
	})

	it("hands the same ranges back when there are some", () => {
		assert.deepStrictEqual(editorFoldRanges(blockSource), foldRanges(blockSource))
	})

	it("answers nothing when the document has no fold", () => {
		assert.strictEqual(editorFoldRanges(plainSource), undefined)
	})
})

describe("register folding", () => {
	function provide(source: string): { start: number; end: number; kind?: number }[] | undefined {
		resetVscode()
		// The memoised parse is keyed by document URI and version, which these
		// tests are not changing between calls.
		resetParseCache()
		const subscriptions: { dispose(): void }[] = []
		registerFolding({ subscriptions } as unknown as ExtensionContext)
		const provider = state.foldingRanges[0]
		assert.notStrictEqual(provider, undefined)
		return provider?.provideFoldingRanges({
			uri: Uri.file("main.v"),
			version: 1,
			getText: () => source,
		}) as { start: number; end: number; kind?: number }[] | undefined
	}

	it("offers the parsed ranges with the fold kind each one wants", () => {
		const ranges = provide(kindSource)
		assert.deepStrictEqual(
			ranges?.map((range) => [range.start, range.end, range.kind]),
			[
				[0, 1, FoldingRangeKind.Imports],
				[3, 6, FoldingRangeKind.Comment],
				[4, 5, undefined],
			],
		)
	})

	it("answers nothing for a document with no fold, leaving the editor its own", () => {
		assert.strictEqual(provide(plainSource), undefined)
	})

	it("registers on the context so the provider is disposed with the extension", () => {
		resetVscode()
		const subscriptions: { dispose(): void }[] = []
		registerFolding({ subscriptions } as unknown as ExtensionContext)
		assert.strictEqual(subscriptions.length, 1)
	})
})
