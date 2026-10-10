import * as assert from "assert"
import { describe, it } from "node:test"
import {
	decodeBase32,
	decodeBase58,
	decodeBase64,
	decodeHex,
	encodeBase32,
	encodeBase58,
	encodeBase64,
	encodeHex,
} from "../convert"

function bytesOf(text: string): Uint8Array {
	return new TextEncoder().encode(text)
}

function textOf(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("utf8")
}

function allByteValues(): Uint8Array {
	const out = new Uint8Array(256)
	for (let i = 0; i < 256; i++) {
		out[i] = i
	}
	return out
}

function checkRoundTrips(
	encode: (bytes: Uint8Array) => string,
	decode: (text: string) => Uint8Array,
): void {
	assert.deepStrictEqual(decode(encode(new Uint8Array(0))), new Uint8Array(0))
	const all = allByteValues()
	assert.deepStrictEqual(decode(encode(all)), all)
	for (let len = 0; len <= 16; len++) {
		const slice = all.slice(0, len)
		assert.deepStrictEqual(decode(encode(slice)), slice)
	}
	assert.deepStrictEqual(
		decode(encode(new Uint8Array([0, 0, 0, 1, 2, 3]))),
		new Uint8Array([0, 0, 0, 1, 2, 3]),
	)
}

describe("base64", () => {
	it("encodes RFC 4648 vectors", () => {
		const cases: Array<[string, string]> = [
			["", ""],
			["f", "Zg=="],
			["fo", "Zm8="],
			["foo", "Zm9v"],
			["foob", "Zm9vYg=="],
			["fooba", "Zm9vYmE="],
			["foobar", "Zm9vYmFy"],
		]
		for (const [plain, encoded] of cases) {
			assert.strictEqual(encodeBase64(bytesOf(plain)), encoded)
			assert.deepStrictEqual(decodeBase64(encoded), bytesOf(plain))
		}
	})

	it("round-trips empty input, all byte values and short lengths", () => {
		checkRoundTrips(encodeBase64, decodeBase64)
	})

	it("rejects bad lengths", () => {
		for (const bad of ["Z", "Zg", "Zg=", "Zm9vYmF", "Zm9vYmFy==="]) {
			assert.throws(() => decodeBase64(bad), Error)
		}
	})

	it("rejects bad characters and bad padding", () => {
		for (const bad of ["Zm9vYmFy!", "Zm9v*2Fy", "====", "=g==", "AB=C", "A==="]) {
			assert.throws(() => decodeBase64(bad), Error)
		}
	})

	it("rejects non-canonical trailing bits", () => {
		assert.throws(() => decodeBase64("Zh=="), Error)
		assert.strictEqual(textOf(decodeBase64("Zg==")), "f")
	})
})

describe("hex", () => {
	it("encodes vectors in lowercase", () => {
		assert.strictEqual(encodeHex(bytesOf("")), "")
		assert.strictEqual(encodeHex(bytesOf("foobar")), "666f6f626172")
		assert.strictEqual(encodeHex(bytesOf("Hello, World!")), "48656c6c6f2c20576f726c6421")
		assert.match(encodeHex(allByteValues()), /^[0-9a-f]*$/)
	})

	it("decodes upper, lower and mixed case", () => {
		assert.deepStrictEqual(decodeHex(""), bytesOf(""))
		assert.deepStrictEqual(decodeHex("666f6f626172"), bytesOf("foobar"))
		assert.deepStrictEqual(decodeHex("666F6F626172"), bytesOf("foobar"))
		assert.deepStrictEqual(decodeHex("666f6F626172"), bytesOf("foobar"))
	})

	it("round-trips empty input, all byte values and short lengths", () => {
		checkRoundTrips(encodeHex, decodeHex)
	})

	it("rejects odd lengths and bad characters", () => {
		for (const bad of ["f", "abc", "0", "666f6f62617", "zz", "0g", "0x12", "12 34"]) {
			assert.throws(() => decodeHex(bad), Error)
		}
	})
})

describe("base32", () => {
	it("encodes RFC 4648 vectors", () => {
		const cases: Array<[string, string]> = [
			["", ""],
			["f", "MY======"],
			["fo", "MZXQ===="],
			["foo", "MZXW6==="],
			["foob", "MZXW6YQ="],
			["fooba", "MZXW6YTB"],
			["foobar", "MZXW6YTBOI======"],
			["hello v", "NBSWY3DPEB3A===="],
		]
		for (const [plain, encoded] of cases) {
			assert.strictEqual(encodeBase32(bytesOf(plain)), encoded)
			assert.deepStrictEqual(decodeBase32(encoded), bytesOf(plain))
		}
	})

	it("round-trips empty input, all byte values and short lengths", () => {
		checkRoundTrips(encodeBase32, decodeBase32)
	})

	it("rejects bad lengths", () => {
		for (const bad of ["M", "MY=====", "MFRGGZDFY", "MZXW6YTBOI=====", "MZXW6YTB="]) {
			assert.throws(() => decodeBase32(bad), Error)
		}
	})

	it("rejects bad characters and lowercase", () => {
		for (const bad of ["MZ*W6===", "MZXW6!!=", "mzxw6ytboi======", "MZXW6YT0I======"]) {
			assert.throws(() => decodeBase32(bad), Error)
		}
	})

	it("rejects bad and misplaced padding", () => {
		for (const bad of ["M=======", "MZX=====", "MZXW6Y==", "MY==X===", "MZXW6YTB===="]) {
			assert.throws(() => decodeBase32(bad), Error)
		}
	})

	it("rejects non-zero trailing bits", () => {
		assert.throws(() => decodeBase32("MZ======"), Error)
		assert.strictEqual(textOf(decodeBase32("MY======")), "f")
	})
})

describe("base58", () => {
	it("encodes known vectors", () => {
		const cases: Array<[string, string]> = [
			["", ""],
			["hello world", "StV1DL6CwTryKyV"],
			["lorem ipsum", "TtaR6twpTGu8VpY"],
		]
		for (const [plain, encoded] of cases) {
			assert.strictEqual(encodeBase58(bytesOf(plain)), encoded)
			assert.deepStrictEqual(decodeBase58(encoded), bytesOf(plain))
		}
	})

	it("maps leading zero bytes to '1'", () => {
		const cases: Array<[number[], string]> = [
			[[], ""],
			[[0], "1"],
			[[0, 0], "11"],
			[[0, 0, 0, 1], "1112"],
		]
		for (const [raw, encoded] of cases) {
			assert.strictEqual(encodeBase58(new Uint8Array(raw)), encoded)
			assert.deepStrictEqual(decodeBase58(encoded), new Uint8Array(raw))
		}
		assert.deepStrictEqual(decodeBase58("11111111"), new Uint8Array(8))
	})

	it("round-trips empty input, all byte values and short lengths", () => {
		checkRoundTrips(encodeBase58, decodeBase58)
	})

	it("decodes empty input without throwing", () => {
		assert.deepStrictEqual(decodeBase58(""), new Uint8Array(0))
	})

	it("rejects characters outside the Bitcoin alphabet", () => {
		for (const bad of ["0", "O", "I", "l", " ", "!", "abc+", "a/b", "StV1DL6CwTryKyV!"]) {
			assert.throws(() => decodeBase58(bad), Error)
		}
	})
})
