// Pure base encoding helpers (base64, hex, base32, base58).
// This module is vscode-free so it can be unit tested with plain node.

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

export function encodeBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64")
}

export function decodeBase64(text: string): Uint8Array {
	if (text.length === 0) {
		return new Uint8Array(0)
	}
	if (text.length % 4 !== 0) {
		throw new Error(`invalid base64: length ${text.length} is not a multiple of 4`)
	}
	if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
		throw new Error("invalid base64: unexpected character or padding")
	}
	const decoded = Buffer.from(text, "base64")
	if (decoded.toString("base64") !== text) {
		throw new Error("invalid base64: non-canonical trailing bits")
	}
	return Uint8Array.from(decoded)
}

export function encodeHex(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("hex")
}

export function decodeHex(text: string): Uint8Array {
	if (text.length % 2 !== 0) {
		throw new Error(`invalid hex: odd length ${text.length}`)
	}
	if (!/^(?:[0-9a-fA-F]{2})*$/.test(text)) {
		throw new Error("invalid hex: unexpected character")
	}
	return Uint8Array.from(Buffer.from(text, "hex"))
}

export function encodeBase32(bytes: Uint8Array): string {
	let out = ""
	let buffer = 0
	let held = 0
	for (const byte of bytes) {
		buffer = (buffer << 8) | byte
		held += 8
		while (held >= 5) {
			held -= 5
			out += base32Alphabet.charAt((buffer >> held) & 31)
		}
	}
	if (held > 0) {
		out += base32Alphabet.charAt((buffer << (5 - held)) & 31)
	}
	while (out.length % 8 !== 0) {
		out += "="
	}
	return out
}

export function decodeBase32(text: string): Uint8Array {
	if (text.length === 0) {
		return new Uint8Array(0)
	}
	if (text.length % 8 !== 0) {
		throw new Error(`invalid base32: length ${text.length} is not a multiple of 8`)
	}
	const out: number[] = []
	for (let block = 0; block < text.length; block += 8) {
		const chunk = text.slice(block, block + 8)
		let dataChars = 8
		while (dataChars > 0 && chunk.charAt(dataChars - 1) === "=") {
			dataChars--
		}
		if (dataChars !== 2 && dataChars !== 4 && dataChars !== 5 && dataChars !== 7) {
			if (dataChars !== 8) {
				throw new Error(`invalid base32: bad padding in block starting at index ${block}`)
			}
		}
		for (let i = dataChars; i < 8; i++) {
			if (chunk.charAt(i) !== "=") {
				throw new Error(`invalid base32: misplaced padding at index ${block + i}`)
			}
		}
		let buffer = 0
		let held = 0
		for (let i = 0; i < dataChars; i++) {
			const char = chunk.charAt(i)
			if (char === "=") {
				throw new Error(`invalid base32: misplaced padding at index ${block + i}`)
			}
			const value = base32Alphabet.indexOf(char)
			if (value < 0) {
				throw new Error(
					`invalid base32: bad character ${JSON.stringify(char)} ` +
						`at index ${block + i}`,
				)
			}
			buffer = (buffer << 5) | value
			held += 5
			if (held >= 8) {
				held -= 8
				out.push((buffer >> held) & 255)
			}
		}
		if (held > 0 && buffer & ((1 << held) - 1)) {
			throw new Error(
				`invalid base32: non-zero trailing bits in block starting at index ${block}`,
			)
		}
	}
	if (encodeBase32(Uint8Array.from(out)) !== text) {
		throw new Error("invalid base32: non-canonical encoding")
	}
	return Uint8Array.from(out)
}

export function encodeBase58(bytes: Uint8Array): string {
	let zeroes = 0
	while (zeroes < bytes.length && bytes[zeroes] === 0) {
		zeroes++
	}
	if (zeroes === bytes.length) {
		return "1".repeat(bytes.length)
	}
	const digits: number[] = [0]
	for (let i = zeroes; i < bytes.length; i++) {
		const byte = bytes[i]
		if (byte === undefined) {
			throw new Error(`invalid base58 input: missing byte at index ${i}`)
		}
		let carry = byte
		for (let j = 0; j < digits.length; j++) {
			const current = digits[j]
			if (current === undefined) {
				throw new Error(`invalid base58 input: missing digit at index ${j}`)
			}
			carry += current * 256
			digits[j] = carry % 58
			carry = Math.floor(carry / 58)
		}
		while (carry > 0) {
			digits.push(carry % 58)
			carry = Math.floor(carry / 58)
		}
	}
	let out = "1".repeat(zeroes)
	for (let i = digits.length - 1; i >= 0; i--) {
		const digit = digits[i]
		if (digit === undefined) {
			throw new Error(`invalid base58 input: missing digit at index ${i}`)
		}
		out += base58Alphabet.charAt(digit)
	}
	return out
}

export function decodeBase58(text: string): Uint8Array {
	if (text.length === 0) {
		return new Uint8Array(0)
	}
	let zeroes = 0
	while (zeroes < text.length && text.charAt(zeroes) === "1") {
		zeroes++
	}
	if (zeroes === text.length) {
		return new Uint8Array(zeroes)
	}
	const bytes: number[] = [0]
	for (let i = zeroes; i < text.length; i++) {
		const char = text.charAt(i)
		const value = base58Alphabet.indexOf(char)
		if (value < 0) {
			throw new Error(`invalid base58: bad character ${JSON.stringify(char)} at index ${i}`)
		}
		let carry = value
		for (let j = 0; j < bytes.length; j++) {
			const current = bytes[j]
			if (current === undefined) {
				throw new Error(`invalid base58 input: missing byte at index ${j}`)
			}
			carry += current * 58
			bytes[j] = carry % 256
			carry = Math.floor(carry / 256)
		}
		while (carry > 0) {
			bytes.push(carry % 256)
			carry = Math.floor(carry / 256)
		}
	}
	while (bytes.length > 1 && bytes[bytes.length - 1] === 0) {
		bytes.pop()
	}
	const out = new Uint8Array(zeroes + bytes.length)
	for (let i = 0; i < bytes.length; i++) {
		const byte = bytes[bytes.length - 1 - i]
		if (byte === undefined) {
			throw new Error(`invalid base58 input: missing byte at index ${i}`)
		}
		out[zeroes + i] = byte
	}
	if (encodeBase58(out) !== text) {
		throw new Error("invalid base58: non-canonical encoding")
	}
	return out
}
