/** Pure VML logic: parse a ui2 `.vml` document and resolve applied styles.
 *
 * Kept vscode-free so it is testable without an editor. The editor wiring
 * (hover provider) lives in `commands.ts` next to the other providers.
 *
 * The model mirrors what ui2 itself does: nested blocks with parent-local
 * frames. A `Style` block holds rules for its owning node's subtree;
 * `Kind` / `Kind.class` selectors match descendants, pseudo-classes such as
 * `:hover` only apply while that state holds (so static resolution reports
 * them separately instead of merging them in), and inline props win over
 * sheet rules.
 */

export interface VmlNode {
	kind: string
	props: Record<string, string>
	children: VmlNode[]
	/** Zero-based document lines covering the block header through `}`. */
	startLine: number
	endLine: number
	/** Zero-based UTF-16 columns of the header start and the closing `}`. */
	startCol: number
	endCol: number
}

export interface VmlStyleRule {
	kind: string
	/** Dot-joined when the selector lists several classes (`primary.big`). */
	className: string
	/** Pseudo-class without the colon (`hover`), or "" when unconditional. */
	pseudo: string
	declarations: Record<string, string>
	/** Zero-based line of the rule header, for hover ranges. */
	line: number
}

/**
 * Strip `//` and `<!-- … -->` comments, leaving anything inside quotes
 * (e.g. URLs) alone. Removed characters are blanked with spaces — newlines
 * included — so offsets, lines and columns in the cleaned text still match
 * the original document.
 */
function stripComments(text: string): string {
	let out = ""
	let quote = ""
	let escaped = false
	for (let index = 0; index < text.length; index++) {
		const char = text[index] ?? ""
		if (quote) {
			out += char
			if (escaped) {
				escaped = false
			} else if (char === "\\") {
				escaped = true
			} else if (char === quote) {
				quote = ""
			}
			continue
		}
		if (char === '"' || char === "'") {
			quote = char
			out += char
			continue
		}
		if (char === "/" && text[index + 1] === "/") {
			while (index < text.length && text[index] !== "\n") {
				out += " "
				index++
			}
			// Keep the newline so later line numbers still line up.
			if (index < text.length) {
				out += "\n"
			}
			continue
		}
		if (text.startsWith("<!--", index)) {
			const end = text.indexOf("-->", index + 4)
			const stop = end === -1 ? text.length : end + 3
			for (; index < stop; index++) {
				out += text[index] === "\n" ? "\n" : " "
			}
			// The loop's increment lands on `stop`.
			index--
			continue
		}
		out += char
	}
	return out
}

/** Zero-based line and UTF-16 column of an index into the document. */
function positionOf(text: string, index: number): { line: number; col: number } {
	let line = 0
	let col = 0
	for (let i = 0; i < index && i < text.length; i++) {
		if (text[i] === "\n") {
			line++
			col = 0
		} else {
			col++
		}
	}
	return { line, col }
}

function lineOf(text: string, index: number): number {
	return positionOf(text, index).line
}

/** Find the `}` closing the brace at `openIndex`, ignoring braces in strings. */
function findMatchingBrace(text: string, openIndex: number): number {
	let depth = 0
	let quote = ""
	let escaped = false
	for (let index = openIndex; index < text.length; index++) {
		const char = text[index] ?? ""
		if (quote) {
			if (escaped) {
				escaped = false
			} else if (char === "\\") {
				escaped = true
			} else if (char === quote) {
				quote = ""
			}
			continue
		}
		if (char === '"' || char === "'") {
			quote = char
			continue
		}
		if (char === "/" && text[index + 1] === "/") {
			while (index < text.length && text[index] !== "\n") {
				index++
			}
			continue
		}
		if (text.startsWith("<!--", index)) {
			const end = text.indexOf("-->", index + 4)
			index = end === -1 ? text.length : end + 2
			continue
		}
		if (char === "{") {
			depth++
		} else if (char === "}") {
			depth--
			if (depth === 0) {
				return index
			}
		}
	}
	return -1
}

const propKeyPattern = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*:/

/**
 * Split one line into generic `key: value` segments. Any key matches (no
 * whitelist), so compact rows like `id: heading x: 48 width: 100` all parse.
 * A `key:` only starts a segment outside quotes and right after the line
 * start, whitespace or `;`, so `https://…` values and `a: b` prose inside
 * quotes stay intact. Trailing `;` separators are stripped.
 */
