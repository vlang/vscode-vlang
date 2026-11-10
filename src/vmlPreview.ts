/** Pure VML preview logic: parse a ui2 `.vml` document and render an HTML approximation.
 *
 * Kept vscode-free so it is testable without an editor. The renderer mirrors
 * the parts of ui2 that decide what a screen looks like: nested blocks with
 * parent-local frames, `Style` rules matched by `Kind` / `Kind.class`, inline
 * props winning over sheet rules, and numeric expressions evaluated against
 * already-laid-out siblings (`card.width - 128`, ternaries, comparisons).
 */

export interface VmlNode {
	kind: string
	props: Record<string, string>
	children: VmlNode[]
}

export interface VmlStyleRule {
	kind: string
	className: string
	declarations: Record<string, string>
}

const blockKinds = new Set([
	"Screen",
	"Rectangle",
	"View",
	"Button",
	"Label",
	"Checkbox",
	"Scroll",
	"Dropdown",
	"TextField",
	"TextArea",
	"Style",
	"Repeater",
])

function stripComments(text: string): string {
	return text.replace(/\/\/.*$/gm, "")
}

function findMatchingBrace(text: string, openIndex: number): number {
	let depth = 0
	for (let index = openIndex; index < text.length; index++) {
		if (text[index] === "{") {
			depth++
		} else if (text[index] === "}") {
			depth--
			if (depth === 0) {
				return index
			}
		}
	}
	return -1
}

function parsePropLine(line: string): [string, string] | undefined {
	const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_.-]*)\s*:\s*(.+)$/)
	if (!match) {
		return undefined
	}
	return [match[1]?.trim() ?? "", (match[2] ?? "").trim()]
}

/** Parse one block body into props, style rules and child blocks. */
function parseBody(
	body: string,
	styleMode = false,
): { props: Record<string, string>; rules: VmlStyleRule[]; children: VmlNode[] } {
	const props: Record<string, string> = {}
	const rules: VmlStyleRule[] = []
	const children: VmlNode[] = []
	let index = 0
	while (index < body.length) {
		while (index < body.length && /\s/.test(body[index] ?? "")) {
			index++
		}
		if (index >= body.length) {
			break
		}
		const rest = body.slice(index)
		const blockMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_.:]*)\s*\{/)
		if (blockMatch) {
			const header = (blockMatch[1] ?? "").trim()
			const braceOpen = index + (blockMatch[0].length - 1)
			const braceClose = findMatchingBrace(body, braceOpen)
			if (braceClose === -1) {
				break
			}
			const inner = body.slice(braceOpen + 1, braceClose)
			const first = header.split(/[.:]/)[0] ?? ""
			if (!styleMode && blockKinds.has(first)) {
				const child = parseBlock(header, inner)
				if (child) {
					children.push(child)
				}
			} else {
				// A `Kind.class { ... }` style rule (or anything inside `Style`).
				const [kind, className] = parseSelector(header)
				const declarations: Record<string, string> = {}
				for (const line of inner.split(/;/)) {
					const parsed = parsePropLine(line.trim())
					if (parsed) {
						declarations[parsed[0]] = parsed[1]
					}
				}
				rules.push({ kind, className, declarations })
			}
			index = braceClose + 1
			continue
		}
		// Consume one line of props. Line-based so the index always advances:
		// a trailing block-header fragment (e.g. `Style` before its `{`)
		// is skipped here and parsed as a block on the next iteration.
		const newline = body.indexOf("\n", index)
		const lineEnd = newline === -1 ? body.length : newline
		const line = body.slice(index, lineEnd).trim()
		if (line) {
			for (const part of line.split(";")) {
				const parsed = parsePropLine(part.trim())
				if (parsed && !parsed[0].startsWith("property ")) {
					props[parsed[0]] = parsed[1]
				}
			}
		}
		index = newline === -1 ? body.length : newline + 1
	}
	return { props, rules, children }
}

