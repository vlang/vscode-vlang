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
 * V prints one line per test in the Go test format:
 *
 *     --- PASS: test_foo (0.00s)
 *     --- FAIL: test_bar (0.00s)
 *
 * A test that is neither passed nor failed did not run, which is reported rather
 * than silently dropped.
 */
export function parseTestOutput(output: string): TestOutcome[] {
	const outcomes: TestOutcome[] = []
	for (const line of output.split("\n")) {
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
		outcomes.push(outcome)
	}
	return outcomes
}

/** The argument list for `v test` on one file, with an optional name filter.
 *
 * `-nocolor` keeps the output parseable. `VTEST_ONLY_FN` is the filter the Test
 * Explorer's selection maps onto, so it is set from the request rather than
 * hard-coded.
 */
export function testRunArgs(filePath: string, nameFilter?: string): string[] {
	const args = ["-nocolor", "test", filePath]
	if (nameFilter) {
		args.push("-run-only", nameFilter)
	}
	return args
}
