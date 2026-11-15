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

describe("VML reviewer fixes", () => {
	it("parses compact props generically without a whitelist", () => {
		const nodes = parseVml("Screen {\n\tid: heading x: 48 width: 100\n}")
		const screen = nodes[0]
		assert.ok(screen)
		assert.strictEqual(screen.props["id"], "heading")
		assert.strictEqual(screen.props["x"], "48")
		assert.strictEqual(screen.props["width"], "100")
	})

	it("keeps // inside strings and braces inside strings balanced", () => {
		const nodes = parseVml(
			'Screen {\n\tLabel { text: "https://example.test" }\n\tLabel { text: "{" }\n}',
		)
		assert.strictEqual(nodes.length, 1)
		assert.strictEqual(nodes[0]?.children.length, 2)
	})

	it("parses unknown capitalized tags as nodes, not style rules", () => {
		const nodes = parseVml(
			'Screen {\n\tColumn {\n\t\tLabel { text: "hi" }\n\t}\n\tMyWidget {\n\t\tid: custom\n\t}\n\tmyWidget {\n\t\tLabel { text: "low" }\n\t}\n}',
		)
		const kinds = nodes[0]?.children.map((child) => child.kind)
		assert.deepStrictEqual(kinds, ["Column", "MyWidget", "myWidget"])
		assert.strictEqual(nodes[0]?.children[0]?.children[0]?.kind, "Label")
		assert.strictEqual(nodes[0]?.children[2]?.children[0]?.kind, "Label")
		// A selector-shaped header over flat declarations stays a rule.
		const scoped = collectRules(nodes, nodes[0]?.children[1])
		assert.deepStrictEqual(scoped, [])
		const styled = parseVml("Screen {\n\tStyle {\n\t\tColumn.card { width: 10; }\n\t}\n}")
		assert.deepStrictEqual(
			collectRules(styled).map((rule) => `${rule.kind}.${rule.className}`),
			["Column.card"],
		)
	})

	it("scopes rules to the target's ancestor chain", () => {
		const nodes = parseVml(
			"Screen {\n\tStyle {\n\t\tButton { color: red; }\n\t}\n\tView {\n\t\tid: a\n\t\tStyle {\n\t\t\tButton { color: blue; }\n\t\t}\n\t\tButton { id: inner }\n\t}\n\tView {\n\t\tid: b\n\t\tButton { id: other }\n\t}\n}",
		)
		const viewA = nodes[0]?.children[0]
		const viewB = nodes[0]?.children[1]
		assert.ok(viewA && viewB)
		const inner = viewA.children.find((child) => child.props["id"] === "inner")
		const other = viewB.children.find((child) => child.props["id"] === "other")
		assert.ok(inner && other)
		assert.deepStrictEqual(
			collectRules(nodes, inner).map((rule) => rule.declarations["color"]),
			["red", "blue"],
		)
		assert.deepStrictEqual(
			collectRules(nodes, other).map((rule) => rule.declarations["color"]),
			["red"],
		)
	})

	it("matches multi-class values and skips pseudo-class rules", () => {
		const nodes = parseVml(
			'Screen {\n\tStyle {\n\t\tButton.primary { color: one; }\n\t\tButton:hover { color: hovered; }\n\t}\n\tButton { class: "primary big" }\n}',
		)
		const button = nodes[0]?.children[0]
		assert.ok(button)
		const rules = collectRules(nodes, button)
		assert.deepStrictEqual(
			matchingRules(button, rules).map((rule) => `${rule.kind}.${rule.className}`),
			["Button.primary"],
		)
		const resolved = resolvedDeclarations(button, rules)
		assert.strictEqual(resolved["color"], "one")
		const hover = hoverTextFor(button, rules)
		assert.ok(hover.includes("Button:hover"))
		assert.ok(hover.includes("not applied here"))
	})

	it("orders class selectors above kind selectors regardless of source order", () => {
		const nodes = parseVml(
			"Screen {\n\tStyle {\n\t\tButton { color: plain; }\n\t\tButton.action { color: fancy; }\n\t}\n\tButton { class: action }\n}",
		)
		const button = nodes[0]?.children[0]
		assert.ok(button)
		const rules = collectRules(nodes, button)
		assert.deepStrictEqual(
			matchingRules(button, rules).map(
				(rule) => `${rule.kind}${rule.className ? `.${rule.className}` : ""}`,
			),
			["Button", "Button.action"],
		)
		assert.strictEqual(resolvedDeclarations(button, rules)["color"], "fancy")
	})

	it("resolves style attributes and snake_case props", () => {
		const nodes = parseVml(
			'Screen {\n\tStyle {\n\t\tButton { color: sheet; font-size: 1px; }\n\t}\n\tButton {\n\t\tstyle: "color: #123; font_size: 9px"\n\t\tfont_size: 20px\n\t\tcorner_radius: 4\n\t}\n}',
		)
		const button = nodes[0]?.children[0]
		assert.ok(button)
		const resolved = resolvedDeclarations(button, collectRules(nodes, button))
		assert.strictEqual(resolved["color"], "#123")
		assert.strictEqual(resolved["font-size"], "20px")
		assert.strictEqual(resolved["border-radius"], "4")
	})
})
