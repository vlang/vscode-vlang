import * as assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
	detectTemplateScriptKind,
	isVebTemplateFile,
	parseVebDirective,
	resolveVebTemplatePath,
} from "../vebTemplate"

describe("vebTemplate", () => {
	it("recognizes template files by extension and templates folder", () => {
		assert.equal(isVebTemplateFile("/w/templates/index.html"), true)
		assert.equal(isVebTemplateFile("/w/page.vhtml"), true)
		assert.equal(isVebTemplateFile("/w/page.vtml"), true)
		assert.equal(isVebTemplateFile("/w/main.v"), false)
		assert.equal(isVebTemplateFile("/w/index.html"), false)
	})

	it("parses directives and variables", () => {
		assert.deepEqual(parseVebDirective("@if user", 0)?.kind, "if")
		assert.deepEqual(parseVebDirective("@for u in users", 1)?.kind, "for")
		assert.deepEqual(parseVebDirective("@end", 2)?.kind, "end")
		assert.deepEqual(parseVebDirective("@include 'header.html'", 3), {
			kind: "include",
			value: "header.html",
			line: 3,
		})
		assert.deepEqual(parseVebDirective("<h1>@title</h1>", 4)?.kind, "variable")
		assert.deepEqual(parseVebDirective("<p>${name}</p>", 5)?.kind, "interpolation")
	})

	it("resolves template paths against templates/", () => {
		const resolved = resolveVebTemplatePath("index.html", "/w/src", "/w")
		assert.ok(resolved.toLowerCase().includes("templates"))
	})

	it("auto-detects jsx from babel script markers", () => {
		assert.equal(
			detectTemplateScriptKind("index.html", '<script type="text/babel">x</script>'),
			"jsx",
		)
		assert.equal(detectTemplateScriptKind("a.tsx", "<div/>"), "tsx")
		assert.equal(detectTemplateScriptKind("index.html", "<p>hi</p>"), "html")
	})
})
