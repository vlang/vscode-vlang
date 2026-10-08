/** Generating a V test skeleton from a source file.
 *
 * Everything here is pure so it can be tested without an editor. The editor
 * wiring lives in `codeActions.ts`.
 *
 * A V test is a `test_`-prefixed function in a `_test.v` file beside the source.
 * `foo.v` is tested by `foo_test.v`. There is no test framework, so the skeleton
 * is the file layout plus one `test_` function per public function, each with a
 * placeholder assertion the user replaces.
 */

const moduleDeclaration = /^module\s+(\w+)/
const publicFunction = /^pub\s+fn\s+(\w+)\s*\(/

export interface TestSkeleton {
	/** The content of the generated `_test.v` file. */
	content: string
	/** The test functions that were generated. */
	tests: string[]
}

/** Generate a test skeleton for a source file.
 *
 * Returns `undefined` when the file has no module declaration or no public
 * functions, because there is nothing to test and an empty test file is worse
 * than no test file.
 */
export function generateTestSkeleton(source: string): TestSkeleton | undefined {
	const module = moduleDeclaration.exec(source)
	if (!module) {
		return undefined
	}
	const tests: string[] = []
	for (const line of source.split("\n")) {
		const match = publicFunction.exec(line)
		if (match) {
			tests.push(match[1])
		}
	}
	if (tests.length === 0) {
		return undefined
	}

	const functions = tests.map((name) => `fn test_${name}() {\n\tassert true\n}`).join("\n\n")
	return {
		content: `module ${module[1]}\n\n${functions}\n`,
		tests: tests.map((name) => `test_${name}`),
	}
}

/** The test file name for a source file.
 *
 * `foo.v` is tested by `foo_test.v` beside it, which is the layout V's own test
 * runner discovers.
 */
export function testFileName(sourceFileName: string): string {
	const dot = sourceFileName.lastIndexOf(".")
	return dot === -1 ? `${sourceFileName}_test.v` : `${sourceFileName.slice(0, dot)}_test.v`
}

/** The source file name for a test file, if it follows the layout.
 *
 * The reverse of `testFileName`: `foo_test.v` is tested-from `foo.v`.
 * Anything else — including a bare `_test.v` with no stem — has no source.
 */
export function sourceFileName(testFile: string): string | undefined {
	const suffix = "_test.v"
	if (!testFile.endsWith(suffix) || testFile.length <= suffix.length) {
		return undefined
	}
	return `${testFile.slice(0, -suffix.length)}.v`
}
