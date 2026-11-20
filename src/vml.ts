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

export interface VmlSelectorPart {
	kind: string
	/** Without the leading `#` (`login` for `Button#login`). */
	id: string
	/** Dot-joined when the compound lists several classes (`primary.big`). */
	className: string
}

export interface VmlStyleRule {
	kind: string
	/** Dot-joined when the selector lists several classes (`primary.big`). */
	className: string
	/** Without the leading `#` (`login` for `Button#login`), or "" when absent. */
	id: string
	/** Pseudo-class without the colon (`hover`), or "" when unconditional. */
	pseudo: string
	/** Full selector header as written (`Screen Button#login.primary`), for hover. */
	selector: string
	/** Ancestor compounds for descendant selectors, outermost first. */
	ancestors: VmlSelectorPart[]
	declarations: Record<string, string>
	/** Zero-based line of the rule header, for hover ranges. */
	line: number
}

/**
 * Strip line, VSS block and HTML comments, leaving anything inside
 * quotes (e.g. URLs) alone. Removed characters are blanked with spaces —
 * newlines included — so offsets, lines and columns in the cleaned text
 * still match the original document.
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
		if (char === "/" && text[index + 1] === "*") {
			const end = text.indexOf("*/", index + 2)
			const stop = end === -1 ? text.length : end + 2
			for (; index < stop; index++) {
				out += text[index] === "\n" ? "\n" : " "
			}
			// The loop's increment lands on `stop`.
			index--
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
		if (char === "/" && text[index + 1] === "*") {
			const end = text.indexOf("*/", index + 2)
			index = end === -1 ? text.length : end + 1
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

const propKeyPattern = /^(@?[A-Za-z_][A-Za-z0-9_.-]*)\s*:/

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

/** Parse one compound such as `Button#login.primary`, `.card`, `#login` or `*`. */
function parseCompound(part: string): VmlSelectorPart | undefined {
	if (part === "*") {
		return { kind: "*", id: "", className: "" }
	}
	const kindMatch = part.match(/^([A-Za-z_][A-Za-z0-9_]*)/)
	const kind = kindMatch?.[1] ?? ""
	let rest = kind ? part.slice(kind.length) : part
	let id = ""
	const classes: string[] = []
	while (rest.length > 0) {
		if (rest.startsWith("#")) {
			if (id) {
				return undefined
			}
			const idMatch = rest.match(/^#([A-Za-z_][A-Za-z0-9_-]*)/)
			if (!idMatch?.[1]) {
				return undefined
			}
			id = idMatch[1]
			rest = rest.slice(idMatch[0].length)
		} else if (rest.startsWith(".")) {
			const classMatch = rest.match(/^\.([A-Za-z_][A-Za-z0-9_-]*)/)
			if (!classMatch?.[1]) {
				return undefined
			}
			classes.push(classMatch[1])
			rest = rest.slice(classMatch[0].length)
		} else {
			return undefined
		}
	}
	if (!kind && !id && classes.length === 0) {
		return undefined
	}
	return { kind, id, className: classes.join(".") }
}

function parseSelectorHeader(header: string):
	| {
			kind: string
			id: string
			className: string
			pseudo: string
			ancestors: VmlSelectorPart[]
			selector: string
	  }
	| undefined {
	const trimmed = header
		.trim()
		.replace(/\s+/g, " ")
		.replace(/\s*>\s*/g, " > ")
	if (!trimmed || /["'${}()]/.test(trimmed)) {
		return undefined
	}
	let withoutPseudo = trimmed
	let pseudo = ""
	const pseudoMatch = trimmed.match(/^(.*):([A-Za-z_-]+)\s*$/)
	if (pseudoMatch?.[1] !== undefined && pseudoMatch?.[2]) {
		const base = (pseudoMatch[1] ?? "").trim()
		// A `key: value` prop has a space after the colon; a pseudo never does,
		// and the base must still look like selector compounds.
		if (base && !base.endsWith(":") && !/\s:\s/.test(trimmed)) {
			withoutPseudo = base
			pseudo = pseudoMatch[2]
		}
	}
	const tokens = withoutPseudo
		.replace(/\s*>\s*/g, " > ")
		.split(/\s+/)
		.filter((token) => token.length > 0)
	if (tokens.length === 0) {
		return undefined
	}
	const parts: VmlSelectorPart[] = []
	for (const token of tokens) {
		if (token === ">") {
			continue
		}
		const parsed = parseCompound(token)
		if (!parsed) {
			return undefined
		}
		parts.push(parsed)
	}
	if (parts.length === 0) {
		return undefined
	}
	const last = parts[parts.length - 1]
	if (!last) {
		return undefined
	}
	return {
		kind: last.kind,
		id: last.id,
		className: last.className,
		pseudo,
		ancestors: parts.slice(0, -1),
		selector: trimmed,
	}
}

function parseSelector(header: string): [string, string, string] {
	const parsed = parseSelectorHeader(header)
	if (!parsed) {
		const colon = header.indexOf(":")
		const pseudo = colon === -1 ? "" : ((header.slice(colon + 1) ?? "").trim() ?? "")
		const base = (colon === -1 ? header : header.slice(0, colon)).trim()
		const dot = base.indexOf(".")
		if (dot === -1) {
			return [base, "", pseudo]
		}
		return [base.slice(0, dot).trim(), base.slice(dot + 1).trim(), pseudo]
	}
	return [parsed.kind, parsed.className, parsed.pseudo]
}

/** A header names a style selector when it carries a class, id, pseudo or ancestor. */
function isSelectorHeader(header: string): boolean {
	const parsed = parseSelectorHeader(header)
	if (!parsed) {
		return header.includes(".") || header.includes(":")
	}
	if (parsed.ancestors.length > 0) {
		return true
	}
	if (parsed.id || parsed.className || parsed.pseudo) {
		return true
	}
	return parsed.kind === "*"
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
		if (/(?:^|[\s;}:])\s*[A-Za-z_][A-Za-z0-9_.:#]*\s*$/.test(body.slice(0, index))) {
			return true
		}
	}
	return false
}

/**
 * Decide child node versus style rule outside `Style` mode. A body holding
 * a nested block is always a component (this covers `Column`, imported
 * widgets, and lowercase custom tags); otherwise only a selector-shaped
 * header (`Kind.class`, `Kind#id`, `.class`, `Kind:pseudo`, descendants)
 * over flat declarations is a rule — any other header, upper- or lowercase,
 * names a component node.
 */
function isComponentBlock(header: string, inner: string): boolean {
	if (containsNestedBlock(inner)) {
		return true
	}
	return !isSelectorHeader(header)
}

/** Parse one `Kind[#id][.class][:pseudo]` (or descendant) rule body into declarations. */
function parseRule(full: string, header: string, inner: string, offset: number): VmlStyleRule {
	const parsed = parseSelectorHeader(header)
	const kind = parsed?.kind ?? parseSelector(header)[0] ?? ""
	const className = parsed?.className ?? parseSelector(header)[1] ?? ""
	const pseudo = parsed?.pseudo ?? parseSelector(header)[2] ?? ""
	const id = parsed?.id ?? ""
	const ancestors = parsed?.ancestors ?? []
	const selector = parsed?.selector ?? header.trim()
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
	return {
		kind,
		className,
		id,
		pseudo,
		selector,
		ancestors,
		declarations,
		line: lineOf(full, offset),
	}
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
		const blockMatch = rest.match(/^([A-Za-z_.*#][A-Za-z0-9_.#:*\s>-]*?)\s*\{/)
		if (blockMatch && !/:\s/.test(blockMatch[1] ?? "")) {
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
			existing = normalizeRules(JSON.parse(node.props.__rules) as VmlStyleRule[])
		} catch {
			existing = []
		}
	}
	node.props.__rules = JSON.stringify([...existing, ...rules])
}

/** `@var` definitions held directly in a props map (values unquoted). */
function varsFromProps(props: Record<string, string>): Record<string, string> {
	const vars: Record<string, string> = {}
	for (const [key, value] of Object.entries(props)) {
		if (key.startsWith("@") && key.length > 1) {
			vars[key] = unquote(value)
		}
	}
	return vars
}

function appendEmbeddedVars(node: VmlNode, vars: Record<string, string>): void {
	const keys = Object.keys(vars)
	if (keys.length === 0) {
		return
	}
	let existing: Record<string, string> = {}
	if (node.props.__vars) {
		try {
			existing = JSON.parse(node.props.__vars) as Record<string, string>
		} catch {
			existing = {}
		}
	}
	node.props.__vars = JSON.stringify({ ...existing, ...vars })
}

/** Backfill rules read from `__rules` JSON that predate `id`/`selector` fields. */
function normalizeRules(rules: VmlStyleRule[]): VmlStyleRule[] {
	return rules.map((rule) => {
		if (
			typeof rule.id === "string" &&
			typeof rule.selector === "string" &&
			Array.isArray(rule.ancestors)
		) {
			return rule
		}
		const header = `${rule.kind ?? ""}${rule.className ? `.${rule.className}` : ""}${rule.pseudo ? `:${rule.pseudo}` : ""}`
		const parsed = parseSelectorHeader(header || "*")
		return {
			kind: rule.kind ?? "",
			className: rule.className ?? "",
			id: "",
			pseudo: rule.pseudo ?? "",
			selector: header || "*",
			ancestors: parsed?.ancestors ?? [],
			declarations: rule.declarations ?? {},
			line: rule.line ?? 0,
		}
	})
}

function parseBlock(
	full: string,
	header: string,
	body: string,
	offset: number,
): VmlNode | undefined {
	const lastToken =
		header
			.trim()
			.split(/\s*>\s*|\s+/)
			.pop() ?? ""
	const kind = lastToken.split(/[.:#]/)[0]?.trim() ?? ""
	if (!kind || kind === "*") {
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
	const embeddedVars: Record<string, string> = varsFromProps(parsed.props)
	for (const child of parsed.children) {
		if (child.kind === "Style") {
			if (child.props.__rules) {
				try {
					embedded.push(
						...normalizeRules(JSON.parse(child.props.__rules) as VmlStyleRule[]),
					)
				} catch {
					// Malformed embedded rules never break the hover.
				}
			}
			if (child.props.__vars) {
				try {
					Object.assign(
						embeddedVars,
						JSON.parse(child.props.__vars) as Record<string, string>,
					)
				} catch {
					// Malformed embedded variables never break the hover.
				}
			}
			// A `Style` child's own `@var` props (kept alongside `__vars`).
			Object.assign(embeddedVars, varsFromProps(child.props))
		}
	}
	if (embedded.length > 0) {
		node.props.__rules = JSON.stringify(embedded)
	}
	if (Object.keys(embeddedVars).length > 0) {
		node.props.__vars = JSON.stringify(embeddedVars)
	}
	return node
}

/** Parse a whole `.vml` document into top-level blocks. */
export function parseVml(text: string): VmlNode[] {
	const clean = stripComments(text)
	const nodes: VmlNode[] = []
	const globals: VmlStyleRule[] = []
	const globalVars: Record<string, string> = {}
	let index = 0
	while (index < clean.length) {
		while (index < clean.length && /\s/.test(clean[index] ?? "")) {
			index++
		}
		if (index >= clean.length) {
			break
		}
		const rest = clean.slice(index)
		const blockMatch = rest.match(/^([A-Za-z_.*#][A-Za-z0-9_.#:*\s>-]*?)\s*\{/)
		if (!blockMatch || /:\s/.test(blockMatch[1] ?? "")) {
			// A top-level `@var: value;` definition (no owning block).
			const varMatch = rest.match(/^(@[A-Za-z_][A-Za-z0-9_.-]*)\s*:\s*([^\n;{}]+);?/)
			if (varMatch?.[1] && varMatch?.[2] !== undefined) {
				globalVars[varMatch[1]] = unquote(varMatch[2] ?? "")
				index += varMatch[0].length
				continue
			}
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
	if (Object.keys(globalVars).length > 0) {
		for (const node of nodes) {
			appendEmbeddedVars(node, globalVars)
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
			return normalizeRules(JSON.parse(node.props.__rules) as VmlStyleRule[])
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

/** Ancestor chain for a block, outermost first (empty when absent). */
export function ancestorsOf(nodes: VmlNode[], target: VmlNode): VmlNode[] {
	const findPath = (node: VmlNode, trail: VmlNode[]): VmlNode[] | undefined => {
		if (node === target) return trail
		for (const child of node.children) {
			const found = findPath(child, [...trail, node])
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

/** `@var` values in scope for a tree (ancestor chain plus own, inner wins). */
export function collectVariables(nodes: VmlNode[], target?: VmlNode): Record<string, string> {
	const ownVars = (node: VmlNode): Record<string, string> => {
		const merged = varsFromProps(node.props)
		if (node.props.__vars) {
			try {
				Object.assign(merged, JSON.parse(node.props.__vars) as Record<string, string>)
			} catch {
				// Malformed variables never break the hover.
			}
		}
		return merged
	}
	if (target) {
		const path = ancestorsOf(nodes, target)
		const merged: Record<string, string> = {}
		for (const ancestor of path) {
			Object.assign(merged, ownVars(ancestor))
		}
		Object.assign(merged, ownVars(target))
		return merged
	}
	const merged: Record<string, string> = {}
	const visit = (node: VmlNode): void => {
		Object.assign(merged, ownVars(node))
		for (const child of node.children) {
			visit(child)
		}
	}
	for (const node of nodes) {
		visit(node)
	}
	return merged
}

/** Space-separated class list of a node, without surrounding quotes. */
function nodeClasses(node: VmlNode): string[] {
	return unquote(node.props["class"] ?? "")
		.split(/\s+/)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
}

/** Unquoted `id` prop of a node, or "" when absent. */
function nodeId(node: VmlNode): string {
	return unquote(node.props["id"] ?? "").trim()
}

function partMatches(part: VmlSelectorPart, kind: string, classes: string[], id: string): boolean {
	if (part.kind && part.kind !== "*" && part.kind !== kind) {
		return false
	}
	if (part.id && part.id !== id) {
		return false
	}
	if (part.className) {
		const wanted = part.className
			.split(".")
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0)
		if (!wanted.every((entry) => classes.includes(entry))) {
			return false
		}
	}
	return true
}

/** Kind, id and (all) classes match; pseudo-classes are checked separately. */
function selectorMatches(
	rule: VmlStyleRule,
	kind: string,
	classes: string[],
	id = "",
	ancestors: VmlNode[] = [],
): boolean {
	if (
		!partMatches({ kind: rule.kind, id: rule.id, className: rule.className }, kind, classes, id)
	) {
		return false
	}
	if (rule.ancestors.length === 0) {
		return true
	}
	// Descendant (and child `>`) ancestors match outermost first against the
	// node's ancestor chain. `>` requires the immediate parent; a space
	// matches any ancestor in order. The header normalizes `>` spacing, but
	// the stored parts lose the combinator, so `>` is approximated as a
	// descendant match here — still reporting rules UI2 applies rather than
	// omitting them.
	let cursor = 0
	const chain = ancestors.map((ancestor) => ({
		kind: ancestor.kind,
		classes: nodeClasses(ancestor),
		id: nodeId(ancestor),
	}))
	for (const wanted of rule.ancestors) {
		let found = -1
		for (let i = cursor; i < chain.length; i++) {
			const entry = chain[i]
			if (entry && partMatches(wanted, entry.kind, entry.classes, entry.id)) {
				found = i
				break
			}
		}
		if (found === -1) {
			return false
		}
		cursor = found + 1
	}
	return true
}

/** IDs beat classes, classes beat kinds, regardless of source order. */
function specificity(rule: VmlStyleRule): number {
	const countClasses = (dotted: string): number =>
		dotted
			.split(".")
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0).length
	let score = 0
	const parts: VmlSelectorPart[] = [
		...rule.ancestors,
		{ kind: rule.kind, id: rule.id, className: rule.className },
	]
	for (const part of parts) {
		if (part.id) {
			score += 100
		}
		score += countClasses(part.className) * 10
		if (part.kind && part.kind !== "*") {
			score += 1
		}
	}
	return score
}

/**
 * Rules matching a block, in cascade order: more specific selectors first,
 * source order kept within the same specificity. Pseudo-class rules never
 * match statically — `:hover` only applies while hovered, so merging it in
 * would report style that is not applied.
 */
export function matchingRules(
	node: VmlNode,
	rules: VmlStyleRule[],
	ancestors: VmlNode[] = [],
): VmlStyleRule[] {
	const classes = nodeClasses(node)
	const id = nodeId(node)
	return normalizeRules(rules)
		.filter((rule) => !rule.pseudo && selectorMatches(rule, node.kind, classes, id, ancestors))
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
	bold: "font-weight",
	font_family: "font-family",
	"font-style": "font-style",
	font_style: "font-style",
	italic: "font-style",
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
 * Substitute `@var` references with scoped VSS variable values. Unknown
 * names are left alone so a typo stays visible instead of vanishing.
 * Chains (`@a` holding another `@b`) resolve iteratively with a small cap
 * so a cyclic definition terminates.
 */
function resolveValue(value: string, vars: Record<string, string>): string {
	if (!value.includes("@")) {
		return value
	}
	let result = value
	for (let pass = 0; pass < 5; pass++) {
		const next = result.replace(/@[A-Za-z_][A-Za-z0-9_-]*/g, (token) => {
			if (Object.hasOwn(vars, token)) {
				return vars[token] ?? token
			}
			const withoutAt = token.slice(1)
			if (Object.hasOwn(vars, withoutAt)) {
				return vars[withoutAt] ?? token
			}
			return token
		})
		if (next === result) {
			break
		}
		result = next
	}
	return result
}

/** Map `bold`/`italic` booleans to their CSS keywords before merging. */
function inlineCssValue(prop: string, raw: string, vars: Record<string, string>): string {
	const resolved = resolveValue(unquote(raw), vars)
	const lower = resolved.toLowerCase().trim()
	if (prop === "bold") {
		if (lower === "true") {
			return "bold"
		}
		if (lower === "false") {
			return "normal"
		}
		return resolved
	}
	if (prop === "italic") {
		if (lower === "true") {
			return "italic"
		}
		if (lower === "false") {
			return "normal"
		}
		return resolved
	}
	return resolved
}

/**
 * Merged declarations for a block: sheet rules in cascade order, then the
 * `style` attribute, then individual inline props (most specific wins).
 * `@var` definitions never appear as applied style; references to them
 * resolve to the scoped value UI2 applies.
 */
export function resolvedDeclarations(
	node: VmlNode,
	rules: VmlStyleRule[],
	ancestors: VmlNode[] = [],
	variables: Record<string, string> = {},
): Record<string, string> {
	const merged: Record<string, string> = {}
	const matched = matchingRules(node, normalizeRules(rules), ancestors)
	const vars: Record<string, string> = { ...variables }
	for (const rule of matched) {
		for (const [key, value] of Object.entries(rule.declarations)) {
			if (key.startsWith("@")) {
				vars[key] = resolveValue(unquote(value), vars)
				if (!key.startsWith("@@")) {
					vars[key.slice(1)] = vars[key] ?? ""
				}
			}
		}
	}
	for (const rule of matched) {
		for (const [key, value] of Object.entries(rule.declarations)) {
			if (key.startsWith("@")) {
				continue
			}
			merged[key] = resolveValue(value, vars)
		}
	}
	if (node.props["style"] !== undefined) {
		const style = parseStyleAttribute(node.props["style"] ?? "")
		for (const [key, value] of Object.entries(style)) {
			if (key.startsWith("@")) {
				vars[key] = resolveValue(value, vars)
				continue
			}
			merged[key] = resolveValue(value, vars)
		}
	}
	for (const [prop, raw] of Object.entries(node.props)) {
		if (prop === "__rules" || prop === "__vars" || prop === "style" || prop.startsWith("@")) {
			continue
		}
		const css = inlineCssProperty(prop)
		if (css !== undefined) {
			merged[css] = inlineCssValue(prop, raw, vars)
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
	if (rule.selector) {
		return rule.pseudo && !rule.selector.endsWith(`:${rule.pseudo}`)
			? `${rule.selector}:${rule.pseudo}`
			: rule.selector
	}
	const kindPart = rule.kind || "*"
	const idPart = rule.id ? `#${rule.id}` : ""
	const classPart = rule.className
		? `.${rule.className
				.split(".")
				.filter((entry) => entry.length > 0)
				.join(".")}`
		: ""
	const base = `${kindPart}${idPart}${classPart}` || "*"
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
export function hoverTextFor(
	node: VmlNode,
	rules: VmlStyleRule[],
	ancestors: VmlNode[] = [],
	variables: Record<string, string> = {},
): string {
	const lines: string[] = []
	const id = node.props["id"] ? ` id \`${unquote(node.props["id"] ?? "")}\`` : ""
	const className = node.props["class"] ? ` class \`${unquote(node.props["class"] ?? "")}\`` : ""
	lines.push(`**${node.kind}**${id}${className}`)
	const matched = matchingRules(node, rules, ancestors)
	const classes = nodeClasses(node)
	const nodeIdValue = nodeId(node)
	const conditional = normalizeRules(rules).filter(
		(rule) => rule.pseudo && selectorMatches(rule, node.kind, classes, nodeIdValue, ancestors),
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
	const resolved = resolvedDeclarations(node, rules, ancestors, variables)
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
