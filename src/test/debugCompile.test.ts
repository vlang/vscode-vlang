import * as assert from "assert"
import * as os from "os"
import * as path from "path"
import { describe, it } from "node:test"
import { debugBinaryPath, debugCompileArgs } from "../debugCompile"

describe("V debug compile", () => {
	it("writes the debug binary to a temporary directory", () => {
		const binary = debugBinaryPath("/w/app/src/main.v")
		// A debug build is not something the user asked to keep, so it goes to a
		// temporary directory rather than next to the source.
		assert.strictEqual(path.dirname(binary), os.tmpdir())
		assert.ok(path.basename(binary).startsWith("v-debug-"))
		assert.ok(path.basename(binary).endsWith("-main"))
	})

	it("compiles with debug info and an explicit output path", () => {
		// `-g` is the debug info that lets a breakpoint in V source resolve to a
		// location in the binary. `-o` writes to the computed path, because the
		// default output name would land in the source tree.
		assert.deepStrictEqual(debugCompileArgs("/w/app/src/main.v", "/tmp/v-debug-main"), [
			"-g",
			"-o",
			"/tmp/v-debug-main",
			"/w/app/src/main.v",
		])
	})

	it("gives every debug binary a distinct name", () => {
		// Two sessions on the same program must not collide, so the name carries a
		// timestamp.
		const first = debugBinaryPath("/w/app/src/main.v")
		const second = debugBinaryPath("/w/app/src/main.v")
		assert.notStrictEqual(first, second)
	})
})
