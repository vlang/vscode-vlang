/** Filling a struct literal from its declaration.
 *
 * Everything here is pure so it can be tested without an editor. The editor
 * wiring (code action plus command) lives in `codeActions.ts`.
 *
 * Only declarations in the same file are read: cross-file lookup is the
 * language server's job, and a wrong guess from another file is worse than
 * no offer.
 */

export interface StructField {
	name: string
	type: string
}

const structDeclaration = /^struct\s+(\w+)\s*\{/
const sectionHeader = /^(pub|mut|__global)(\s+(pub|mut|__global))?:\s*$/

/** Fields of `struct Name` in `source`, in declaration order.
 *
 * Skips section headers (`pub:`, `mut:`), attributes, comments and
 * embedded fields, which carry no name to fill. Generic declarations
 * are not matched. Returns `undefined` when the struct is not declared.
 */
export function structFields(source: string, structName: string): StructField[] | undefined {
	const lines = source.split("\n")
	let inside = false
	const fields: StructField[] = []
	for (const line of lines) {
		const trimmed = line.trim()
		if (!inside) {
			const declaration = structDeclaration.exec(trimmed)
			if (declaration?.[1] === structName) {
				inside = true
			}
			continue
		}
		if (trimmed.startsWith("}")) {
			return fields
		}
		if (
			trimmed === "" ||
			trimmed.startsWith("//") ||
			trimmed.startsWith("@[") ||
			sectionHeader.test(trimmed)
		) {
			continue
		}
		const tokens = trimmed
			.replace(/\s+\/\/.*$/, "")
			.trim()
			.split(/\s+/)
		while (tokens[0] === "pub" || tokens[0] === "mut" || tokens[0] === "__global") {
			tokens.shift()
		}
		if (tokens.length >= 2 && tokens[0] !== undefined && tokens[1] !== undefined) {
			fields.push({ name: tokens[0], type: tokens[1].replace(/,$/, "") })
		}
	}
	return undefined
}

/** A placeholder value for a field type, to be replaced by the user. */
export function zeroValueFor(typeName: string): string {
	if (/^(i8|i16|int|i64|u16|u32|u64|byte|u8|isize|usize)$/.test(typeName)) {
		return "0"
	}
	if (/^(f32|f64)$/.test(typeName)) {
		return "0.0"
	}
	if (typeName === "bool") {
		return "false"
	}
	if (typeName === "string" || typeName === "rune") {
		return "''"
	}
	if (typeName.startsWith("[]")) {
		return "[]"
	}
	if (typeName.startsWith("map[")) {
		return "{}"
	}
	if (typeName.startsWith("?")) {
		return "none"
	}
	return `${typeName}{}`
}

/** A line with string literals and the line comment blanked to spaces.
 *
 * Matching runs against this rather than the raw line, so a literal inside a
 * string (`"Point{}"`) or a comment (`// Point{}`) is never offered as code.
 * Positions are preserved: every masked character becomes one space, so a
 * span found here addresses the original line.
 */
function maskNonCode(lineText: string): string {
	let masked = ""
	let quote: string | undefined
	let index = 0
	while (index < lineText.length) {
		const character = lineText[index]!
		if (quote !== undefined) {
			masked += " "
			if (character === "\\" && index + 1 < lineText.length) {
				masked += " "
				index += 2
				continue
			}
			if (character === quote) {
				quote = undefined
			}
			index++
			continue
		}
		if (character === "'" || character === '"' || character === "`") {
			quote = character
			masked += " "
			index++
			continue
		}
		if (character === "/" && lineText[index + 1] === "/") {
			masked += " ".repeat(lineText.length - index)
			break
		}
		masked += character
		index++
	}
	return masked
}

/** An empty `Name{}` literal on one line, with its span.
 *
 * Comment lines never match, and neither do literals inside strings or
 * comments further down the line. With several literals on one line the one
 * under `column` wins; without a column the first one does, which is what
 * the no-cursor callers had. A column beside every literal matches nothing
 * rather than the wrong one.
 */
export function emptyLiteralAt(
	lineText: string,
	column?: number,
): { name: string; start: number; end: number } | undefined {
	if (lineText.trim().startsWith("//")) {
		return undefined
	}
	const masked = maskNonCode(lineText)
	const pattern = /(\w+)\{\s*\}/g
	const matches = [...masked.matchAll(pattern)]
	if (column === undefined) {
		const match = matches[0]
		if (!match || match[1] === undefined || match.index === undefined) {
			return undefined
		}
		return {
			name: match[1],
			start: match.index + match[1].length,
			end: match.index + match[0].length,
		}
	}
	for (const match of matches) {
		if (!match || match[1] === undefined || match.index === undefined) {
			continue
		}
		const start = match.index
		const end = match.index + match[0].length
		if (start <= column && column <= end) {
			return {
				name: match[1],
				start: match.index + match[1].length,
				end,
			}
		}
	}
	return undefined
}

/** The replacement body for an empty literal of the given fields. */
export function fillStructBody(fields: StructField[]): string {
	const lines = fields.map((field) => `\t${field.name}: ${zeroValueFor(field.type)},`)
	return `{\n${lines.join("\n")}\n}`
}
