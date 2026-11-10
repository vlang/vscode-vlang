/** Pure VML logic: parse a ui2 `.vml` document and resolve applied styles.
 *
 * Kept vscode-free so it is testable without an editor. The editor wiring
 * (hover provider) lives in `commands.ts` next to the other providers.
 *
 * The model mirrors what ui2 itself does: nested blocks with parent-local
 * frames, `Style` rules matched by `Kind` / `Kind.class` (pseudo-classes
 * ignored for matching), inline props winning over sheet rules.
 */

export interface VmlNode {
	kind: string
	props: Record<string, string>
	children: VmlNode[]
	/** Zero-based document lines covering the block header through `}`. */
	startLine: number
	endLine: number
}

export interface VmlStyleRule {
	kind: string
	className: string
	declarations: Record<string, string>
	/** Zero-based line of the rule header, for hover ranges. */
	line: number
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
	"MessageBox",
])

function stripComments(text: string): string {
	return text.replace(/\/\/.*$/gm, "")
}

function lineOf(text: string, index: number): number {
	let line = 0
	for (let i = 0; i < index && i < text.length; i++) {
		if (text[i] === "\n") {
			line++
		}
	}
	return line
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

function parseSelector(header: string): [string, string] {
	const base = header.split(":")[0] ?? ""
	const parts = base.split(".")
	return [parts[0]?.trim() ?? "", parts.slice(1).join(".").trim()]
}

/** Parse one block body into props, style rules and child blocks. */
function parseBody(
	full: string,
	body: string,
	bodyOffset: number,
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
				const child = parseBlock(full, header, inner, bodyOffset + index)
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
				rules.push({
					kind,
					className,
					declarations,
					line: lineOf(full, bodyOffset + index),
				})
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

function parseBlock(
	full: string,
	header: string,
	body: string,
	offset: number,
): VmlNode | undefined {
	const kind = header.split(/[.:]/)[0]?.trim() ?? ""
	if (!blockKinds.has(kind)) {
		return undefined
	}
	const braceClose = findMatchingBrace(full, full.indexOf("{", offset))
	const parsed = parseBody(full, body, offset + header.length + 1, kind === "Style")
	const props = { ...parsed.props }
	if (!props["class"]) {
		const [, className] = parseSelector(header)
		if (className) {
			props["class"] = className
		}
	}
	const node: VmlNode = {
		kind,
		props,
		children: parsed.children.filter((child) => child.kind !== "Style"),
		startLine: lineOf(full, offset),
		endLine: braceClose === -1 ? lineOf(full, offset) : lineOf(full, braceClose),
	}
	const embedded: VmlStyleRule[] = [...parsed.rules]
	for (const child of parsed.children) {
		if (child.kind === "Style" && child.props.__rules) {
			try {
				embedded.push(...(JSON.parse(child.props.__rules) as VmlStyleRule[]))
			} catch {
				// Malformed embedded rules never break the hover.
			}
		}
	}
	if (embedded.length > 0) {
		node.props.__rules = JSON.stringify(embedded)
	}
	return node
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
		const node = parseBlock(clean, header, clean.slice(braceOpen + 1, braceClose), index)
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

/** Rules matching a block, in cascade order (later wins). */
export function matchingRules(node: VmlNode, rules: VmlStyleRule[]): VmlStyleRule[] {
	const className = (node.props["class"] ?? "").replace(/^["']|["']$/g, "")
	return rules.filter((rule) => {
		if (rule.kind && rule.kind !== node.kind) {
			return false
		}
		if (rule.className && rule.className !== className) {
			return false
		}
		return true
	})
}

/** Merged declarations for a block: sheet rules first, inline props win. */
export function resolvedDeclarations(node: VmlNode, rules: VmlStyleRule[]): Record<string, string> {
	const merged: Record<string, string> = {}
	for (const rule of matchingRules(node, rules)) {
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
		width: "width",
		height: "height",
		x: "x",
		y: "y",
	}
	for (const [vmlProp, cssProp] of Object.entries(inlineMap)) {
		if (node.props[vmlProp] !== undefined) {
			merged[cssProp] = node.props[vmlProp] ?? ""
		}
	}
	return merged
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

/** Innermost block covering a zero-based document line, if any. */
export function blockAtLine(nodes: VmlNode[], line: number): VmlNode | undefined {
	let found: VmlNode | undefined
	const visit = (node: VmlNode): void => {
		if (node.kind === "Style") {
			return
		}
		if (line >= node.startLine && line <= node.endLine) {
			found = node
			for (const child of node.children) {
				visit(child)
			}
		}
	}
	for (const node of nodes) {
		visit(node)
	}
	return found
}

/** Markdown hover text for a block: identity, matched rules, resolved style. */
export function hoverTextFor(node: VmlNode, rules: VmlStyleRule[]): string {
	const lines: string[] = []
	const id = node.props["id"] ? ` id \`${unquote(node.props["id"])}\`` : ""
	const className = node.props["class"] ? ` class \`${unquote(node.props["class"])}\`` : ""
	lines.push(`**${node.kind}**${id}${className}`)
	const matched = matchingRules(node, rules)
	if (matched.length === 0) {
		lines.push("")
		lines.push("_No stylesheet rule matches; only inline props apply._")
	} else {
		lines.push("")
		lines.push("Matched rules:")
		for (const rule of matched) {
			const selector = rule.className ? `${rule.kind}.${rule.className}` : rule.kind || "*"
			lines.push(`- \`${selector}\``)
		}
	}
	const resolved = resolvedDeclarations(node, rules)
	const keys = Object.keys(resolved)
	if (keys.length > 0) {
		lines.push("")
		lines.push("Applied style:")
		for (const key of keys) {
			lines.push(`- ${key}: \`${resolved[key]}\``)
		}
	}
	return lines.join("\n")
}