function parseBlock(header: string, body: string): VmlNode | undefined {
	const kind = header.split(/[.:]/)[0]?.trim() ?? ""
	if (!blockKinds.has(kind)) {
		return undefined
	}
	const parsed = parseBody(body, kind === "Style")
	const props = { ...parsed.props }
	if (!props["class"]) {
		const [, className] = parseSelector(header)
		if (className) {
			props["class"] = className
		}
	}
	// Flatten `Style` blocks: their rules move up, their node stays for structure.
	if (kind === "Style") {
		return { kind, props: { __rules: JSON.stringify(parsed.rules) }, children: parsed.children }
	}
	const node: VmlNode = { kind, props, children: parsed.children }
	const styleChildren = parsed.children.filter((child) => child.kind === "Style")
	if (styleChildren.length > 0) {
		node.props.__rules = JSON.stringify(
			styleChildren.flatMap((child) => JSON.parse(child.props.__rules ?? "[]") as VmlStyleRule[]),
		)
		node.children = parsed.children.filter((child) => child.kind !== "Style")
	} else if (parsed.rules.length > 0) {
		node.props.__rules = JSON.stringify(parsed.rules)
	}
	return node
}

function parseSelector(header: string): [string, string] {
	const base = header.split(":")[0] ?? ""
	const parts = base.split(".")
	return [parts[0]?.trim() ?? "", parts.slice(1).join(".").trim()]
}

/** Parse a whole `.vml` document into top-level blocks. */
export function parseVml(text: string): VmlNode[] {
	const clean = stripComments(text)
	const nodes: VmlNode[] = []
	let index = 0
	while (index < clean.length) {
		while (index < clean.length && /\s/.test(clean[index] ?? "")) {
			index++
		}
		if (index >= clean.length) {
			break
		}
		const rest = clean.slice(index)
		const blockMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_.:]*)\s*\{/)
		if (!blockMatch) {
			index++
			continue
		}
		const header = (blockMatch[1] ?? "").trim()
		const braceOpen = index + (blockMatch[0].length - 1)
		const braceClose = findMatchingBrace(clean, braceOpen)
		if (braceClose === -1) {
			break
		}
		const node = parseBlock(header, clean.slice(braceOpen + 1, braceClose))
		if (node) {
			nodes.push(node)
		}
		index = braceClose + 1
	}
	return nodes
}

/** Collect every style rule in a tree (screen-level and scoped). */
export function collectRules(nodes: VmlNode[]): VmlStyleRule[] {
	const rules: VmlStyleRule[] = []
	const visit = (node: VmlNode): void => {
		if (node.props.__rules) {
			try {
				rules.push(...(JSON.parse(node.props.__rules) as VmlStyleRule[]))
			} catch {
				// A malformed embedded rule set never breaks the preview.
			}
		}
		for (const child of node.children) {
			visit(child)
		}
	}
	for (const node of nodes) {
		visit(node)
	}
	return rules
}

function unquote(value: string): string {
	const trimmed = value.trim()
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1)
	}
	return trimmed
}

function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function toCssColor(value: string | undefined, fallback: string): string {
	if (!value) {
		return fallback
	}
	const raw = unquote(value).trim()
	if (/^#[0-9a-fA-F]{3,8}$/.test(raw)) {
		return raw
	}
	if (/^[a-zA-Z]+$/.test(raw)) {
		return raw.toLowerCase()
	}
	if (/^0x[0-9a-fA-F]+$/.test(raw)) {
		return `#${raw.slice(2).padStart(6, "0").slice(-6)}`
	}
	return fallback
}

function toCssLength(value: string | undefined): string | undefined {
	if (!value) {
		return undefined
	}
	const raw = unquote(value).trim()
	if (/^-?\d+(\.\d+)?px$/.test(raw)) {
		return raw
	}
	if (/^-?\d+(\.\d+)?$/.test(raw)) {
		return `${raw}px`
	}
	return undefined
}

