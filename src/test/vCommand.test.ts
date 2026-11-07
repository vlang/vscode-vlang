import * as fs from "fs"
import * as os from "os"
import * as assert from "assert"
import { describe, it, afterEach } from "node:test"
import * as path from "path"
import { findInPath, resetPathLookupCache } from "../vCommand"

/** PATH is scanned a stat at a time, and the same binaries are resolved again for
 * every task refresh. The memo returns the same hit, drops when PATH changes, and
 * never caches a miss so a tool installed mid-session is still found. */
describe("findInPath", () => {
	const originalPath = process.env.PATH || ""

	afterEach(() => {
		process.env.PATH = originalPath
		resetPathLookupCache()
	})

	function withPath(run: () => void): void {
		resetPathLookupCache()
		run()
	}

	it("finds an executable on PATH", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-vlang-path-"))
		try {
			fs.writeFileSync(path.join(root, "vbin"), "#!/bin/sh\n")
			fs.chmodSync(path.join(root, "vbin"), 0o755)
			withPath(() => {
				process.env.PATH = root
				assert.strictEqual(findInPath("vbin"), path.join(root, "vbin"))
			})
		} finally {
			fs.rmSync(root, { force: true, recursive: true })
		}
	})

	it("returns nothing when it is not there", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-vlang-path-"))
		try {
			withPath(() => {
				process.env.PATH = root
				assert.strictEqual(findInPath("v-does-not-exist"), undefined)
			})
		} finally {
			fs.rmSync(root, { force: true, recursive: true })
		}
	})

	it("cannot answer a changed PATH from a stale hit", () => {
		const first = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-vlang-path-"))
		const second = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-vlang-path-"))
		try {
			for (const root of [first, second]) {
				fs.writeFileSync(path.join(root, "vbin"), "#!/bin/sh\n")
				fs.chmodSync(path.join(root, "vbin"), 0o755)
			}
			resetPathLookupCache()
			process.env.PATH = first
			assert.strictEqual(findInPath("vbin"), path.join(first, "vbin"))
			// A tool that moved must not resolve to where it used to be: the key
			// carries PATH, so the second lookup cannot hit the first entry.
			process.env.PATH = second
			assert.strictEqual(findInPath("vbin"), path.join(second, "vbin"))
		} finally {
			fs.rmSync(first, { force: true, recursive: true })
			fs.rmSync(second, { force: true, recursive: true })
		}
	})

	it("finds a tool that appears after a miss", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-vlang-path-"))
		try {
			process.env.PATH = root
			resetPathLookupCache()
			assert.strictEqual(findInPath("vbin"), undefined)
			// Installing the tool into the same PATH is the case a cached miss would
			// break, which is why misses are not kept.
			fs.writeFileSync(path.join(root, "vbin"), "#!/bin/sh\n")
			fs.chmodSync(path.join(root, "vbin"), 0o755)
			assert.strictEqual(findInPath("vbin"), path.join(root, "vbin"))
		} finally {
			process.env.PATH = originalPath
			fs.rmSync(root, { force: true, recursive: true })
		}
	})
})