function parsePropSegments(line: string): Array<[string, string]> {
	const starts: Array<{ key: string; keyStart: number; valueStart: number }> = []
	let quote = ""
	let escaped = false
	for (let index = 0; index < line.length; index++) {
		const char = line[index] ?? ""
		if (quote) {
			if (escaped) {
				escaped = false
			} else if (char === "\\") {
				escaped = true
			} else if (char === quote) {
				quote = ""
			}
			continue
		}
		if (char === '"' || char === "'") {
			quote = char
			continue
		}
		if (index > 0) {
			const prev = line[index - 1] ?? ""
			if (prev !== ";" && !/\s/.test(prev)) {
				continue
			}
		}
		const match = line.slice(index).match(propKeyPattern)
		if (match?.[1]) {
			starts.push({ key: match[1], keyStart: index, valueStart: index + match[0].length })
		}
	}
	return starts.map(
		(start, position) =>
			[
				start.key,
				line
					.slice(start.valueStart, starts[position + 1]?.keyStart ?? line.length)
					.trim()
					.replace(/;+$/, "")
					.trim(),
			] as [string, string],
	)
}

/** Split on a separator, ignoring separators inside quoted strings. */
function splitOutsideQuotes(text: string, separator: string): string[] {
	const parts: string[] = []
	let current = ""
	let quote = ""
	let escaped = false
	for (const char of text) {
		if (quote) {
			current += char
			if (escaped) {
				escaped = false
			} else if (char === "\\") {
				escaped = true
			} else if (char === quote) {
				quote = ""
			}
			continue
		}
		if (char === '"' || char === "'") {
			quote = char
			current += char
			continue
		}
		if (char === separator) {
			parts.push(current)
			current = ""
			continue
		}
		current += char
	}
	parts.push(current)
	return parts
}

function parseSelector(header: string): [string, string, string] {
	const colon = header.indexOf(":")
	const pseudo = colon === -1 ? "" : ((header.slice(colon + 1) ?? "").trim() ?? "")
	const base = (colon === -1 ? header : header.slice(0, colon)).trim()
	const dot = base.indexOf(".")
	if (dot === -1) {
		return [base, "", pseudo]
	}
	return [base.slice(0, dot).trim(), base.slice(dot + 1).trim(), pseudo]
}

/** A header names a style selector when it carries a class or pseudo-class. */
function isSelectorHeader(header: string): boolean {
	return header.includes(".") || header.includes(":")
}

/**
 * True when a `{ … }` body holds a nested block rather than flat
 * declarations. Scanned quote-aware so `{` inside strings (including
 * `${…}` interpolation) does not count.
 */
function containsNestedBlock(body: string): boolean {
	let quote = ""
	let escaped = false
	for (let index = 0; index < body.length; index++) {
		const char = body[index] ?? ""
		if (quote) {
			if (escaped) {
				escaped = false
			} else if (char === "\\") {
				escaped = true
			} else if (char === quote) {
				quote = ""
			}
			continue
		}
		if (char === '"' || char === "'") {
			quote = char
			continue
		}
		if (char !== "{") {
			continue
		}
		if (/(?:^|[\s;}:])\s*[A-Za-z_][A-Za-z0-9_.:]*\s*$/.test(body.slice(0, index))) {
			return true
		}
	}
	return false
}

/**
 * Decide child node versus style rule outside `Style` mode. A body holding
 * a nested block is always a component (this covers `Column`, imported
 * widgets, and lowercase custom tags); otherwise only a selector-shaped
 * header (`Kind.class`, `Kind:pseudo`) over flat declarations is a rule —
 * any other header, upper- or lowercase, names a component node.
 */
function isComponentBlock(header: string, inner: string): boolean {
	if (containsNestedBlock(inner)) {
		return true
	}
	return !isSelectorHeader(header)
}

/** Parse one `Kind[.class][:pseudo] { … }` rule body into declarations. */
function parseRule(full: string, header: string, inner: string, offset: number): VmlStyleRule {
	const [kind, className, pseudo] = parseSelector(header)
	const declarations: Record<string, string> = {}
	for (const chunk of splitOutsideQuotes(inner, ";")) {
		for (const line of chunk.split("\n")) {
			const trimmed = line.trim()
			if (!trimmed) {
				continue
			}
			for (const [key, value] of parsePropSegments(trimmed)) {
				if (value !== "") {
					declarations[key] = value
				}
			}
		}
	}
	return { kind, className, pseudo, declarations, line: lineOf(full, offset) }
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
			if (!styleMode && isComponentBlock(header, inner)) {
				const child = parseBlock(full, header, inner, bodyOffset + index)
				if (child) {
					children.push(child)
				}
			} else {
				// A `Kind.class` / `Kind:pseudo` style rule (or anything inside `Style`).
				rules.push(parseRule(full, header, inner, bodyOffset + index))
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
			for (const [key, value] of parsePropSegments(line)) {
				if (value !== "") {
					props[key] = value
				}
			}
		}
		index = newline === -1 ? body.length : newline + 1
	}
	return { props, rules, children }
}

