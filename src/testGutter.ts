import * as vscode from "vscode"
import { parseByVersion } from "./documentMemo"
import { runCodeLensCommand, VTaskManager } from "./vTasks"

/** The command id the middleware dispatches to the task path.
 *
 * `vls.runFile` is the run branch of `codeLensTaskSpec`; any other id falls to
 * its test branch, which adds `-run-only <name>`. The middleware list above
 * must carry this id too, or LSP CodeLenses and this gutter disagree.
 */
export const testGutterCommand = "v.testLine"

const testFunctionPattern = /^fn\s+(test_\w+)\s*\(/

/** The lines a test can be started from.
 *
 * V declares a test as a top-level `fn test_...`; an indented one is either a
 * method or commented out, so it is not a runnable test. Scanning the same way
 * the debugger CodeLens scans for `fn main` keeps the two consistent.
 */
export function testFunctionLines(source: string): number[] {
	const lines = source.split("\n")
	const found: number[] = []
	for (let index = 0; index < lines.length; index++) {
		if (testFunctionPattern.test(lines[index] ?? "")) {
			found.push(index)
		}
	}
	return found
}

/** The name of the test declared on `line`, or nothing.
 *
 * The name is what `v test -run-only` takes, so it is read from the declaration
 * rather than derived from the file name.
 */
export function testFunctionNameAtLine(source: string, line: number): string | undefined {
	return testFunctionPattern.exec(source.split("\n")[line] ?? "")?.[1]
}

/** The line of the test enclosing `line`, or -1 when there is none.
 *
 * Tests are top level, so the nearest test line at or above the cursor is
 * normally the one it sits in. The exception is the heading above a
 * declaration: a cursor on a comment or a blank line that runs into the next
 * `fn` belongs to that test, because nothing but its own documentation is
 * between the two. A cursor inside a test body is not in that gap, so it keeps
 * the test it is inside.
 */
export function enclosingTestLine(source: string, line: number): number {
	const lines = source.split("\n")
	const testLines = testFunctionLines(source)
	const above = testLines.filter((testLine) => testLine <= line)
	if (above.length === 0) {
		// With no test at or above, only a cursor on a heading line has a test to
		// name: the module declaration and the blank under it do not.
		const below = testLines.find((testLine) => testLine > line)
		return below !== undefined && isHeading(lines[line]) ? below : -1
	}
	const below = testLines.find((testLine) => testLine > line)
	const candidate = above[above.length - 1]!
	if (below === undefined) {
		return candidate
	}
	for (let index = line + 1; index < below; index += 1) {
		if (!/^\s*(\/\/|$)/.test(lines[index] ?? "")) {
			return candidate
		}
	}
	return below
}

/** Whether a line is a comment heading rather than anything else. */
function isHeading(text: string | undefined): boolean {
	return /^\s*\/\//.test(text ?? "")
}

export interface TestLens {
	line: number
	name: string
}

/** A lens above each test that runs that one test.
 *
 * Registered for the same document selector the V tasks use, so a lens never
 * appears where the task could not run. The parse is memoised per document
 * version because the provider is asked on every edit.
 *
 * The lens command is registered here rather than left to the language client's
 * middleware: a CodeLens runs on the client, so nothing routes it through the
 * server, and a lens without a handler is a lens that silently does nothing.
 */
export function registerTestGutter(
	context: vscode.ExtensionContext,
	taskManager: VTaskManager,
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			testGutterCommand,
			(uri: vscode.Uri | undefined, name: string | undefined) =>
				runCodeLensCommand(testGutterCommand, [uri, name], taskManager),
		),
		vscode.languages.registerCodeLensProvider([{ language: "v" }], {
			provideCodeLenses: (document) => {
				const lenses = parseByVersion(document, editorTestLenses)
				return lenses?.map((lens) => {
					return new vscode.CodeLens(new vscode.Range(lens.line, 0, lens.line, 0), {
						title: `$(testing-run-icon) ${lens.name}`,
						command: testGutterCommand,
						arguments: [document.uri, lens.name],
					})
				})
			},
		}),
	)
}

/** The lenses for a document, or nothing when it holds no test.
 *
 * The same shape contract as the folding provider: answering nothing leaves
 * whatever the language server already put there alone.
 */
function editorTestLenses(source: string): TestLens[] | undefined {
	const lines = source.split("\n")
	const lenses: TestLens[] = []
	for (let line = 0; line < lines.length; line += 1) {
		const name = testFunctionPattern.exec(lines[line] ?? "")?.[1]
		if (name) {
			lenses.push({ line, name })
		}
	}
	return lenses.length === 0 ? undefined : lenses
}
