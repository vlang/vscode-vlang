import * as assert from "assert"
import * as os from "os"
import * as path from "path"
import { describe, it } from "node:test"
import {
	debugBinaryPath,
	debugCompileArgs,
	debugSessionArgs,
	missingDebuggerMessage,
} from "../debugCompile"

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

	it("breaks on wmain for stopAtEntry on Windows", () => {
		// V inlines `fn main` into the C entry point, which is `wmain` on
		// Windows — there is no `main` symbol, and `break main` answers
		// "Function main not defined". Verified against a `-g` build:
		// `break wmain` stops at the first V statement.
		assert.deepStrictEqual(debugSessionArgs("/tmp/v-debug-main", true, "win32"), [
			"--interpreter=mi2",
			"--eval-command",
			"break wmain",
			"--",
			"/tmp/v-debug-main",
		])
	})

	it("breaks on main for stopAtEntry elsewhere", () => {
		assert.deepStrictEqual(debugSessionArgs("/tmp/v-debug-main", true, "linux"), [
			"--interpreter=mi2",
			"--eval-command",
			"break main",
			"--",
			"/tmp/v-debug-main",
		])
	})

	it("places the eval-command before the binary", () => {
		// gdb treats everything after `--` as excess executable arguments,
		// so an eval-command placed after the binary never runs.
		assert.deepStrictEqual(debugSessionArgs("/tmp/v-debug-main", false, "win32"), [
			"--interpreter=mi2",
			"--",
			"/tmp/v-debug-main",
		])
	})

	it("names a per-OS install route when gdb is missing", () => {
		// A first debug session on default Windows or any macOS dies on a
		// raw spawn error without this; the message must say what to do.
		assert.ok(missingDebuggerMessage("win32").includes("MSYS2"))
		assert.ok(missingDebuggerMessage("darwin").includes("brew install gdb"))
		assert.ok(missingDebuggerMessage("linux").includes("apt install gdb"))
		for (const platform of ["win32", "darwin", "linux"] as const) {
			assert.ok(missingDebuggerMessage(platform).includes("gdb"))
			assert.ok(missingDebuggerMessage(platform).includes("PATH"))
		}
	})
})