/** Evaluate a numeric VML expression against laid-out ids (`card.width - 128`). */
export function evaluateLength(
	expression: string | undefined,
	scope: Record<string, number>,
	fallback: number,
): number {
	if (expression === undefined) {
		return fallback
	}
	const raw = unquote(expression).trim()
	if (/^-?\d+(\.\d+)?(px)?$/.test(raw)) {
		return Number.parseFloat(raw)
	}
	try {
		const substituted = raw
			.replace(/[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*/g, (path) => {
				const value = scope[path]
				return value === undefined ? "NaN" : String(value)
			})
			.replace(/^[0-9a-zA-Z_]+$/g, (name) => {
				const value = scope[name]
				return value === undefined ? "NaN" : String(value)
			})
		// The source is author-controlled local UI code; the substitution above
		// leaves only numbers and operators before evaluation.
		if (!/^[0-9\s+\-*/%().<>=!?:&|]+$/.test(substituted)) {
			return fallback
		}
		const result = new Function(`return (${substituted})`)() as unknown
		return typeof result === "number" && Number.isFinite(result) ? result : fallback
	} catch {
		return fallback
	}
}

function displayText(node: VmlNode): string {
	const raw = node.props["text"]
	if (raw === undefined) {
		return node.props["id"] ?? node.kind
	}
	const text = unquote(raw)
	if (/^app\./.test(text)) {
		return "0"
	}
	if (/^[a-zA-Z_][a-zA-Z0-9_.]*\(\)$/.test(text)) {
		return "…"
	}
	return text
}

interface ResolvedStyle {
	background: string
	color: string
	borderRadius?: string
	border?: string
	fontSize?: string
	fontWeight?: string
	opacity?: string
	textAlign?: string
}

function resolveStyle(
	node: VmlNode,
	rules: VmlStyleRule[],
	defaults: ResolvedStyle,
): ResolvedStyle {
	const className = unquote(node.props["class"] ?? "")
	const matched = rules.filter((rule) => {
		if (rule.kind && rule.kind !== node.kind) {
			return false
		}
		if (rule.className && rule.className !== className) {
			return false
		}
		return true
	})
	const merged: Record<string, string> = {}
	for (const rule of matched) {
		Object.assign(merged, rule.declarations)
	}
	const inlineMap: Record<string, string> = {
		background: "background",
		color: "color",
		"border-radius": "border-radius",
		"border-color": "border-color",
		"border-width": "border-width",
		"font-size": "font-size",
		"font-weight": "font-weight",
		opacity: "opacity",
		"text-align": "text-align",
		align: "text-align",
	}
	for (const [vmlProp, cssProp] of Object.entries(inlineMap)) {
		if (node.props[vmlProp] !== undefined) {
			merged[cssProp] = node.props[vmlProp] ?? ""
		}
	}
	// Shorthand `bold: true` used across the ui2 examples.
	if (node.props["bold"] !== undefined && merged["font-weight"] === undefined) {
		merged["font-weight"] = "bold"
	}
	const borderWidth = toCssLength(merged["border-width"])
	const borderColor = merged["border-color"] ? toCssColor(merged["border-color"], "") : ""
	return {
		background: toCssColor(merged["background"], defaults.background),
		color: toCssColor(merged["color"] ?? merged["text-color"], defaults.color),
		borderRadius: toCssLength(merged["border-radius"] ?? merged["corner_radius"]) ?? defaults.borderRadius,
		border:
			borderWidth && borderColor ? `${borderWidth} solid ${borderColor}` : defaults.border,
		fontSize: toCssLength(merged["font-size"]) ?? defaults.fontSize,
		fontWeight: merged["font-weight"] ? unquote(merged["font-weight"]) : defaults.fontWeight,
		opacity: merged["opacity"] ? unquote(merged["opacity"]) : defaults.opacity,
		textAlign: merged["text-align"] ? unquote(merged["text-align"]) : defaults.textAlign,
	}
}

function cssFor(style: ResolvedStyle): string {
	const parts = [`background:${style.background}`, `color:${style.color}`]
	if (style.borderRadius) {
		parts.push(`border-radius:${style.borderRadius}`)
	}
	if (style.border) {
		parts.push(`border:${style.border}`)
	}
	if (style.fontSize) {
		parts.push(`font-size:${style.fontSize}`)
	}
	if (style.fontWeight) {
		parts.push(`font-weight:${style.fontWeight}`)
	}
	if (style.opacity) {
		parts.push(`opacity:${style.opacity}`)
	}
	if (style.textAlign) {
		parts.push(`text-align:${style.textAlign}`)
	}
	return parts.join(";")
}

const rootDefaults: ResolvedStyle = { background: "#ffffff", color: "#111827" }

/** Render one node and its children into positioned HTML. */
function renderNode(
	node: VmlNode,
	rules: VmlStyleRule[],
	scope: Record<string, number>,
	parentWidth: number,
	_parentHeight: number,
): string {
	if (node.kind === "Style") {
		return ""
	}
	const id = unquote(node.props["id"] ?? "")
	const width = evaluateLength(node.props["width"], scope, Math.min(200, parentWidth))
	const height = evaluateLength(node.props["height"], scope, 36)
	const x = evaluateLength(node.props["x"], scope, 0)
	const y = evaluateLength(node.props["y"], scope, 0)
	if (id) {
		scope[`${id}.width`] = width
		scope[`${id}.height`] = height
		scope[`${id}.x`] = x
		scope[`${id}.y`] = y
	}
	const style = resolveStyle(node, rules, rootDefaults)
	const children = node.children.map((child) => renderNode(child, rules, scope, width, height)).join("")
	const box = `position:absolute;left:${x}px;top:${y}px;width:${width}px;${node.children.length > 0 ? `height:${height}px;` : `min-height:${height}px;`}${cssFor(style)}`
	switch (node.kind) {
		case "Label": {
			const size = style.fontSize ?? "14px"
			return `<div style="${box};font-size:${size};display:flex;align-items:center;overflow:hidden;">${escapeHtml(displayText(node))}</div>${children}`
		}
		case "Button": {
			const label = escapeHtml(displayText(node))
			if (node.children.length === 0) {
				return `<button style="${box};font-size:${style.fontSize ?? "14px"};font-weight:${style.fontWeight ?? "600"};cursor:pointer;">${label}</button>`
			}
			return `<div style="${box}">${children}</div>`
		}
		case "Checkbox": {
			return `<label style="${box};display:flex;gap:6px;align-items:center;font-size:${style.fontSize ?? "14px"};"><input type="checkbox" disabled> ${escapeHtml(displayText(node))}</label>${children}`
		}
		default: {
			return `<div style="${box}">${children}</div>`
		}
	}
}

/** Render a full document: a fixed screen canvas with the tree laid out inside. */
export function renderVmlDocument(text: string): { html: string; blocks: number } {
	const nodes = parseVml(text)
	const rules = collectRules(nodes)
	const screen = nodes.find((node) => node.kind === "Screen")
	const screenBg = screen
		? toCssColor(
				screen.props["background"] ??
					rules.find((rule) => !rule.kind && !rule.className)?.declarations["background"],
				"#F1F5F9",
			)
		: "#F1F5F9"
	const scope: Record<string, number> = { "root.width": 800, "root.height": 600 }
	const roots = (screen ? screen.children : nodes).filter((node) => node.kind !== "Style")
	const body = roots.map((node) => renderNode(node, rules, scope, 800, 600)).join("")
	const blocks = countBlocks(nodes)
	const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VML Preview</title><style>
body{font-family:system-ui,sans-serif;margin:0;background:#0f172a;display:flex;justify-content:center;padding:16px;}
.screen{position:relative;width:800px;height:600px;background:${screenBg};border-radius:10px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.35);}
.badge{position:absolute;left:10px;bottom:8px;font-size:11px;color:#64748b;}
</style></head><body><div class="screen">${body}<div class="badge">Approximate render — ${blocks} block(s). Live on edit.</div></div></body></html>`
	return { html, blocks }
}

function countBlocks(nodes: VmlNode[]): number {
	let count = 0
	const visit = (node: VmlNode): void => {
		if (node.kind !== "Style") {
			count++
		}
		for (const child of node.children) {
			visit(child)
		}
	}
	for (const node of nodes) {
		visit(node)
	}
	return count
}