function appendEmbeddedRules(node: VmlNode, rules: VmlStyleRule[]): void {
	if (rules.length === 0) {
		return
	}
	let existing: VmlStyleRule[] = []
	if (node.props.__rules) {
		try {
			existing = JSON.parse(node.props.__rules) as VmlStyleRule[]
		} catch {
			existing = []
		}
	}
	node.props.__rules = JSON.stringify([...existing, ...rules])
}

function parseBlock(
	full: string,
	header: string,
	body: string,
	offset: number,
): VmlNode | undefined {
	const kind = header.split(/[.:]/)[0]?.trim() ?? ""
	if (!kind) {
		return undefined
	}
	const braceOpen = full.indexOf("{", offset)
	const braceClose = findMatchingBrace(full, braceOpen)
	const parsed = parseBody(full, body, braceOpen + 1, kind === "Style")
	const props = { ...parsed.props }
	if (!props["class"]) {
		const [, className] = parseSelector(header)
		if (className) {
			props["class"] = className
		}
	}
	const start = positionOf(full, offset)
	const end =
		braceClose === -1 ? { line: start.line, col: start.col } : positionOf(full, braceClose)
	const node: VmlNode = {
		kind,
		props,
		children: parsed.children.filter((child) => child.kind !== "Style"),
		startLine: start.line,
		startCol: start.col,
		endLine: end.line,
		endCol: end.col,
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
	const globals: VmlStyleRule[] = []
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
		const inner = clean.slice(braceOpen + 1, braceClose)
		if (isSelectorHeader(header) && !containsNestedBlock(inner)) {
			// A stray top-level rule with no owning node: keep it global.
			globals.push(parseRule(clean, header, inner, index))
		} else {
			const node = parseBlock(clean, header, inner, index)
			if (node) {
				nodes.push(node)
			}
		}
		index = braceClose + 1
	}
	if (globals.length > 0) {
		for (const node of nodes) {
			appendEmbeddedRules(node, globals)
		}
	}
	return nodes
}

/**
 * Style rules in scope for a tree. Without `target` this collects every rule
 * (kept for back-compat); hover callers must pass the hovered block so rules
 * from unrelated subtrees never leak in — only the target's ancestor chain
 * plus its own rules are returned.
 */
export function collectRules(nodes: VmlNode[], target?: VmlNode): VmlStyleRule[] {
	const ownRules = (node: VmlNode): VmlStyleRule[] => {
		if (!node.props.__rules) return []
		try {
			return JSON.parse(node.props.__rules) as VmlStyleRule[]
		} catch {
			return []
		}
	}
	if (target) {
		const findPath = (node: VmlNode, inherited: VmlStyleRule[]): VmlStyleRule[] | undefined => {
			const scoped = [...inherited, ...ownRules(node)]
			if (node === target) return scoped
			for (const child of node.children) {
				const found = findPath(child, scoped)
				if (found) return found
			}
			return undefined
		}
		for (const node of nodes) {
			const found = findPath(node, [])
			if (found) return found
		}
		return []
	}
	const rules: VmlStyleRule[] = []
	const visit = (node: VmlNode): void => {
		rules.push(...ownRules(node))
		for (const child of node.children) {
			visit(child)
		}
	}
	for (const node of nodes) {
		visit(node)
	}
	return rules
}

/** Space-separated class list of a node, without surrounding quotes. */
function nodeClasses(node: VmlNode): string[] {
	return unquote(node.props["class"] ?? "")
		.split(/\s+/)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
}

/** Kind and (all) classes match; pseudo-classes are checked separately. */
function selectorMatches(rule: VmlStyleRule, kind: string, classes: string[]): boolean {
	if (rule.kind && rule.kind !== kind) {
		return false
	}
	if (rule.className) {
		const wanted = rule.className
			.split(".")
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0)
		if (!wanted.every((entry) => classes.includes(entry))) {
			return false
		}
	}
	return true
}

/** Class selectors beat kind-only selectors, regardless of source order. */
function specificity(rule: VmlStyleRule): number {
	if (!rule.className) {
		return 0
	}
	return rule.className
		.split(".")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0).length
}

/**
 * Rules matching a block, in cascade order: more specific selectors first,
 * source order kept within the same specificity. Pseudo-class rules never
 * match statically — `:hover` only applies while hovered, so merging it in
 * would report style that is not applied.
 */
export function matchingRules(node: VmlNode, rules: VmlStyleRule[]): VmlStyleRule[] {
	const classes = nodeClasses(node)
	return rules
		.filter((rule) => !rule.pseudo && selectorMatches(rule, node.kind, classes))
		.sort((a, b) => specificity(a) - specificity(b))
}

