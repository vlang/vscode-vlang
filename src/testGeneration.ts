import { canonicalFilePath } from "./coverageProfile"

/** A function a test run never entered, with where it is declared. */
export interface UntestedFunction {
	name: string
	/** 0-based line of the declaration, as an editor addresses it. */
	line: number
}

/** The test file beside a source, with what it already holds.
 *
 * `content` is `undefined` when the file does not exist, which is what decides
 * between creating it and appending to it.
 */
export interface ExistingTest {
	testPath: string
	content: string | undefined
}

/** What a code action would do, computed before anything is written.
 *
 * `unavailable` covers both "nothing is untested" and "the untested functions
 * all have a test already": in both cases the action has nothing to do, so a
 * caller offers nothing rather than an action that opens a dialog.
 */
export type TestGenerationPlan =
	| { kind: "create"; functions: UntestedFunction[]; test: ExistingTest }
	| { kind: "append"; functions: UntestedFunction[]; test: ExistingTest }
	| { kind: "up-to-date"; test: ExistingTest }
	| { kind: "unavailable"; reason: string }

/** The plan for generating the tests a file is missing.
 *
 * Written as a pure function of its inputs so the whole decision — which file,
 * which functions, create or append — is testable without an editor.
 */
export function planTestGeneration(
	uncovered: UntestedFunction[],
	test: ExistingTest,
	existingNames?: Set<string>,
): TestGenerationPlan {
	const already =
		existingNames ?? new Set(test.content === undefined ? [] : testFunctionNames(test.content))
	const missing = uncovered.filter((fn) => !already.has(fn.name))
	if (missing.length === 0) {
		if (uncovered.length === 0) {
			return { kind: "unavailable", reason: "no untested function is recorded" }
		}
		return { kind: "up-to-date", test }
	}
	return {
		kind: test.content === undefined ? "create" : "append",
		functions: missing,
		test,
	}
}

/** The `test_` function names a test file already defines.
 *
 * Read line by line rather than parsed: a test file that does not compile still
 * has to be seen, or a generator would duplicate its functions.
 */
export function testFunctionNames(testContent: string): Set<string> {
	const names = new Set<string>()
	for (const line of testContent.split("\n")) {
		const trimmed = line.trimStart()
		if (!trimmed.startsWith("fn test_")) {
			continue
		}
		const name = trimmed.slice("fn test_".length).split("(")[0]?.trim()
		if (name) {
			names.add(name)
		}
	}
	return names
}

/** The path `v cover --filter` needs: the absolute path of the source file,
 * which no other file's path contains. */
export function coverageFilterFor(sourceFilePath: string): string {
	return canonicalFilePath(sourceFilePath)
}

/** How a code action for one function is worded. */
export function testActionTitle(fn: UntestedFunction): string {
	return `Generate test for '${fn.name}'`
}

/** How the action for the whole file is worded. */
export function allTestsTitle(count: number): string {
	return count === 1
		? "Generate 1 untested test function"
		: `Generate ${count} untested test functions`
}
