/** Parse XML and CSV documents into plain values for struct inference.
 *
 * Both parsers are pure and dependency-free so they bundle anywhere the
 * struct core goes. Type inference stays downstream: `structsFromValue`
 * in `decodeStruct.ts` decides every V type from the values produced here.
 *
 * XML mapping — each element becomes a plain object the core already
 * handles, with no wrapper convention:
 * - attributes are plain keys: `<book id="1">` gives `{ id: "1", ... }`.
 * - child elements are keys of the child tag, so `<a><b>x</b></a>` gives
 *   `{ b: "x" }` for the inner element. Repeated siblings collapse into
 *   an array in document order: two `<book>` children give `{ book: [...] }`
 *   while a single child stays a bare value.
 * - text content of a text-only element is a bare string: `<b>x</b>`
 *   gives `"x"`. An element that also carries attributes or children keeps
 *   its text under the `#text` key instead (tag and attribute names can
 *   never contain `#`, so the key cannot collide with one).
 * - whitespace-only text between elements is ignored; a childless and
 *   attributeless element with no text (`<br/>`) is the empty string.
 * - the five predefined entities (`amp`, `lt`, `gt`, `quot`, `apos`) and
 *   numeric references (`&#65;`, `&#x41;`) are decoded in text and in
 *   attribute values; anything else after `&` is an error.
 *
 * The XML reader is deliberately strict, not complete: comments are
 * skipped, but everything it cannot represent faithfully is rejected with
 * an `Error` — DTD/doctype declarations, processing instructions (the XML
 * declaration counts as one and is rejected like any other), namespaces
 * (any `:` in a tag or attribute name), CDATA sections, and mixed content
 * (an element holding both non-whitespace text and child elements). Tag
 * and attribute names are ASCII (`[A-Za-z_][A-Za-z0-9_.-]*`).
 *
 * CSV mapping (RFC 4180) — the header row gives the keys and every
 * following row becomes a `Record<string, string>`. All values stay strings
 * because CSV typing happens downstream in the struct core. Quoted fields
 * may hold commas, line breaks (CRLF or LF, normalized to `\n`) and `""`
 * escapes. Ragged rows (a field count other than the header's),
 * unterminated quotes, stray quotes and duplicate header names throw.
 * Blank lines are data rows holding one empty field, not skipped, so a
 * blank line inside multi-column input fails as ragged. Empty input yields
 * `[]`, as does a header with no data rows; one trailing newline ends the
 * last row instead of starting a new one.
 */

const predefinedEntities: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
}

function codePointToString(code: number, body: string): string {
	try {
		return String.fromCodePoint(code)
	} catch {
		throw new Error(`Invalid character reference \`&${body};\`.`)
	}
}

function decodeNumericReference(body: string): string {
	if (body.startsWith("#x") || body.startsWith("#X")) {
		const digits = body.slice(2)
		const code = Number.parseInt(digits, 16)
		if (!/^[0-9A-Fa-f]+$/.test(digits) || !Number.isSafeInteger(code)) {
			throw new Error(`Invalid character reference \`&${body};\`.`)
		}
		return codePointToString(code, body)
	}
	const digits = body.slice(1)
	const code = Number.parseInt(digits, 10)
	if (!/^[0-9]+$/.test(digits) || !Number.isSafeInteger(code)) {
		throw new Error(`Invalid character reference \`&${body};\`.`)
	}
	return codePointToString(code, body)
}

/** Decode `&...;` references in XML text or an attribute value. */
function decodeEntities(input: string): string {
	let out = ""
	let rest = input
	for (;;) {
		const amp = rest.indexOf("&")
		if (amp === -1) {
			return out + rest
		}
		const semi = rest.indexOf(";", amp + 1)
		if (semi === -1) {
			throw new Error(`Unterminated entity reference in ${JSON.stringify(input)}.`)
		}
		const body = rest.slice(amp + 1, semi)
		const predefined = predefinedEntities[body]
		let replacement: string
		if (predefined !== undefined) {
			replacement = predefined
		} else if (body.startsWith("#")) {
			replacement = decodeNumericReference(body)
		} else {
			throw new Error(`Unknown entity \`&${body};\`.`)
		}
		out += rest.slice(0, amp) + replacement
		rest = rest.slice(semi + 1)
	}
}

const xmlNamePattern = /^[A-Za-z_][A-Za-z0-9_.-]*$/

