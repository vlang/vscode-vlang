import * as assert from "assert"
import { describe, it } from "node:test"
import { hoverTextFor, literalAtOffset, literalToDecimal } from "../numberHover"

describe("non-decimal literal hover", () => {
	it("finds a hex literal and renders its decimal value", () => {
		assert.deepStrictEqual(literalAtOffset("x := 0xFF", 6), {
			text: "0xFF",
			start: 5,
			end: 9,
			radix: 16,
		})
		assert.strictEqual(hoverTextFor({ text: "0xFF", radix: 16 }), "0xFF = 255 (hex)")
	})

	it("finds an octal literal and renders its decimal value", () => {
		assert.deepStrictEqual(literalAtOffset("v := 0o17", 7), {
			text: "0o17",
			start: 5,
			end: 9,
			radix: 8,
		})
		assert.strictEqual(hoverTextFor({ text: "0o17", radix: 8 }), "0o17 = 15 (octal)")
	})

	it("finds a binary literal and renders its decimal value", () => {
		assert.deepStrictEqual(literalAtOffset("v := 0b1010", 9), {
			text: "0b1010",
			start: 5,
			end: 11,
			radix: 2,
		})
		assert.strictEqual(hoverTextFor({ text: "0b1010", radix: 2 }), "0b1010 = 10 (binary)")
	})

	it("accepts uppercase prefixes", () => {
		assert.strictEqual(literalToDecimal({ text: "0XAB", radix: 16 }), "171")
		assert.strictEqual(literalToDecimal({ text: "0O17", radix: 8 }), "15")
		assert.strictEqual(literalToDecimal({ text: "0B1010", radix: 2 }), "10")
		assert.strictEqual(hoverTextFor({ text: "0XFF", radix: 16 }), "0XFF = 255 (hex)")
	})

	it("ignores underscores between digits", () => {
		assert.strictEqual(literalToDecimal({ text: "0xFF_FF", radix: 16 }), "65535")
		assert.strictEqual(literalToDecimal({ text: "0o1_7", radix: 8 }), "15")
		assert.strictEqual(literalToDecimal({ text: "0b1010_0101", radix: 2 }), "165")
	})

	it("honours start/end boundaries", () => {
		assert.deepStrictEqual(literalAtOffset("v := 0o17", 5)?.text, "0o17")
		assert.deepStrictEqual(literalAtOffset("v := 0o17", 8)?.text, "0o17")
		assert.strictEqual(literalAtOffset("v := 0o17", 9), undefined)
		assert.strictEqual(literalAtOffset("v := 0o17", 4), undefined)
		assert.strictEqual(literalAtOffset("v := 0o17", 0), undefined)
	})

	it("picks the literal under the offset when a line holds two", () => {
		assert.deepStrictEqual(literalAtOffset("0xFF 0o17", 1)?.text, "0xFF")
		assert.deepStrictEqual(literalAtOffset("0xFF 0o17", 6)?.text, "0o17")
		assert.strictEqual(literalAtOffset("0xFF 0o17", 4), undefined)
	})

	it("rejects digits outside the radix instead of matching a prefix", () => {
		assert.strictEqual(literalAtOffset("v := 0b2", 6), undefined)
		assert.strictEqual(literalAtOffset("v := 0o8", 6), undefined)
		assert.strictEqual(literalAtOffset("v := 0xG", 6), undefined)
		assert.strictEqual(literalAtOffset("v := 0xFFg", 7), undefined)
		assert.strictEqual(literalToDecimal({ text: "0b2", radix: 2 }), undefined)
		assert.strictEqual(literalToDecimal({ text: "0o8", radix: 8 }), undefined)
		assert.strictEqual(literalToDecimal({ text: "0xG", radix: 16 }), undefined)
	})

	it("rejects bare prefixes and misplaced separators", () => {
		assert.strictEqual(literalAtOffset("v := 0x", 6), undefined)
		assert.strictEqual(literalAtOffset("v := 0b_20", 6), undefined)
		assert.strictEqual(literalAtOffset("v := 0xFF_", 8), undefined)
		assert.strictEqual(literalAtOffset("v := 0b1__0", 7), undefined)
		assert.strictEqual(literalToDecimal({ text: "0x", radix: 16 }), undefined)
		assert.strictEqual(literalToDecimal({ text: "0x_FF", radix: 16 }), undefined)
		assert.strictEqual(literalToDecimal({ text: "0xFF_", radix: 16 }), undefined)
		assert.strictEqual(literalToDecimal({ text: "0b1__0", radix: 2 }), undefined)
	})

	it("keeps huge values exact via BigInt", () => {
		const maxU64 = "18446744073709551615"
		assert.strictEqual(literalToDecimal({ text: "0xFFFFFFFFFFFFFFFF", radix: 16 }), maxU64)
		assert.strictEqual(literalToDecimal({ text: "0b" + "1".repeat(64), radix: 2 }), maxU64)
		assert.strictEqual(literalToDecimal({ text: "0o1777777777777777777777", radix: 8 }), maxU64)
	})

	it("ignores decimal text and non-numbers", () => {
		assert.strictEqual(literalAtOffset("v := 12345", 6), undefined)
		assert.strictEqual(literalAtOffset("v := 0", 5), undefined)
		assert.strictEqual(literalAtOffset("v := 3.14", 6), undefined)
		assert.strictEqual(literalAtOffset("hello world", 2), undefined)
		assert.strictEqual(literalAtOffset("", 0), undefined)
	})

	it("ignores literals glued to identifiers", () => {
		assert.strictEqual(literalAtOffset("a0xFF", 2), undefined)
	})

	it("reports invalid literals instead of throwing", () => {
		assert.strictEqual(
			hoverTextFor({ text: "0xG", radix: 16 }),
			"0xG is not a valid hex literal",
		)
		assert.strictEqual(
			hoverTextFor({ text: "0xFF", radix: 2 }),
			"0xFF is not a valid binary literal",
		)
	})
})
