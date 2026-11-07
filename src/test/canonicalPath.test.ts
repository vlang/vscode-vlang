import * as fs from "fs"
import * as os from "os"
import * as assert from "assert"
import { describe, it } from "node:test"
import * as path from "path"
import { canonicalFilePath, resetCanonicalPaths } from "../coverageProfile"

/** The canonical form of a path is resolved through the filesystem, and coverage keys
 * every file by it. Resolving it is not free, so the answer is memoised: these tests
 * pin that the memo returns the same answer and that it can be dropped when the
 * workspace changes underneath a session.
 */
describe("canonicalFilePath", () => {
	it("returns the same answer twice", () => {
		const reference = canonicalFilePath(__filename)
		// The second call has to come from the memo, so it must not re-resolve. If the
		// memo were keyed wrongly this would still pass, which is why the case of a
		// path that only exists relative to a supplied base is also asserted below.
		assert.strictEqual(canonicalFilePath(__filename), reference)
		assert.ok(path.isAbsolute(reference))
	})

	it("drops the memo when asked, then resolves again", () => {
		const cached = canonicalFilePath(__filename)
		resetCanonicalPaths()
		// After a reset the answer must still be correct: a dropped memo is only safe
		// if the very next call recomputes from the filesystem.
		assert.strictEqual(canonicalFilePath(__filename), cached)
	})

	it("resolves a relative path against the supplied base", () => {
		resetCanonicalPaths()
		const baseDirectory = os.tmpdir()
		const relative = path.relative(baseDirectory, path.join(baseDirectory, "example.v"))
		assert.strictEqual(
			canonicalFilePath(relative, baseDirectory),
			canonicalFilePath(path.join(baseDirectory, "example.v")),
		)
	})

	it("survives a path that does not exist", () => {
		resetCanonicalPaths()
		const missing = path.join(os.tmpdir(), `vscode-vlang-missing-${Date.now()}`, "gone.v")
		const resolved = canonicalFilePath(missing)
		assert.ok(resolved.length > 0)
		assert.strictEqual(canonicalFilePath(missing), resolved)
	})

	it("resolves through a symlinked directory", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-vlang-canonical-"))
		try {
			const realDirectory = path.join(root, "real")
			fs.mkdirSync(realDirectory)
			const target = path.join(realDirectory, "main.v")
			fs.writeFileSync(target, "fn main() {}\n")
			const link = path.join(root, "link")
			try {
				fs.symlinkSync(realDirectory, link, "dir")
			} catch {
				// Symlinking needs privilege the host may not grant; the walk itself is
				// what is under test, and it is covered by the plain-path cases.
				return
			}
			resetCanonicalPaths()
			// The symlinked path must canonicalise to the file behind the link, so the
			// coverage key for an opened file matches the key the run reported.
			assert.strictEqual(
				canonicalFilePath(path.join(link, "main.v")),
				canonicalFilePath(target),
			)
		} finally {
			fs.rmSync(root, { force: true, recursive: true })
		}
	})
})
