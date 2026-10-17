import * as assert from "assert"
import { describe, it } from "node:test"
import { emptyLiteralAt, fillStructBody, structFields, zeroValueFor } from "../fillStruct"

const sourceFile = [
	"module shapes",
	"",
	"struct Point {",
	"	x int",
	"	y int",
	"}",
	"",
	"struct Labeled {",
	"pub:",
	"	label string",
	"pub mut:",
	"	count int",
	"	// trailing comment",
	"	ratio f64 = 1.0",
	"	@[deprecated]",
	"	legacy string",
	"}",
	"",
].join("\n")

describe("fill struct fields", () => {
	it("reads fields in declaration order", () => {
		assert.deepStrictEqual(structFields(sourceFile, "Point"), [
			{ name: "x", type: "int" },
			{ name: "y", type: "int" },
		])
	})

	it("skips sections, comments, attributes and defaults", () => {
		assert.deepStrictEqual(structFields(sourceFile, "Labeled"), [
			{ name: "label", type: "string" },
			{ name: "count", type: "int" },
			{ name: "ratio", type: "f64" },
			{ name: "legacy", type: "string" },
		])
	})

	it("finds nothing when the struct is absent or unclosed", () => {
		assert.strictEqual(structFields(sourceFile, "Missing"), undefined)
		assert.strictEqual(structFields("struct Open {\n\tx int\n", "Open"), undefined)
		assert.deepStrictEqual(structFields("struct Empty {\n}\n", "Empty"), [])
	})

	it("renders placeholder values per type", () => {
		assert.strictEqual(zeroValueFor("int"), "0")
		assert.strictEqual(zeroValueFor("u64"), "0")
		assert.strictEqual(zeroValueFor("f64"), "0.0")
		assert.strictEqual(zeroValueFor("bool"), "false")
		assert.strictEqual(zeroValueFor("string"), "''")
		assert.strictEqual(zeroValueFor("[]int"), "[]")
		assert.strictEqual(zeroValueFor("map[string]int"), "{}")
		assert.strictEqual(zeroValueFor("?int"), "none")
		assert.strictEqual(zeroValueFor("Point"), "Point{}")
	})

	it("locates an empty literal on its line", () => {
		assert.deepStrictEqual(emptyLiteralAt("\tmut p := Point{}"), {
			name: "Point",
			start: 15,
			end: 17,
		})
		assert.strictEqual(emptyLiteralAt("\tmut p := Point{x: 1}"), undefined)
		assert.strictEqual(emptyLiteralAt("// Point{}"), undefined)
	})

	it("renders the filled body", () => {
		assert.strictEqual(
			fillStructBody([
				{ name: "x", type: "int" },
				{ name: "label", type: "string" },
			]),
			"{\n\tx: 0,\n\tlabel: '',\n}",
		)
	})
})
