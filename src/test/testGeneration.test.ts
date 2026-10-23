import * as assert from "assert"
import { describe, it } from "node:test"
import {
	planTestGeneration,
	ExistingTest,
	testFunctionNames,
	UntestedFunction,
} from "../testGeneration"

const untested = (...lines: [string, number][]): UntestedFunction[] =>
	lines.map(([name, line]) => ({ name, line }))

const absentTest = (testPath: string): ExistingTest => ({ testPath, content: undefined })

describe("test generation plan", () => {
	it("creates a test file when there is none", () => {
		const plan = planTestGeneration(untested(["parse_heading", 13]), absentTest("p_test.v"))
		assert.strictEqual(plan.kind, "create")
		if (plan.kind !== "create") {
			return
		}
		assert.deepStrictEqual(
			plan.functions.map((fn) => fn.name),
			["parse_heading"],
		)
		assert.strictEqual(plan.test.testPath, "p_test.v")
	})

	it("appends when a test file already exists", () => {
		const test: ExistingTest = {
			testPath: "p_test.v",
			content: "module p\n\nfn test_parse_text() {\n\tassert true\n}\n",
		}
		const plan = planTestGeneration(untested(["parse_text", 3], ["parse_heading", 13]), test)
		assert.strictEqual(plan.kind, "append")
		if (plan.kind !== "append") {
			return
		}
		// A function that already has a test is left alone.
		assert.deepStrictEqual(
			plan.functions.map((fn) => fn.name),
			["parse_heading"],
		)
	})

	it("reports up to date when every untested function has a test", () => {
		const test: ExistingTest = {
			testPath: "p_test.v",
			content: "module p\n\nfn test_parse_heading() {\n\tassert true\n}\n",
		}
		const plan = planTestGeneration(untested(["parse_heading", 13]), test)
		assert.strictEqual(plan.kind, "up-to-date")
	})

	it("offers nothing when no function is untested", () => {
		const plan = planTestGeneration([], absentTest("p_test.v"))
		assert.strictEqual(plan.kind, "unavailable")
		if (plan.kind !== "unavailable") {
			return
		}
		assert.match(plan.reason, /no untested function/)
	})

	it("offers nothing when a test file exists and holds everything", () => {
		const test: ExistingTest = {
			testPath: "p_test.v",
			content: "module p\n\nfn test_parse_heading() {\n\tassert true\n}\n",
		}
		// The same plan as up-to-date, reached with an absent list of names.
		const plan = planTestGeneration(untested(["parse_heading", 13]), test, new Set())
		assert.strictEqual(plan.kind, "append")
	})
})

describe("existing test function names", () => {
	it("reads a name from a declaration line", () => {
		// The name is the bare function name, which is what a coverage report
		// calls the source function: `foo` is tested by `fn test_foo()`.
		const names = testFunctionNames("module p\n\nfn test_add() {\n\tassert true\n}\n")
		assert.deepStrictEqual([...names], ["add"])
	})

	it("reads names from indented declarations", () => {
		const names = testFunctionNames(
			["module p", "", "fn test_add() {", "}", "", "\tfn test_nested() {"].join("\n"),
		)
		assert.deepStrictEqual([...names].sort(), ["add", "nested"])
	})

	it("ignores a call, a comment and a function that is not a test", () => {
		const names = testFunctionNames(
			[
				"module p",
				"",
				"// fn test_commented() {",
				"fn helper() {}",
				"",
				"fn main() {",
				"\ttest_add()",
				"}",
			].join("\n"),
		)
		assert.deepStrictEqual([...names], [])
	})

	it("reads a file that does not compile", () => {
		// The generator must see the names anyway, or it would duplicate them.
		const names = testFunctionNames("module p\n\nfn test_broken(\n")
		assert.deepStrictEqual([...names], ["broken"])
	})
})