function checkXmlName(name: string, kind: string): void {
	if (name.includes(":")) {
		throw new Error(`Namespaces are not supported (${kind} ${JSON.stringify(name)}).`)
	}
	if (!xmlNamePattern.test(name)) {
		throw new Error(`Invalid ${kind} name ${JSON.stringify(name)}.`)
	}
}

interface XmlFrame {
	tag: string
	attrs: Record<string, string>
	order: string[]
	children: Record<string, unknown>
	text: string
}

/** Build the plain value for a closed element. */
function frameValue(frame: XmlFrame): unknown {
	const blank = frame.text.trim() === ""
	if (frame.order.length > 0 && !blank) {
		throw new Error(`Mixed content in <${frame.tag}>: text beside child elements.`)
	}
	if (frame.order.length === 0 && Object.keys(frame.attrs).length === 0) {
		return decodeEntities(frame.text)
	}
	const merged: Record<string, unknown> = { ...frame.attrs, ...frame.children }
	if (!blank) {
		return { ...merged, "#text": decodeEntities(frame.text) }
	}
	return merged
}

/** Parse an XML document into plain objects, arrays and strings. */
export function parseXmlDocument(text: string): unknown {
	const src = text.replace(/^\uFEFF/, "")
	let pos = 0
	const stack: XmlFrame[] = []
	let root: unknown = undefined
	let hasRoot = false

	const fail = (message: string): never => {
		throw new Error(message)
	}
	const peek = (token: string): boolean => src.startsWith(token, pos)
	const skipWhitespace = (): void => {
		const match = /^[ \t\r\n]+/.exec(src.slice(pos))
		if (match !== null) {
			const gap = match[0]
			if (gap !== undefined) {
				pos += gap.length
			}
		}
	}
	const readName = (): string => {
		const match = /^[A-Za-z_:][A-Za-z0-9_:.-]*/.exec(src.slice(pos))
		if (match === null) {
			return fail(`Expected a name at offset ${pos}.`)
		}
		const raw = match[0]
		if (raw === undefined) {
			return fail(`Expected a name at offset ${pos}.`)
		}
		pos += raw.length
		return raw
	}
	// Null-prototype accumulators so names like `__proto__` stay plain data
	// keys; spreads below turn them into ordinary own properties.
	const readAttributes = (): Record<string, string> => {
		const collected: Record<string, string> = Object.create(null)
		for (;;) {
			skipWhitespace()
			if (peek(">") || peek("/>") || pos >= src.length) {
				return { ...collected }
			}
			const name = readName()
			checkXmlName(name, "attribute")
			if (Object.hasOwn(collected, name)) {
				fail(`Duplicate attribute ${JSON.stringify(name)}.`)
			}
			skipWhitespace()
			if (!peek("=")) {
				fail(`Expected "=" after attribute ${JSON.stringify(name)}.`)
			}
			pos += 1
			skipWhitespace()
			const quote = src.charAt(pos)
			if (quote !== '"' && quote !== "'") {
				fail(`Attribute ${JSON.stringify(name)} must use a quoted value.`)
			}
			pos += 1
			const end = src.indexOf(quote, pos)
			if (end === -1) {
				fail(`Unterminated value for attribute ${JSON.stringify(name)}.`)
			}
			collected[name] = decodeEntities(src.slice(pos, end))
			pos = end + 1
		}
	}
	const attach = (tag: string, value: unknown): void => {
		const parent = stack[stack.length - 1]
		if (parent === undefined) {
			if (hasRoot) {
				fail("Multiple root elements.")
			}
			root = value
			hasRoot = true
			return
		}
		if (Object.hasOwn(parent.children, tag)) {
			const existing = parent.children[tag]
			if (Array.isArray(existing)) {
				existing.push(value)
			} else {
				parent.children[tag] = [existing, value]
			}
		} else {
			parent.order.push(tag)
			parent.children[tag] = value
		}
	}

	while (pos < src.length) {
		const next = src.indexOf("<", pos)
		if (next === -1) {
			const tail = src.slice(pos)
			pos = src.length
			const top = stack[stack.length - 1]
			if (top !== undefined) {
				top.text += tail
				break
			}
			if (tail.trim() !== "") {
				fail(hasRoot ? "Unexpected text after the root element." : "Expected an element.")
			}
			break
		}
		const top = stack[stack.length - 1]
		if (top !== undefined) {
			if (next > pos) {
				top.text += src.slice(pos, next)
			}
		} else if (src.slice(pos, next).trim() !== "") {
			fail(hasRoot ? "Unexpected text after the root element." : "Expected an element.")
		}
		pos = next
		if (peek("<!--")) {
			const end = src.indexOf("-->", pos + 4)
			if (end === -1) {
				fail("Unterminated comment.")
			}
			pos = end + 3
			continue
		}
		if (peek("<![CDATA[")) {
			fail("CDATA sections are not supported.")
		}
		if (peek("<!")) {
			if (
				src
					.slice(pos, pos + 9)
					.toUpperCase()
					.startsWith("<!DOCTYPE")
			) {
				fail("DTD/doctype declarations are not supported.")
			}
			fail("Unsupported <! declaration.")
		}
		if (peek("<?")) {
			if (src.indexOf("?>", pos + 2) === -1) {
				fail("Unterminated processing instruction.")
			}
			fail("Processing instructions are not supported (this includes <?xml ...?>).")
		}
		if (peek("</")) {
			pos += 2
			const name = readName()
			checkXmlName(name, "element")
			skipWhitespace()
			if (!peek(">")) {
				fail(`Expected ">" to close </${name}>.`)
			}
			pos += 1
			const frame = stack.pop() ?? fail(`Stray closing tag </${name}>.`)
			if (frame.tag !== name) {
				fail(`Mismatched tags: <${frame.tag}> closed by </${name}>.`)
			}
			attach(frame.tag, frameValue(frame))
			continue
		}
		pos += 1
		if (pos >= src.length) {
			fail("Unexpected end of input inside a tag.")
		}
		const tag = readName()
		checkXmlName(tag, "element")
		const attrs = readAttributes()
		if (peek("/>")) {
			pos += 2
			attach(
				tag,
				frameValue({ tag, attrs, order: [], children: Object.create(null), text: "" }),
			)
		} else if (peek(">")) {
			pos += 1
			stack.push({ tag, attrs, order: [], children: Object.create(null), text: "" })
		} else {
			fail(`Unterminated start tag <${tag}>.`)
		}
	}
	const open = stack[stack.length - 1]
	if (open !== undefined) {
		fail(`Unclosed element <${open.tag}>.`)
	}
	if (!hasRoot) {
		fail("No root element: the document is empty.")
	}
	return root
}

