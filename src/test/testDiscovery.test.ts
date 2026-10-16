import * as assert from "assert"
import { describe, it } from "node:test"
import { parseTestFile, parseTestOutput, testRunArgs } from "../testDiscovery"

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

	it("finds nothing in output that has no results", () => {
		assert.deepStrictEqual(parseTestOutput(""), [])
		assert.deepStrictEqual(parseTestOutput("Compiling...\nDone.\n"), [])
	})

	it("builds the run arguments for one test or a whole file", () => {
		// `-nocolor` keeps the output parseable, and `-run-only` is the filter the
		// Test Explorer's selection maps onto.
		assert.deepStrictEqual(testRunArgs("/w/app/foo_test.v"), [
			"-nocolor",
			"test",
			"/w/app/foo_test.v",
		])
		assert.deepStrictEqual(testRunArgs("/w/app/foo_test.v", "test_foo"), [
			"-nocolor",
			"test",
			"/w/app/foo_test.v",
			"-run-only",
			"test_foo",
		])
	})
})
