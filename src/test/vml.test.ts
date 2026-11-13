import * as assert from "assert"
import { describe, it } from "node:test"
import {
	blockAtLine,
	collectRules,
	hoverTextFor,
	matchingRules,
	parseVml,
	resolvedDeclarations,
} from "../vml"

const counter = `Screen {
	id: root
	background: #F1F5F9
	Style {
		Button.action {
			background: #3478D4;
			color: #FFFFFF;
		}
		Label.count { color: #111827; font-size: 20px; }
	}
	Rectangle {
		id: card
		class: card
		Button {
			id: increment
			class: action
			text: "Count"
			background: #000000
		}
		Label {
			id: count
			class: count
			text: app.count
		}
	}
}
`

describe("VML style resolution", () => {
	it("parses nested blocks with line numbers", () => {
		const nodes = parseVml(counter)
		assert.strictEqual(nodes.length, 1)
		const screen = nodes[0]
		assert.strictEqual(screen?.kind, "Screen")
		assert.strictEqual(screen?.children.length, 1)
		assert.strictEqual(screen?.children[0]?.children.length, 2)
	})

	it("collects Style rules instead of element children", () => {
		const rules = collectRules(parseVml(counter))
		assert.strictEqual(rules.length, 2)
		assert.deepStrictEqual(
			rules.map((rule) => `${rule.kind}.${rule.className}`),
			["Button.action", "Label.count"],
		)
	})

	it("matches rules by kind and class", () => {
		const nodes = parseVml(counter)
		const rules = collectRules(nodes)
		const button = nodes[0]?.children[0]?.children[0]
		assert.ok(button)
		assert.deepStrictEqual(
			matchingRules(button, rules).map((rule) => `${rule.kind}.${rule.className}`),
			["Button.action"],
		)
	})

	it("lets inline props win over sheet rules", () => {
		const nodes = parseVml(counter)
		const rules = collectRules(nodes)
		const button = nodes[0]?.children[0]?.children[0]
		assert.ok(button)
		const resolved = resolvedDeclarations(button, rules)
		assert.strictEqual(resolved["background"], "#000000")
		assert.strictEqual(resolved["color"], "#FFFFFF")
	})

	it("finds the innermost block for a document line", () => {
		const nodes = parseVml(counter)
		// Line 12 (zero-based) is the `class: card` line inside Rectangle.
		assert.strictEqual(blockAtLine(nodes, 12)?.kind, "Rectangle")
		// Line 13 opens the nested Button, so the innermost block is Button.
		assert.strictEqual(blockAtLine(nodes, 13)?.kind, "Button")
	})

	it("builds hover text with matched rules and applied style", () => {
		const nodes = parseVml(counter)
		const rules = collectRules(nodes)
		const label = nodes[0]?.children[0]?.children[1]
		assert.ok(label)
		const hover = hoverTextFor(label, rules)
		assert.ok(hover.includes("**Label**"))
		assert.ok(hover.includes("Label.count"))
		assert.ok(hover.includes("font-size"))
	})
})