/** Parse an RFC 4180 CSV document into one object per row past the header. */
export function parseCsvDocument(text: string): Record<string, string>[] {
	const src = text
		.replace(/^\uFEFF/, "")
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
	if (src === "") {
		return []
	}
	const rows: string[][] = []
	let field = ""
	let row: string[] = []
	let pending = false
	let inQuotes = false
	let justClosed = false
	const pushField = (): void => {
		row.push(field)
		field = ""
	}
	const pushRow = (): void => {
		pushField()
		rows.push(row)
		row = []
		pending = false
		justClosed = false
	}
	let pos = 0
	while (pos < src.length) {
		const ch = src.charAt(pos)
		if (inQuotes) {
			if (ch === '"') {
				if (src.charAt(pos + 1) === '"') {
					field += '"'
					pos += 2
				} else {
					inQuotes = false
					justClosed = true
					pos += 1
				}
			} else {
				field += ch
				pos += 1
			}
			pending = true
		} else if (ch === '"') {
			if (justClosed || field !== "") {
				throw new Error(`Stray quote at offset ${pos}: quoted fields must span the field.`)
			}
			inQuotes = true
			pending = true
			pos += 1
		} else if (ch === ",") {
			pushField()
			pending = true
			justClosed = false
			pos += 1
		} else if (ch === "\n") {
			pushRow()
			pos += 1
		} else {
			if (justClosed) {
				throw new Error(`Unexpected text after a closing quote at offset ${pos}.`)
			}
			field += ch
			pending = true
			pos += 1
		}
	}
	if (inQuotes) {
		throw new Error("Unterminated quoted field.")
	}
	if (pending) {
		pushRow()
	}
	const header = rows[0]
	if (header === undefined) {
		return []
	}
	const seen = new Set<string>()
	for (const name of header) {
		if (seen.has(name)) {
			throw new Error(`Duplicate header name ${JSON.stringify(name)}.`)
		}
		seen.add(name)
	}
	const records: Record<string, string>[] = []
	for (let i = 1; i < rows.length; i++) {
		const cells = rows[i]
		if (cells === undefined || cells.length !== header.length) {
			throw new Error(
				`Row ${i + 1} has ${cells?.length ?? 0} fields, expected ${header.length}.`,
			)
		}
		const entries: Array<[string, string]> = []
		for (let c = 0; c < header.length; c++) {
			const key = header[c]
			const value = cells[c]
			if (key !== undefined && value !== undefined) {
				entries.push([key, value])
			}
		}
		records.push(Object.fromEntries(entries))
	}
	return records
}