const inlinePropertyAliases: Record<string, string> = {
	background: "background",
	color: "color",
	"border-radius": "border-radius",
	"border-color": "border-color",
	"border-width": "border-width",
	"font-size": "font-size",
	font_size: "font-size",
	"font-weight": "font-weight",
	font_weight: "font-weight",
	font_family: "font-family",
	corner_radius: "border-radius",
	border_color: "border-color",
	border_width: "border-width",
	opacity: "opacity",
	"text-align": "text-align",
	align: "text-align",
	text_align: "text-align",
	width: "width",
	height: "height",
	padding: "padding",
	margin: "margin",
	x: "x",
	y: "y",
}

/** Map a VML prop to its CSS name, folding `snake_case` to `kebab-case`. */
function inlineCssProperty(prop: string): string | undefined {
	const direct = inlinePropertyAliases[prop]
	if (direct !== undefined) {
		return direct
	}
	const kebab = prop.toLowerCase().replaceAll("_", "-")
	const mapped = inlinePropertyAliases[kebab]
	if (mapped !== undefined) {
		return mapped
	}
	return undefined
}

/**
 * Parse a `style: "…"` attribute: `;`-separated `key: value` declarations.
 * Known props map to their CSS names; anything else passes through
 * `snake_case`-folded so explicitly authored style is never silently dropped.
 */
function parseStyleAttribute(value: string): Record<string, string> {
	const declarations: Record<string, string> = {}
	for (const part of splitOutsideQuotes(unquote(value), ";")) {
		for (const [key, entryValue] of parsePropSegments(part.trim())) {
			if (entryValue === "") {
				continue
			}
			declarations[inlineCssProperty(key) ?? key.toLowerCase().replaceAll("_", "-")] =
				unquote(entryValue)
		}
	}
	return declarations
}

/**
 * Merged declarations for a block: sheet rules in cascade order, then the
 * `style` attribute, then individual inline props (most specific wins).
 */
export function resolvedDeclarations(node: VmlNode, rules: VmlStyleRule[]): Record<string, string> {
	const merged: Record<string, string> = {}
	for (const rule of matchingRules(node, rules)) {
		Object.assign(merged, rule.declarations)
	}
	if (node.props["style"] !== undefined) {
		Object.assign(merged, parseStyleAttribute(node.props["style"] ?? ""))
	}
	for (const [prop, raw] of Object.entries(node.props)) {
		if (prop === "__rules" || prop === "style") {
			continue
		}
		const css = inlineCssProperty(prop)
		if (css !== undefined) {
			merged[css] = unquote(raw)
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

function selectorText(rule: VmlStyleRule): string {
	const base = rule.className ? `${rule.kind}.${rule.className}` : rule.kind || "*"
	return rule.pseudo ? `${base}:${rule.pseudo}` : base
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

/**
 * Innermost block covering a zero-based (line, character) cursor position,
 * if any. Unlike `blockAtLine` this tells same-line siblings apart: only a
 * block whose column span holds the cursor matches, so hovering the first of
 * `Button { … } Label { … }` on one line returns the `Button`, not the last
 * sibling.
 */
export function blockAtPosition(
	nodes: VmlNode[],
	line: number,
	character: number,
): VmlNode | undefined {
	let found: VmlNode | undefined
	const contains = (node: VmlNode): boolean => {
		const afterStart =
			line > node.startLine || (line === node.startLine && character >= node.startCol)
		const beforeEnd = line < node.endLine || (line === node.endLine && character <= node.endCol)
		return afterStart && beforeEnd
	}
	const visit = (node: VmlNode): void => {
		if (node.kind === "Style") {
			return
		}
		if (!contains(node)) {
			return
		}
		found = node
		for (const child of node.children) {
			visit(child)
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
	const id = node.props["id"] ? ` id \`${unquote(node.props["id"] ?? "")}\`` : ""
	const className = node.props["class"] ? ` class \`${unquote(node.props["class"] ?? "")}\`` : ""
	lines.push(`**${node.kind}**${id}${className}`)
	const matched = matchingRules(node, rules)
	const classes = nodeClasses(node)
	const conditional = rules.filter(
		(rule) => rule.pseudo && selectorMatches(rule, node.kind, classes),
	)
	if (matched.length === 0 && conditional.length === 0) {
		lines.push("")
		lines.push("_No stylesheet rule matches; only inline props apply._")
	} else {
		if (matched.length > 0) {
			lines.push("")
			lines.push("Matched rules:")
			for (const rule of matched) {
				lines.push(`- \`${selectorText(rule)}\``)
			}
		}
		if (conditional.length > 0) {
			lines.push("")
			lines.push("State-dependent rules (not applied here):")
			for (const rule of conditional) {
				lines.push(`- \`${selectorText(rule)}\``)
			}
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
