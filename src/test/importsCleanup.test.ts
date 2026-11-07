import * as assert from "assert"
import { describe, it } from "node:test"
import {
	removeDuplicateImports,
	removeUnusedImports,
	sortImports,
	unusedImports,
} from "../importsCleanup"

describe("sort imports", () => {
	it("sorts a contiguous run in case-sensitive byte order", () => {
		const source = ["import zebra", "import apple", "import Mango", ""].join("\n")
		const expected = ["import Mango", "import apple", "import zebra", ""].join("\n")
		assert.strictEqual(sortImports(source), expected)
	})

	it("sorts dotted paths by their full path", () => {
		const source = ["import os", "import net.http", "import json", ""].join("\n")
		const expected = ["import json", "import net.http", "import os", ""].join("\n")
		assert.strictEqual(sortImports(source), expected)
	})

	it("carries comments attached above each import along", () => {
		const source = ["import zebra", "// belongs to apple", "import apple", ""].join("\n")
		const expected = ["// belongs to apple", "import apple", "import zebra", ""].join("\n")
		assert.strictEqual(sortImports(source), expected)
	})

	it("leaves a trailing comment of the run in place", () => {
		const source = ["import b", "import a", "// trailing note", "fn main() {}", ""].join("\n")
		const expected = ["import a", "import b", "// trailing note", "fn main() {}", ""].join("\n")
		assert.strictEqual(sortImports(source), expected)
	})

	it("treats blank lines as run separators", () => {
		const source = ["import b", "import a", "", "import d", "import c", ""].join("\n")
		const expected = ["import a", "import b", "", "import c", "import d", ""].join("\n")
		assert.strictEqual(sortImports(source), expected)
	})

	it("is a no-op without imports or when already sorted", () => {
		const plain = "module main\n\nfn main() {}\n"
		assert.strictEqual(sortImports(plain), plain)
		const sorted = "import a\nimport b\n"
		assert.strictEqual(sortImports(sorted), sorted)
		const singleton = "import b\n\nimport a\n"
		assert.strictEqual(sortImports(singleton), singleton)
	})
})

describe("remove duplicate imports", () => {
	it("drops exact duplicates, keeping the first", () => {
		const source = ["import os", "import json", "import os", ""].join("\n")
		const expected = ["import os", "import json", ""].join("\n")
		assert.strictEqual(removeDuplicateImports(source), expected)
	})

	it("keeps lines that differ by more than the module path", () => {
		const source = ["import os", "import os // helper", ""].join("\n")
		assert.strictEqual(removeDuplicateImports(source), source)
	})

	it("is a no-op without duplicates", () => {
		const source = "import a\nimport b\n"
		assert.strictEqual(removeDuplicateImports(source), source)
	})
})

describe("unused imports", () => {
	it("reports names with no word-boundary use outside import lines", () => {
		const source = ["import os", "import json", "fn main() {", "\tprintln('hi')", "}", ""].join(
			"\n",
		)
		assert.deepStrictEqual(unusedImports(source), ["os", "json"])
	})

	it("treats qualified usage as used", () => {
		const source = [
			"import os",
			"import net.http",
			"fn main() {",
			"\tprintln(os.args.len)",
			"\tprintln(http.Method.get.str())",
			"}",
			"",
		].join("\n")
		assert.deepStrictEqual(unusedImports(source), [])
	})

	it("matches on the last dotted segment", () => {
		const source = ["import net.http", "fn main() {}", ""].join("\n")
		assert.deepStrictEqual(unusedImports(source), ["http"])
	})

	it("ignores substring matches inside longer words", () => {
		const source = ["import os", "fn main() {", "\tcost := 1", "\tprintln(cost)", "}", ""].join(
			"\n",
		)
		assert.deepStrictEqual(unusedImports(source), ["os"])
	})

	it("bails out on selective imports", () => {
		const source = ["import foo { Bar }", "import os", "fn main() {}", ""].join("\n")
		assert.deepStrictEqual(unusedImports(source), [])
	})

	it("bails out on aliased imports", () => {
		const source = ["import foo as f", "import os", "fn main() {}", ""].join("\n")
		assert.deepStrictEqual(unusedImports(source), [])
	})
})

describe("remove unused imports", () => {
	it("removes only the unused lines", () => {
		const source = [
			"import os",
			"import json",
			"fn main() {",
			"\tprintln(json.encode(1))",
			"}",
			"",
		].join("\n")
		const expected = ["import json", "fn main() {", "\tprintln(json.encode(1))", "}", ""].join(
			"\n",
		)
		assert.strictEqual(removeUnusedImports(source), expected)
	})

	it("is a no-op when everything is used", () => {
		const source = ["import os", "fn main() {", "\tprintln(os.args.len)", "}", ""].join("\n")
		assert.strictEqual(removeUnusedImports(source), source)
	})

	it("is a no-op when bailing on selective or aliased imports", () => {
		const selective = ["import foo { Bar }", "import os", "fn main() {}", ""].join("\n")
		assert.strictEqual(removeUnusedImports(selective), selective)
		const aliased = ["import foo as f", "import os", "fn main() {}", ""].join("\n")
		assert.strictEqual(removeUnusedImports(aliased), aliased)
	})
})