/** Merge repeat siblings with differing shapes into one representative.
 *
 * XML-only policy: repeats usually share a shape (RSS items with optional
 * children), and a union struct beats `[]Any`. Each key takes its first
 * non-missing value; a key whose values disagree in shape keeps the
 * first (deterministic, documented). The merged representative stays a
 * single-element array so the core still infers a list. Applies
 * recursively. JSON keeps its `Any` fallback instead.
 */
export function mergeRepeatShapes(value: unknown): unknown {
	if (Array.isArray(value)) {
		const merged = value.map((element) => mergeRepeatShapes(element))
		const objects = merged.filter(
			(element): element is Record<string, unknown> =>
				typeof element === "object" && element !== null && !Array.isArray(element),
		)
		if (objects.length === merged.length && objects.length > 0) {
			const union: Record<string, unknown> = {}
			for (const object of objects) {
				for (const key of Object.keys(object)) {
					if (!(key in union)) {
						union[key] = object[key]
					}
				}
			}
			return [union]
		}
		return merged
	}
	if (typeof value === "object" && value !== null) {
		const merged: Record<string, unknown> = {}
		for (const key of Object.keys(value)) {
			merged[key] = mergeRepeatShapes((value as Record<string, unknown>)[key])
		}
		return merged
	}
	return value
}

function inferCsvScalar(text: string): string | number | boolean {
	if (/^-?\d+$/.test(text)) {
		return Number.parseInt(text, 10)
	}
	if (/^-?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(text) && /[.eE]/.test(text)) {
		return Number.parseFloat(text)
	}
	const lowered = text.trim().toLowerCase()
	if (lowered === "true" || lowered === "false") {
		return lowered === "true"
	}
	return text
}

/** Coerce CSV rows so each column shares one type across all rows.
 *
 * A column of all integers becomes `int`, of floats `f64`, of
 * true/false `bool`; anything mixed or otherwise stays `string`, which
 * the CSV decoder always reads losslessly. Empty cells take the column
 * zero. Struct inference then sees uniform columns.
 */
export function typedCsvRecords(
	rows: Record<string, string>[],
): Record<string, string | number | boolean>[] {
	if (rows.length === 0) {
		return []
	}
	const first = rows[0]
	if (first === undefined) {
		return []
	}
	const columns = Object.keys(first)
	const columnKind = (column: string): "int" | "float" | "bool" | "string" => {
		let sawInt = false
		let sawFloat = false
		let sawBool = false
		let sawString = false
		for (const row of rows) {
			const cell = row[column] ?? ""
			if (cell.trim() === "") {
				continue
			}
			const value = inferCsvScalar(cell)
			if (typeof value === "boolean") {
				sawBool = true
			} else if (typeof value === "number") {
				if (Number.isInteger(value)) {
					sawInt = true
				} else {
					sawFloat = true
				}
			} else {
				sawString = true
			}
		}
		if (sawString || (!sawInt && !sawFloat && !sawBool)) {
			return "string"
		}
		if (sawBool && (sawInt || sawFloat)) {
			return "string"
		}
		if (sawBool) {
			return "bool"
		}
		if (sawFloat) {
			return "float"
		}
		return "int"
	}
	const kinds = new Map(columns.map((column) => [column, columnKind(column)]))
	return rows.map((row) => {
		const typed: Record<string, string | number | boolean> = {}
		for (const column of columns) {
			const cell = row[column] ?? ""
			const kind = kinds.get(column)
			if (cell.trim() === "") {
				typed[column] =
					kind === "int" ? 0 : kind === "float" ? 0.0 : kind === "bool" ? false : ""
			} else if (kind === "int" || kind === "float") {
				typed[column] = Number(cell)
			} else if (kind === "bool") {
				typed[column] = cell.trim().toLowerCase() === "true"
			} else {
				typed[column] = cell
			}
		}
		return typed
	})
}
