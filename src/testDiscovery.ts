/** Discovering V tests and reading what a run reported.
 *
 * Everything here is pure so it can be tested without a workspace or a compiler.
 * The editor wiring lives in `testExplorer.ts`.
 *
 * A V test is a `test_`-prefixed function in a `_test.v` file. There is no test
 * framework and no test object, so the file layout is the whole contract: `foo.v`
 * is tested by `foo_test.v` beside it, and a test file holds only `test_`
 * functions, imports and helpers.
 */

/** Matches a top-level `fn test_name(` declaration.
 *
 * Anchored to the start of a line so a `test_` identifier inside a string or a
 * comment is not mistaken for a test. V has no nested function declarations, so
 * every test is at column zero.
 */
const testFunction = /^fn\s+(test_[A-Za-z0-9_]+)\s*\(/gm

export interface VTest {
	name: string
	/** Line the declaration starts on, 1-based. */
	line: number
}

/** The tests declared in one `_test.v` file.
 *
 * Returns an empty array when the file has no tests, which is not an error: a test
 * file can hold only helpers.
 */
export function parseTestFile(content: string): VTest[] {
	const tests: VTest[] = []
	for (const match of content.matchAll(testFunction)) {
		const line = content.slice(0, match.index).split("\n").length
		tests.push({ name: match[1]!, line })
	}
	return tests
}

/** The glob `VTEST_ONLY` takes, as a path fragment.
 *
 * `VTEST_ONLY='http' v test dir/` runs every test under a path containing `http`.
 * The Test Explorer already models this as `TestRunRequest.include`, so the two
 * map directly.
 */
export function testPathFilter(pattern: string): string {
	return pattern.trim()
}

/** The glob `VTEST_ONLY_FN` takes, as a function name pattern.
 *
 * `VTEST_ONLY_FN='test_login*' v test dir/` runs tests whose name matches. The
 * Test Explorer passes the selected item's id, which is the function name here.
 */
export function testNameFilter(pattern: string): string {
	return pattern.trim()
}

export interface TestOutcome {
	name: string
	passed: boolean
	/** The failure message, when the test failed. */
	message?: string
}

/** Read the outcomes a `v test` run printed.
 *
 * V 0.5.2 prints one line per test only with `-stats`, in this form (measured
 * with a real `v -nocolor -stats test` run, which is what `testRunArgs` passes):
 *
 *         OK    [1/3]     0.000 ms     1 assert | main.test_one()
 *         FAIL  [2/3]     0.000 ms     1 assert | main.test_two()
 *
 * The name carries its module prefix, which is stripped. A failing test is
 * followed by a detail block the failure headers name:
 *
 *     C:/proj/foo_test.v:2: fn test_two
 *         assert false, 'boom'
 *             Message: boom
 *
 * Without `-stats` there is only a file-level line (`v : OK ... path`) plus
 * the same `path:line: fn test_name` failure headers, so those headers are
 * also read as failed outcomes. A test that is neither passed nor failed did
 * not run, which is reported rather than silently dropped.
 *
 * The Go test format (`--- PASS: name`) is kept as a fallback for output that
 * predates this parser; V itself does not print it.
 */
export function parseTestOutput(output: string): TestOutcome[] {
	const byName = new Map<string, TestOutcome>()
	for (const line of output.split("\n")) {
		const stats =
			/^\s*(OK|FAIL)\s+\[\d+\s*\/\s*\d+\][^|]*\|\s*([A-Za-z0-9_.]+?)\s*\(\)\s*$/.exec(line)
		if (stats) {
			const qualified = stats[2]!
			const name = qualified.includes(".")
				? qualified.slice(qualified.lastIndexOf(".") + 1)
				: qualified
			if (!name.startsWith("test_")) {
				continue
			}
			const outcome: TestOutcome = {
				name,
				passed: stats[1] === "OK",
			}
			// Only a failure carries a message, so a pass does not get an empty one.
			// A `path:line: fn test_name` detail block below replaces this with the
			// assert that actually failed.
			if (!outcome.passed) {
				outcome.message = line.trim()
			}
			byName.set(name, outcome)
			continue
		}
		const match = /^\s*---\s+(PASS|FAIL|SKIP):\s+(\S+)/.exec(line)
		if (!match) {
			continue
		}
		const outcome: TestOutcome = {
			name: match[2]!,
			passed: match[1] === "PASS",
		}
		// Only a failure carries a message, so a pass does not get an empty one.
		if (match[1] === "FAIL") {
			outcome.message = line.trim()
		}
		byName.set(match[2]!, outcome)
	}
	for (const [name, message] of failureDetails(output)) {
		const existing = byName.get(name)
		if (existing) {
			if (!existing.passed) {
				existing.message = message
			}
			continue
		}
		byName.set(name, { name, passed: false, message })
	}
	return [...byName.values()]
}

/** The `path:line: fn test_name` failure blocks a run printed, keyed by test.
 *
 * Each block is the header plus the indented assert lines under it, which is
 * the failure message a failing test is reported with. Compiler errors
 * (`path:line:col: error:`) never match: they carry two numbers, not `fn`.
 */
function failureDetails(output: string): Map<string, string> {
	const details = new Map<string, string>()
	const lines = output.split("\n")
	for (let index = 0; index < lines.length; index++) {
		const header = /^.+:\d+:\s*fn\s+(test_[A-Za-z0-9_]+)\s*$/.exec(lines[index]!)
		if (!header) {
			continue
		}
		const block = [lines[index]!.trim()]
		for (let next = index + 1; next < lines.length; next++) {
			const body = lines[next]!
			if (body.trim() === "") {
				break
			}
			if (/^.+:\d+:\s*fn\s+test_/.test(body)) {
				break
			}
			const trimmed = body.trim()
			if (
				trimmed.startsWith("To reproduce") ||
				trimmed.startsWith("Summary for") ||
				/^-{3,}$/.test(trimmed) ||
				/^\s*(OK|FAIL)\s+(\[|[\d.]+\s*ms)/.test(body) ||
				/^\s*v\s*:\s*(OK|FAIL|-|running|Compiler)/.test(body) ||
				/^\s*---\s+(PASS|FAIL|SKIP):/.test(body)
			) {
				break
			}
			if (!/^\s/.test(body)) {
				break
			}
			block.push(trimmed)
		}
		details.set(header[1]!, block.join("\n"))
	}
	return details
}

/** Whether a `v test` run passed or failed at the file level. */
export type TestFileStatus = "passed" | "failed"

/** Read the file-level status a `v test` run printed.
 *
 * With `-stats` a run prints `v : OK <ms> <path>` for the first file and
 * `OK [n/m] <ms> <path>` for the rest; without it every file prints the
 * `v :` form. Either form is file-level, never per-test: the per-test
 * `-stats` lines carry a `|` before the test name, which file lines never do
 * (a `|` cannot appear in a Windows path). Any failure wins, so a mixed
 * multi-file run still reports `failed`.
 */
export function parseTestFileStatus(output: string): TestFileStatus | undefined {
	let status: TestFileStatus | undefined
	for (const line of output.split("\n")) {
		const match = /^\s*(?:v\s*:)?\s*(OK|FAIL)\s+(?:\[\d+\s*\/\s*\d+\]|[\d.]+\s*ms)/.exec(line)
		if (!match || line.includes("|")) {
			continue
		}
		if (match[1] === "FAIL") {
			return "failed"
		}
		status = "passed"
	}
	return status
}

/** The argument list for `v test` on one file, with an optional name filter.
 *
 * `-nocolor` keeps the output parseable. `-stats` prints one line per test
 * (`OK [i/n] ... | module.test_name()`); without it V prints only a file-level
 * `v : OK/FAIL` line, which cannot be mapped back to the selected tests.
 * `-run-only` is the filter the Test Explorer's selection maps onto, so it is
 * set from the request rather than hard-coded.
 */
export function testRunArgs(filePath: string, nameFilter?: string): string[] {
	const args = ["-nocolor", "-stats", "test", filePath]
	if (nameFilter) {
		args.push("-run-only", nameFilter)
	}
	return args
}

/** One selected test run, addressed the way the Test Explorer addresses it.
 *
 * `filePath` is the `_test.v` file; an absent `name` means the whole file.
 */
export interface TestSelection {
	filePath: string
	name?: string
}

/** Read a Test Explorer selection back from a test item id.
 *
 * Ids are built by the explorer as `file:<path>` and `test:<path>::<name>`,
 * so the label — a display name — is never the filter. Returns `undefined`
 * for ids the explorer did not build.
 */
export function selectionForItemId(id: string): TestSelection | undefined {
	if (id.startsWith("file:")) {
		const filePath = id.slice("file:".length)
		return filePath ? { filePath } : undefined
	}
	if (id.startsWith("test:")) {
		const rest = id.slice("test:".length)
		const separator = rest.lastIndexOf("::")
		if (separator < 0) {
			return undefined
		}
		const filePath = rest.slice(0, separator)
		const name = rest.slice(separator + 2)
		return filePath && name ? { filePath, name } : undefined
	}
	return undefined
}
