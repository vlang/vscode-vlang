import * as assert from "assert"
import { describe, it } from "node:test"
import { parseImports } from "../importCost"

describe("import cost discovery", () => {
	it("finds single-line imports with aliases and selective lists", () => {
		const source = [
			"module main",
			"",
			"import os",
			"import foo.bar as fb",
			"import net.http { Client }",
			"fn main() {}",
			"",
		].join("\n")
		assert.deepStrictEqual(parseImports(source), [
			{ line: 2, module: "os" },
			{ line: 3, module: "foo.bar" },
			{ line: 4, module: "net.http" },
		])
	})

	it("finds the members of a grouped import block", () => {
		const source = [
			"module main",
			"",
			"import (",
			"\tos",
			"\tfoo.bar",
			")",
			"fn main() {}",
			"",
		].join("\n")
		assert.deepStrictEqual(parseImports(source), [
			{ line: 3, module: "os" },
			{ line: 4, module: "foo.bar" },
		])
	})

	it("opens a group with a trailing comment", () => {
		const source = ["module main", "", "import ( // stdlib", "\tos", ")", ""].join("\n")
		assert.deepStrictEqual(parseImports(source), [{ line: 3, module: "os" }])
	})

	it("ignores an unterminated group and non-import lines", () => {
		const source = ["fn main() {", "\tprintln('import os')", "}", ""].join("\n")
		assert.deepStrictEqual(parseImports(source), [])
	})
})
