import * as assert from "assert"
import { describe, it } from "node:test"
import {
	documentFormats,
	renderModule,
	rootNameForFile,
	schemaFromCsv,
	schemaFromJson,
	schemaFromXml,
	structsFromValue,
} from "../decodeStruct"

const anyType = "json2.Any"

describe("decoder struct inference", () => {
	it("maps scalars to V types", () => {
		const schema = structsFromValue(
			"Config",
			{ name: "x", count: 3, big: 5000000000, ratio: 1.5, on: true },
			anyType,
		)
		assert.deepStrictEqual(schema.structs, [
			{
				name: "Config",
				fields: [
					{ name: "name", type: "string" },
					{ name: "count", type: "int" },
					{ name: "big", type: "i64" },
					{ name: "ratio", type: "f64" },
					{ name: "on", type: "bool" },
				],
			},
		])
		assert.strictEqual(schema.rootType, "Config")
		assert.strictEqual(schema.decodeFunction, "decode_config")
	})

	it("nests objects parent-first", () => {
		const schema = structsFromValue("Config", { meta: { active: true } }, anyType)
		assert.deepStrictEqual(
			schema.structs.map((struct) => struct.name),
			["Config", "Meta"],
		)
		assert.deepStrictEqual(schema.structs[0]?.fields, [{ name: "meta", type: "Meta" }])
	})

	it("renames keys that are not valid identifiers", () => {
		const schema = structsFromValue("Config", { "a-b": 1, type: "x", "9lives": true }, anyType)
		assert.deepStrictEqual(schema.structs[0]?.fields, [
			{ name: "a_b", type: "int", sourceKey: "a-b" },
			{ name: "type_", type: "string", sourceKey: "type" },
			{ name: "_9lives", type: "bool", sourceKey: "9lives" },
		])
	})

	it("falls back to Any for null, empty and mixed shapes", () => {
		const schema = structsFromValue(
			"Config",
			{ nothing: null, empty: {}, mixed: [1, "two"], uniform: [1, 2] },
			anyType,
		)
		assert.deepStrictEqual(schema.structs[0]?.fields, [
			{ name: "nothing", type: "json2.Any" },
			{ name: "empty", type: "json2.Any" },
			{ name: "mixed", type: "[]json2.Any" },
			{ name: "uniform", type: "[]int" },
		])
		assert.strictEqual(schema.structs.length, 1)
	})

	it("reads uniform object arrays as one struct", () => {
		const schema = structsFromValue("Users", [{ name: "a" }, { name: "b" }], anyType)
		assert.strictEqual(schema.rootType, "[]Users")
		assert.deepStrictEqual(schema.structs, [
			{ name: "Users", fields: [{ name: "name", type: "string" }] },
		])
		assert.strictEqual(schema.decodeFunction, "decode_users")
	})

	it("rejects differing array shapes and scalars", () => {
		assert.throws(() => structsFromValue("Root", 42, anyType), /top level/)
		assert.deepStrictEqual(structsFromValue("Root", [], anyType).structs, [])
		const schema = structsFromValue("Root", [{ a: 1 }, { b: 2 }], anyType)
		assert.strictEqual(schema.rootType, `[]${anyType}`)
		assert.deepStrictEqual(schema.structs, [])
	})

	it("numbers colliding struct names", () => {
		const schema = structsFromValue("Root", { a: { x: 1 }, b: { a: { y: 1 } } }, anyType)
		assert.deepStrictEqual(
			schema.structs.map((struct) => struct.name),
			["Root", "A", "B", "A2"],
		)
	})

	it("renders a module with rename attributes and a decode example", () => {
		const schema = structsFromValue("Config", { "a-b": 1, meta: { on: true } }, anyType)
		assert.strictEqual(
			renderModule(documentFormats.json, schema),
			[
				"import json2",
				"",
				"struct Config {",
				"\ta_b int @[json: 'a-b']",
				"\tmeta Meta",
				"}",
				"",
				"struct Meta {",
				"\ton bool",
				"}",
				"",
				"fn decode_config(data string) !Config {",
				"\treturn json2.decode[Config](data, json2.DecoderOptions{})",
				"}",
				"",
			].join("\n"),
		)
	})

	it("knows the toml and yaml call shapes", () => {
		const schema = structsFromValue("Cfg", { count: 1 }, "toml.Any")
		assert.deepStrictEqual(documentFormats.toml.importsFor(schema), ["toml"])
		assert.deepStrictEqual(documentFormats.toml.exampleFor(schema), [
			"fn decode_cfg(data string) !Cfg {",
			"\treturn toml.decode[Cfg](data)",
			"}",
		])
		assert.strictEqual(documentFormats.toml.renameAttribute("a-b"), " @[toml: 'a-b']")
		assert.deepStrictEqual(documentFormats.yaml.importsFor(schema), ["yaml"])
		assert.deepStrictEqual(documentFormats.yaml.exampleFor(schema), [
			"fn decode_cfg(data string) !Cfg {",
			"\treturn yaml.decode[Cfg](data)",
			"}",
		])
		assert.strictEqual(documentFormats.yaml.renameAttribute("a-b"), " @[json: 'a-b']")
	})

	it("loads XML documents instead of decoding structs", () => {
		const schema = structsFromValue("Catalog", { book: "x" }, "json2.Any")
		assert.deepStrictEqual(documentFormats.xml.importsFor(schema), ["encoding.xml"])
		assert.deepStrictEqual(documentFormats.xml.exampleFor(schema), [
			"// No struct decoder exists: load the document, then read fields",
			"// with get_elements_by_tag and friends.",
			"fn load_catalog(data string) !xml.XMLDocument {",
			"\treturn xml.XMLDocument.from_string(data)",
			"}",
		])
		assert.strictEqual(documentFormats.xml.renameAttribute("a-b"), "")
	})

	it("decodes CSV rows without a result", () => {
		const schema = structsFromValue("Users", [{ name: "a" }], "string")
		assert.deepStrictEqual(documentFormats.csv.importsFor(schema), ["encoding.csv"])
		assert.deepStrictEqual(documentFormats.csv.exampleFor(schema), [
			"fn decode_users(data string) []Users {",
			"\treturn csv.decode[Users](data)",
			"}",
		])
	})

	it("parses JSON documents end to end", () => {
		const schema = schemaFromJson("Shop", '{"name": "x", "count": 3}')
		assert.strictEqual(schema.rootType, "Shop")
		assert.deepStrictEqual(schema.structs[0]?.fields, [
			{ name: "name", type: "string" },
			{ name: "count", type: "int" },
		])
		assert.throws(() => schemaFromJson("Shop", "{nope"), /not valid JSON/)
	})

	it("parses XML documents end to end", () => {
		const schema = schemaFromXml("Catalog", "<catalog><book><title>x</title></book></catalog>")
		assert.strictEqual(schema.rootType, "Catalog")
		assert.deepStrictEqual(
			schema.structs.map((struct) => struct.name),
			["Catalog", "Book"],
		)
		assert.throws(
			() => schemaFromXml("Catalog", "<catalog><book></catalog>"),
			/Mismatched tags/,
		)
	})

	it("parses CSV documents end to end", () => {
		const schema = schemaFromCsv("Users", "name,count\namy,3\nbo,4\n")
		assert.strictEqual(schema.rootType, "[]Users")
		assert.deepStrictEqual(schema.structs[0]?.fields, [
			{ name: "name", type: "string" },
			{ name: "count", type: "int" },
		])
		assert.throws(() => schemaFromCsv("Users", ""), /no data rows/)
	})

	it("names roots after files", () => {
		assert.strictEqual(rootNameForFile("foo.json"), "Foo")
		assert.strictEqual(rootNameForFile("/w/dir/bar.toml"), "Bar")
		assert.strictEqual(rootNameForFile("noext"), "Noext")
		assert.strictEqual(rootNameForFile("9lives.json"), "Lives")
	})
})
