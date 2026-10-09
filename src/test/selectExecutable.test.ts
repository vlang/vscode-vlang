import * as assert from "assert"
import { describe, it } from "node:test"
import * as path from "path"
import { browseEntryLabel, executableCandidates } from "../selectExecutable"

/** The picker decides what to offer before a host is involved, so ordering,
 * de-duplication and the empty case are all testable as data.
 */
describe("executable candidates", () => {
	const onPath = path.join("C:", "V", "v.exe")
	const managed = path.join("C:", "Users", "me", "v-1.2.3", "v.exe")

	it("puts the current setting first", () => {
		const candidates = executableCandidates({ configured: onPath, onPath, managed })
		assert.deepStrictEqual(
			candidates.map((candidate) => candidate.value),
			[onPath, managed],
		)
		assert.strictEqual(candidates[0]?.label, "Current setting")
		assert.strictEqual(candidates[0]?.description, "What the extension is using now")
	})

	it("offers what PATH has when nothing is configured", () => {
		const candidates = executableCandidates({ configured: "v", onPath, managed: undefined })
		assert.deepStrictEqual(
			candidates.map((candidate) => candidate.value),
			[onPath],
		)
		assert.strictEqual(candidates[0]?.description, "Found on PATH")
	})

	it("offers the managed build when it is the only one", () => {
		const candidates = executableCandidates({
			configured: "v",
			onPath: undefined,
			managed,
		})
		assert.deepStrictEqual(
			candidates.map((candidate) => candidate.value),
			[managed],
		)
		assert.strictEqual(candidates[0]?.description, "Managed by this extension")
	})

	it("does not list the same path twice", () => {
		// The configured value and the PATH hit are the same file here, which is
		// what `v` resolves to. One entry keeps the list honest about how many
		// compilers there actually are.
		const candidates = executableCandidates({ configured: "v", onPath, managed })
		assert.deepStrictEqual(
			candidates.map((candidate) => candidate.value),
			[onPath, managed],
		)
	})

	it("offers only browsing when there is nothing to choose", () => {
		const candidates = executableCandidates({
			configured: "v",
			onPath: undefined,
			managed: undefined,
		})
		assert.strictEqual(candidates.length, 1)
		assert.strictEqual(candidates[0]?.label, browseEntryLabel)
		// An empty value is the sentinel that opens the file dialog.
		assert.strictEqual(candidates[0]?.value, "")
	})
})
