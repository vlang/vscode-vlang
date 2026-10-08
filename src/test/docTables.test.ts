import * as assert from "assert"
import { describe, it } from "node:test"
import { structsFromValue } from "../decodeStruct"
import {
	mergeRepeatShapes,
	parseCsvDocument,
	parseXmlDocument,
	typedCsvRecords,
} from "../docTables"

const anyType = "json2.Any"

describe("xml documents", () => {
	it("maps attributes, nesting and repeats to plain objects", () => {
		assert.deepStrictEqual(
			parseXmlDocument(
				[
					"<!-- a catalog -->",
					"<catalog>",
					'  <book id="1" lang="en">',
					"    <title>Fish</title>",
					"    <author>Alice</author>",
					"  </book>",
					'  <book id="2">',
					"    <title>Soup</title>",
					"    <author>Bob</author>",
					"  </book>",
					"</catalog>",
					"",
				].join("\n"),
			),
			{
				book: [
					{ id: "1", lang: "en", title: "Fish", author: "Alice" },
					{ id: "2", title: "Soup", author: "Bob" },
				],
			},
		)
	})

	it("keeps a single child a bare value and self-closing attrs an object", () => {
		assert.deepStrictEqual(parseXmlDocument('<a><b><c id="7"/></b></a>'), {
			b: { c: { id: "7" } },
		})
		assert.strictEqual(parseXmlDocument("<br/>"), "")
	})

	it("uses bare strings for text-only elements and #text beside attributes", () => {
		assert.strictEqual(parseXmlDocument("<title>Hi</title>"), "Hi")
		assert.deepStrictEqual(parseXmlDocument('<note pri="high">call</note>'), {
			pri: "high",
			"#text": "call",
		})
	})

	it("decodes entities and numeric references and skips comments", () => {
		assert.strictEqual(
			parseXmlDocument("<!-- gone --><a>&lt;<!-- gone -->&amp;&#65;&#x42;</a>"),
			"<&AB",
		)
		assert.deepStrictEqual(parseXmlDocument('<a b="x &quot;y&quot;">t</a>'), {
			b: 'x "y"',
			"#text": "t",
		})
	})

	it("rejects doctype declarations", () => {
		assert.throws(() => parseXmlDocument("<!DOCTYPE foo><a/>"), /octype/)
	})

	it("rejects processing instructions, including the xml declaration", () => {
		assert.throws(() => parseXmlDocument("<?target data?><a/>"), /rocessing instruction/)
		assert.throws(() => parseXmlDocument('<?xml version="1.0"?><a/>'), /rocessing instruction/)
	})

	it("rejects namespaces in tag and attribute names", () => {
		assert.throws(() => parseXmlDocument("<a:b/>"), /amespace/)
		assert.throws(() => parseXmlDocument('<a x:y="1"/>'), /amespace/)
	})

	it("rejects cdata sections", () => {
		assert.throws(() => parseXmlDocument("<a><![CDATA[x]]></a>"), /CDATA/)
	})

	it("rejects mixed content", () => {
		assert.throws(() => parseXmlDocument("<a>text<b/></a>"), /ixed content/)
	})

	it("rejects malformed documents loudly", () => {
		assert.throws(() => parseXmlDocument(""), /oot element/)
		assert.throws(() => parseXmlDocument("<a>"), /nclosed/)
		assert.throws(() => parseXmlDocument("<a></b>"), /ismatched/)
		assert.throws(() => parseXmlDocument("</a>"), /tray closing/)
		assert.throws(() => parseXmlDocument("<a/><b/>"), /ultiple root/)
		assert.throws(() => parseXmlDocument("<a>&bogus;</a>"), /nknown entity/)
		assert.throws(() => parseXmlDocument("<a>&12</a>"), /nterminated entity/)
		assert.throws(() => parseXmlDocument('<a b="1>'), /nterminated value/)
	})

	it("feeds xml values into struct inference", () => {
		const value = parseXmlDocument(
			'<catalog><book id="1"><title>Fish &amp; Chips</title></book></catalog>',
		)
		const schema = structsFromValue("Catalog", value, anyType)
		assert.strictEqual(schema.rootType, "Catalog")
		assert.deepStrictEqual(
			schema.structs.map((struct) => struct.name),
			["Catalog", "Book"],
		)
		assert.deepStrictEqual(schema.structs[1]?.fields, [
			{ name: "id", type: "string" },
			{ name: "title", type: "string" },
		])
	})
})

