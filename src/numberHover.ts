/** Hover text for non-decimal V integer literals.
 *
 * Everything here is pure so it can be tested without an editor. The editor
 * wiring (hover provider) lives elsewhere.
 *
 * V integer literals follow the scanner (`vlib/v/scanner/scanner.v`,
 * `number()`): `0b`/`0B` binary, `0o`/`0O` octal, `0x`/`0X` hex, with `_`
 * separators allowed only between digits. No other prefixes exist.
 */

export interface NumberLiteral {
	text: string
	start: number
	end: number
	radix: 2 | 8 | 16
}

const candidatePattern = /0[xXoObB][0-9A-Za-z_]*/g
const identifierChar = /[A-Za-z0-9_]/

function radixOf(prefixChar: string): 2 | 8 | 16 | undefined {
	if (prefixChar === "x" || prefixChar === "X") {
		return 16
	}
	if (prefixChar === "o" || prefixChar === "O") {
		return 8
	}
	if (prefixChar === "b" || prefixChar === "B") {
		return 2
	}
	return undefined
}

function radixName(radix: 2 | 8 | 16): string {
	if (radix === 16) {
		return "hex"
	}
	if (radix === 8) {
		return "octal"
	}
	return "binary"
}

function digitValue(char: string): number {
	const code = char.charCodeAt(0)
	if (code >= 48 && code <= 57) {
		return code - 48
	}
	if (code >= 97 && code <= 102) {
		return code - 87
	}
	if (code >= 65 && code <= 70) {
		return code - 55
	}
	return -1
}

/** Digits are valid when every character fits the radix and `_` only sits
 * between two digits, matching the scanner's separator rules. */
function digitsValid(digits: string, radix: 2 | 8 | 16): boolean {
	if (digits.length === 0 || digits.startsWith("_") || digits.endsWith("_")) {
		return false
	}
	let previousUnderscore = false
	for (const char of digits) {
		if (char === "_") {
			if (previousUnderscore) {
				return false
			}
			previousUnderscore = true
			continue
		}
		previousUnderscore = false
		const value = digitValue(char)
		if (value < 0 || value >= radix) {
			return false
		}
	}
	return true
}

/** Non-decimal literal containing `offset` (`offset` inside `[start, end)`).
 *
 * Returns `undefined` for decimal text, for malformed candidates such as
 * `0xG` or a bare `0x` (no valid-prefix fallback), for literals glued to an
 * identifier such as `a0xFF`, and for offsets outside any literal.
 */
export function literalAtOffset(lineText: string, offset: number): NumberLiteral | undefined {
	candidatePattern.lastIndex = 0
	let match = candidatePattern.exec(lineText)
	while (match !== null) {
		const text = match[0]
		const start = match.index
		const end = start + text.length
		if (offset >= end) {
			match = candidatePattern.exec(lineText)
			continue
		}
		if (offset < start) {
			return undefined
		}
		if (start > 0 && identifierChar.test(lineText.charAt(start - 1))) {
			return undefined
		}
		const radix = radixOf(text.charAt(1))
		if (radix === undefined || !digitsValid(text.slice(2), radix)) {
			return undefined
		}
		return { text, start, end, radix }
	}
	return undefined
}

/** Exact decimal string for a literal, or `undefined` when its digits do
 * not fit the radix. Never throws. */
export function literalToDecimal(literal: { text: string; radix: 2 | 8 | 16 }): string | undefined {
	if (radixOf(literal.text.charAt(1)) !== literal.radix) {
		return undefined
	}
	const digits = literal.text.slice(2)
	if (!digitsValid(digits, literal.radix)) {
		return undefined
	}
	let value = 0n
	const base = BigInt(literal.radix)
	for (const char of digits) {
		if (char === "_") {
			continue
		}
		value = value * base + BigInt(digitValue(char))
	}
	return value.toString(10)
}

/** Renders e.g. `0xFF = 255 (hex)`, naming the radix. */
export function hoverTextFor(literal: { text: string; radix: 2 | 8 | 16 }): string {
	const decimal = literalToDecimal(literal)
	if (decimal === undefined) {
		return `${literal.text} is not a valid ${radixName(literal.radix)} literal`
	}
	return `${literal.text} = ${decimal} (${radixName(literal.radix)})`
}
