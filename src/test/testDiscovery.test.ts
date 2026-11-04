import * as assert from "assert"
import { describe, it } from "node:test"
import {
	parseTestFile,
	parseTestFileStatus,
	parseTestOutput,
	selectionForItemId,
	testRunArgs,
} from "../testDiscovery"

const testFile = [
	"module main",
	"",
	"fn helper() {}",
	"",
	"fn test_one() {",
	"	assert true",
	"}",
	"",
	"fn test_two() {",
	"	assert false",
	"}",
	"",
	"// fn test_in_a_comment() {",
	"const not_a_test = 'fn test_in_a_string()'",
	"",
].join("\n")

describe("V test discovery", () => {
	it("finds the test functions in a test file", () => {
		const tests = parseTestFile(testFile)
		assert.deepStrictEqual(
			tests.map((test) => test.name),
			["test_one", "test_two"],
		)
		// The line is 1-based and points at the declaration, so the Test Explorer can
		// jump to it.
		assert.deepStrictEqual(
			tests.map((test) => test.line),
			[5, 9],
		)
	})

	it("ignores test-like text that is not a declaration", () => {
		// A comment and a string both contain `fn test_`, and neither is a test.
		// The regex is anchored to the start of a line, so both are skipped.
		const tests = parseTestFile(testFile)
		assert.ok(!tests.some((test) => test.name === "test_in_a_comment"))
		assert.ok(!tests.some((test) => test.name === "test_in_a_string"))
	})

	it("returns nothing for a file with no tests", () => {
		// A test file can hold only helpers, which is not an error.
		assert.deepStrictEqual(parseTestFile("module main\n\nfn helper() {}\n"), [])
		assert.deepStrictEqual(parseTestFile(""), [])
	})

	it("reads the outcomes a test run printed", () => {
		const output = [
			"--- PASS: test_one (0.00s)",
			"--- FAIL: test_two (0.00s)",
			"    main_test.v:5:5: assertion failed",
			"--- SKIP: test_three (0.00s)",
			"",
		].join("\n")
		assert.deepStrictEqual(parseTestOutput(output), [
			{ name: "test_one", passed: true },
			{ name: "test_two", passed: false, message: "--- FAIL: test_two (0.00s)" },
			{ name: "test_three", passed: false },
		])
	})

	it("reads the per-test lines a real -stats run prints", () => {
		// Measured with `v -nocolor -stats test` on V 0.5.2: the per-test lines
		// carry the module prefix, and the failing test is detailed in a
		// `path:line: fn test_name` block above its FAIL line.
		const output = [
			"---- Testing... ----------------------------------------------------------------",
			"running tests in: C:/proj/foo_test.v",
			"     OK    [1/3]     0.000 ms     1 assert | main.test_one()",
			"C:/proj/foo_test.v:2: fn test_two",
			"    assert false, 'boom'",
			"        Message: boom",
			"     FAIL  [2/3]     0.000 ms     1 assert | main.test_two()",
			"     OK    [3/3]     0.000 ms     1 assert | main.test_three()",
			'     Summary for running V tests in "foo_test.v": 1 failed, 2 passed, 3 total. Elapsed time: 0.000 ms.',
			"v : FAIL   102.351 ms C:/proj/foo_test.v",
			"--------------------------------------------------------------------------------",
			"Summary for all V _test.v files: 1 failed, 1 total. Elapsed time: 1154 ms, on 1 job. Comptime: 1026 ms. Runtime: 102 ms.",
			"",
		].join("\n")
		assert.deepStrictEqual(parseTestOutput(output), [
			{ name: "test_one", passed: true },
			{
				name: "test_two",
				passed: false,
				message: [
					"C:/proj/foo_test.v:2: fn test_two",
					"assert false, 'boom'",
					"Message: boom",
				].join("\n"),
			},
			{ name: "test_three", passed: true },
		])
	})

	it("reads failures from a run without per-test lines", () => {
		// Without `-stats` there is only the file line plus the failure headers,
		// so the headers are the failed outcomes.
		const output = [
			"---- Testing... ----------------------------------------------------------------",
			"v : FAIL    80.634 ms C:/proj/foo_test.v",
			"C:/proj/foo_test.v:2: fn test_two",
			"    assert false, 'boom'",
			"        Message: boom",
			"--------------------------------------------------------------------------------",
			"Summary for all V _test.v files: 1 failed, 1 total. Elapsed time: 993 ms, on 1 job. Comptime: 887 ms. Runtime: 80 ms.",
			"",
		].join("\n")
		assert.deepStrictEqual(parseTestOutput(output), [
			{
				name: "test_two",
				passed: false,
				message: [
					"C:/proj/foo_test.v:2: fn test_two",
					"assert false, 'boom'",
					"Message: boom",
				].join("\n"),
			},
		])
	})

	it("reads no outcomes from a compile error or an empty filter", () => {
		// A file that does not compile prints `path:line:col: error:` lines, which
		// must not be mistaken for `path:line: fn test_name` failure headers.
		const compileError = [
			"v : Compiler output from the default V compiler:",
			"C:/proj/bad_test.v:1:27: error: undefined ident: `tru`",
			"    1 | fn test_broken() { assert tru }",
			"Cannot compile file C:/proj/bad_test.v",
			"Summary for all V _test.v files: 1 failed, 1 total. Elapsed time: 807 ms, on 1 job. Comptime: 0 ms. Runtime: 781 ms.",
			"",
		].join("\n")
		assert.deepStrictEqual(parseTestOutput(compileError), [])
		// A `-run-only` filter that matches nothing runs nothing: no per-test
		// lines, no file line, and no failure headers either.
		const noMatch = [
			"---- Testing... ----------------------------------------------------------------",
			"v : --------------------------------------------------------------------------------",
			"Summary for all V _test.v files: 0 total. Elapsed time: 58 ms, on 1 job. Comptime: 0 ms. Runtime: 0 ms.",
			"",
		].join("\n")
		assert.deepStrictEqual(parseTestOutput(noMatch), [])
	})

	it("reads the file-level status of a run", () => {
		assert.strictEqual(
			parseTestFileStatus("v : OK      84.843 ms C:/proj/foo_test.v\n"),
			"passed",
		)
		assert.strictEqual(
			parseTestFileStatus("v : FAIL   102.351 ms C:/proj/foo_test.v\n"),
			"failed",
		)
		// Later files in a `-stats` directory run print `OK [n/m]` without the
		// `v :` prefix; per-test lines carry a `|` and must not count.
		assert.strictEqual(
			parseTestFileStatus(
				[
					"     OK    [1/1]     0.000 ms     1 assert | main.test_alpha()",
					"OK    [2/2]  1240.419 ms C:/proj/b_test.v",
				].join("\n"),
			),
			"passed",
		)
		assert.strictEqual(
			parseTestFileStatus(
				[
					"     OK    [1/1]     0.000 ms     1 assert | main.test_alpha()",
					"     Summary for all V _test.v files: 2 passed, 2 total. Elapsed time: 1755 ms.",
				].join("\n"),
			),
			undefined,
		)
		// Any failure wins over a pass.
		assert.strictEqual(
			parseTestFileStatus(
				[
					"v : OK    100.000 ms C:/proj/a_test.v",
					"v : FAIL    80.000 ms C:/proj/b_test.v",
				].join("\n"),
			),
			"failed",
		)
		assert.strictEqual(parseTestFileStatus(""), undefined)
		assert.strictEqual(parseTestFileStatus("Compiling...\nDone.\n"), undefined)
	})

	it("finds nothing in output that has no results", () => {
		assert.deepStrictEqual(parseTestOutput(""), [])
		assert.deepStrictEqual(parseTestOutput("Compiling...\nDone.\n"), [])
	})

	it("builds the run arguments for one test or a whole file", () => {
		// `-nocolor` keeps the output parseable, `-stats` prints one line per
		// test (without it only a file-level line is printed, which cannot be
		// mapped back to tests), and `-run-only` is the filter the Test
		// Explorer's selection maps onto.
		assert.deepStrictEqual(testRunArgs("/w/app/foo_test.v"), [
			"-nocolor",
			"-stats",
			"test",
			"/w/app/foo_test.v",
		])
		assert.deepStrictEqual(testRunArgs("/w/app/foo_test.v", "test_foo"), [
			"-nocolor",
			"-stats",
			"test",
			"/w/app/foo_test.v",
			"-run-only",
			"test_foo",
		])
	})

	it("reads a run selection from the item id, not the label", () => {
		// A file item's label is its basename, which matches no test: using it
		// as a `-run-only` filter ran nothing and errored every test.
		assert.deepStrictEqual(selectionForItemId("file:/w/app/foo_test.v"), {
			filePath: "/w/app/foo_test.v",
		})
		assert.deepStrictEqual(selectionForItemId("test:/w/app/foo_test.v::test_foo"), {
			filePath: "/w/app/foo_test.v",
			name: "test_foo",
		})
		assert.deepStrictEqual(selectionForItemId("test:C:\\w\\foo_test.v::test_foo"), {
			filePath: "C:\\w\\foo_test.v",
			name: "test_foo",
		})
		assert.strictEqual(selectionForItemId("file:"), undefined)
		assert.strictEqual(selectionForItemId("test:/w/app/foo_test.v"), undefined)
		assert.strictEqual(selectionForItemId("other:/w/app/foo_test.v"), undefined)
	})
})
