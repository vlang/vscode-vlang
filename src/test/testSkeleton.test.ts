import * as assert from "assert"
import { describe, it } from "node:test"
import { generateTestSkeleton, sourceFileName, testFileName } from "../testSkeleton"

const sourceFile = [
	"module calculator",
	"",
	"pub fn add(a int, b int) int {",
	"	return a + b",
	"}",
	"",
	"pub fn subtract(a int, b int) int {",
	"	return a - b",
	"}",
	"",
	"fn helper() {}",
	"",
].join("\n")

describe("V test skeleton", () => {
	it("generates one test function per public function", () => {
		const skeleton = generateTestSkeleton(sourceFile)
		assert.ok(skeleton)
		assert.deepStrictEqual(skeleton.tests, ["test_add", "test_subtract"])
		// The module name is carried over, so the test file is in the same module.
		assert.ok(skeleton.content.startsWith("module calculator\n"))
		// Each test has a placeholder assertion the user replaces.
		assert.ok(skeleton.content.includes("fn test_add() {\n\tassert true\n}"))
		assert.ok(skeleton.content.includes("fn test_subtract() {\n\tassert true\n}"))
		// A private function is not part of the public API, so it gets no test.
		assert.ok(!skeleton.content.includes("test_helper"))
	})

	it("returns nothing when there is nothing to test", () => {
		// No module declaration means the file is not a V module.
		assert.strictEqual(generateTestSkeleton("fn main() {}\n"), undefined)
		// A module with no public functions has nothing to test.
		assert.strictEqual(generateTestSkeleton("module empty\n\nfn private() {}\n"), undefined)
		assert.strictEqual(generateTestSkeleton(""), undefined)
	})

	it("names the test file after the source file", () => {
		// `foo.v` is tested by `foo_test.v` beside it. The full path is returned
		// because that is what the file is created at.
		assert.strictEqual(testFileName("foo.v"), "foo_test.v")
		assert.strictEqual(testFileName("/w/app/src/bar.v"), "/w/app/src/bar_test.v")
		assert.strictEqual(testFileName("no_extension"), "no_extension_test.v")
	})

	it("names the source file after the test file", () => {
		// The reverse mapping drives the toggle back. Anything else has
		// no source, including a stemless `_test.v`.
		assert.strictEqual(sourceFileName("foo_test.v"), "foo.v")
		assert.strictEqual(sourceFileName("/w/app/src/bar_test.v"), "/w/app/src/bar.v")
		assert.strictEqual(sourceFileName("a.b_test.v"), "a.b.v")
		assert.strictEqual(sourceFileName("foo.v"), undefined)
		assert.strictEqual(sourceFileName("_test.v"), undefined)
		assert.strictEqual(sourceFileName("foo_test.vv"), undefined)
	})
})