describe("csv documents", () => {
	it("reads headers and rows, with or without a trailing newline", () => {
		const expected = [
			{ name: "Alice", age: "3" },
			{ name: "Bob", age: "4" },
		]
		assert.deepStrictEqual(parseCsvDocument("name,age\nAlice,3\nBob,4\n"), expected)
		assert.deepStrictEqual(parseCsvDocument("name,age\nAlice,3\nBob,4"), expected)
	})

	it("handles quotes, commas, escapes, embedded newlines and crlf", () => {
		assert.deepStrictEqual(parseCsvDocument('a,b\r\n"x, y","p""q"\r\n"line1\nline2",z\r\n'), [
			{ a: "x, y", b: 'p"q' },
			{ a: "line1\nline2", b: "z" },
		])
	})

	it("returns [] for empty and header-only input", () => {
		assert.deepStrictEqual(parseCsvDocument(""), [])
		assert.deepStrictEqual(parseCsvDocument("a,b\n"), [])
		assert.deepStrictEqual(parseCsvDocument("a,b"), [])
	})

	it("throws on ragged rows", () => {
		assert.throws(() => parseCsvDocument("a,b\n1,2,3\n"), /ow 2.*expected 2/)
		assert.throws(() => parseCsvDocument("a,b\n1\n"), /ow 2.*expected 2/)
	})

	it("throws on unterminated and stray quotes", () => {
		assert.throws(() => parseCsvDocument('a,b\n"1,2\n'), /nterminated quoted/)
		assert.throws(() => parseCsvDocument('a\nb"c\n'), /tray quote/)
		assert.throws(() => parseCsvDocument('a\n"b"x\n'), /fter a closing quote/)
	})

	it("feeds csv rows into struct inference as strings", () => {
		const rows = parseCsvDocument("name,age\nAlice,3\nBob,4\n")
		const schema = structsFromValue("Row", rows, anyType)
		assert.strictEqual(schema.rootType, "[]Row")
		assert.deepStrictEqual(schema.structs, [
			{
				name: "Row",
				fields: [
					{ name: "name", type: "string" },
					{ name: "age", type: "string" },
				],
			},
		])
	})

	it("types csv columns across all rows", () => {
		const typed = typedCsvRecords(
			parseCsvDocument("name,age,ratio,ok\namy,3,1.5,true\nbo,4,2.5,false\n"),
		)
		assert.deepStrictEqual(typed, [
			{ name: "amy", age: 3, ratio: 1.5, ok: true },
			{ name: "bo", age: 4, ratio: 2.5, ok: false },
		])
		const schema = structsFromValue("Users", typed, anyType)
		assert.deepStrictEqual(schema.structs[0]?.fields, [
			{ name: "name", type: "string" },
			{ name: "age", type: "int" },
			{ name: "ratio", type: "f64" },
			{ name: "ok", type: "bool" },
		])
	})

	it("keeps mixed csv columns as strings", () => {
		const typed = typedCsvRecords(parseCsvDocument("id,note\n1,hi\nx,bye\n"))
		assert.deepStrictEqual(typed, [
			{ id: "1", note: "hi" },
			{ id: "x", note: "bye" },
		])
	})

	it("merges repeat siblings with differing shapes", () => {
		assert.deepStrictEqual(mergeRepeatShapes([{ a: 1 }, { b: "x" }]), [{ a: 1, b: "x" }])
		assert.deepStrictEqual(mergeRepeatShapes([{ a: 1 }, { a: 2 }]), [{ a: 1 }])
		assert.deepStrictEqual(mergeRepeatShapes("text"), "text")
		assert.deepStrictEqual(mergeRepeatShapes({ a: [{ x: 1 }, { y: 2 }] }), {
			a: [{ x: 1, y: 2 }],
		})
	})
})
