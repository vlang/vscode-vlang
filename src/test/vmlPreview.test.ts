import * as assert from "assert"
import { describe, it } from "node:test"
import { evaluateLength, parseVml, renderVmlDocument } from "../vmlPreview"

describe("VML preview", () => {
	it("parses the counter screen with nested blocks", () => {
		const nodes = parseVml(
			"Screen {\n\tRectangle {\n\t\tid: card\n\t\tLabel {\n\t\t\ttext: app.count\n\t\t}\n\t}\n}",
		)
		assert.strictEqual(nodes.length, 1)
		assert.strictEqual(nodes[0]?.children.length, 1)
		assert.strictEqual(nodes[0]?.children[0]?.children.length, 1)
	})

	it("evaluates layout expressions against laid-out ids", () => {
		assert.strictEqual(evaluateLength("card.width - 128", { "card.width": 248 }, 0), 120)
		assert.strictEqual(evaluateLength("16px", {}, 0), 16)
	})

	it("renders style rules and inline props", () => {
		const { html, blocks } = renderVmlDocument(
			"Screen {\n\tbackground: #F1F5F9\n\tStyle {\n\t\tButton.action {\n\t\t\tbackground: #3478D4;\n\t\t}\n\t}\n\tButton {\n\t\tclass: action\n\t\ttext: \"Count\"\n\t\tx: 10\n\t\ty: 10\n\t\twidth: 96\n\t\theight: 40\n\t}\n}",
		)
		assert.ok(blocks >= 1)
		assert.ok(html.includes("#3478d4") || html.includes("#3478D4"))
		assert.ok(html.includes("Count"))
	})
})
