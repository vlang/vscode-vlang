import * as path from "path"
import * as vscode from "vscode"
import {
	parseTestFile,
	parseTestFileStatus,
	parseTestOutput,
	selectionForItemId,
	testRunArgs,
	VTest,
} from "./testDiscovery"
import { runTestProcess } from "./testProcess"
import { vCommandForProgram } from "./vExecutable"

/** How long to wait for a `v test` run before giving it up. */
const runTimeoutMs = 120_000

/** The id prefix for a test item, so a file and its tests are told apart. */
const filePrefix = "file:"
const testPrefix = "test:"

function testItemId(filePath: string, test: VTest): string {
	return `${testPrefix}${filePath}::${test.name}`
}

function fileItemId(filePath: string): string {
	return `${filePrefix}${filePath}`
}

/** The V tests in a workspace, shown in the Test Explorer.
 *
 * A test is a `test_`-prefixed function in a `_test.v` file. There is no test
 * framework, so the file layout is the whole contract and the discovery is a
 * search for `_test.v` files plus a read of each one.
 *
 * Running a test executes `v test` on its file with `VTEST_ONLY_FN` set to the
 * selected function, which is the filter the Test Explorer's selection already
 * models.
 */
export class VTestExplorer implements vscode.Disposable {
	private readonly controller: vscode.TestController
	private readonly items = new Map<string, vscode.TestItem>()
	private readonly disposables: vscode.Disposable[] = []
	private refreshPending: Promise<void> = Promise.resolve()

	constructor() {
		this.controller = vscode.tests.createTestController("v", "V")
		this.controller.createRunProfile(
			"Run",
			vscode.TestRunProfileKind.Run,
			(request, token) => void this.runTests(request, token),
		)
		this.disposables.push(this.controller)
		this.disposables.push(
			vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh()),
			vscode.workspace.onDidCreateFiles(() => void this.refresh()),
			vscode.workspace.onDidDeleteFiles(() => void this.refresh()),
			vscode.workspace.onDidSaveTextDocument((document) => {
				if (document.fileName.endsWith("_test.v")) {
					void this.refresh()
				}
			}),
		)
	}

	/** Rebuild the tree from the files on disk.
	 *
	 * Cheap enough to run on every save, and it keeps the tree honest without
	 * tracking which file changed into which item. Refreshes are serialized so
	 * two saves in a row cannot interleave a rebuild with itself.
	 */
	refresh(): Promise<void> {
		const next = this.refreshPending.then(() => this.refreshNow())
		this.refreshPending = next.catch(() => undefined)
		return next
	}

	private async refreshNow(): Promise<void> {
		const files = await vscode.workspace.findFiles("**/*_test.v", "**/node_modules/**")
		const seen = new Set<string>()
		const seenTests = new Set<string>()
		for (const file of files) {
			const filePath = file.fsPath
			seen.add(filePath)
			const content = await vscode.workspace.fs.readFile(file).then(
				(buffer) => buffer.toString(),
				() => "",
			)
			const tests = parseTestFile(content)
			for (const test of tests) {
				seenTests.add(testItemId(filePath, test))
			}
			const fileItem = this.fileItem(filePath, file)
			const existing = this.items.get(fileItemId(filePath))
			if (existing) {
				existing.children.replace(
					tests.map((test) => this.testItem(filePath, test, fileItem)),
				)
			} else {
				fileItem.children.replace(
					tests.map((test) => this.testItem(filePath, test, fileItem)),
				)
				this.controller.items.add(fileItem)
			}
		}
		// Drop items for files that are gone, so a deleted test file does not leave
		// a stale entry behind. Test items are pruned the same way: replacing a
		// file's children orphans the removed ones in this map.
		for (const [id] of this.items) {
			if (id.startsWith(filePrefix)) {
				if (!seen.has(id.slice(filePrefix.length))) {
					this.controller.items.delete(id)
					this.items.delete(id)
				}
			} else if (id.startsWith(testPrefix) && !seenTests.has(id)) {
				const rest = id.slice(testPrefix.length)
				const separator = rest.lastIndexOf("::")
				const parent = this.items.get(
					`${filePrefix}${separator < 0 ? "" : rest.slice(0, separator)}`,
				)
				parent?.children.delete(id)
				this.items.delete(id)
			}
		}
	}

	private fileItem(filePath: string, file: vscode.Uri): vscode.TestItem {
		const id = fileItemId(filePath)
		const existing = this.items.get(id)
		if (existing) {
			return existing
		}
		const item = this.controller.createTestItem(id, path.basename(filePath), file)
		this.items.set(id, item)
		return item
	}

	private testItem(filePath: string, test: VTest, parent: vscode.TestItem): vscode.TestItem {
		const id = testItemId(filePath, test)
		const existing = this.items.get(id)
		if (existing) {
			// The test moved since the item was created: the range is what the
			// editor jumps to, so it follows the declaration, not the old line.
			existing.range = new vscode.Range(test.line - 1, 0, test.line - 1, 0)
			return existing
		}
		const item = this.controller.createTestItem(id, test.name, parent.uri)
		item.range = new vscode.Range(test.line - 1, 0, test.line - 1, 0)
		this.items.set(id, item)
		return item
	}

	/** Mark the items of one file run from what the run printed.
	 *
	 * A `v test` run exits non-zero when a test fails, so this runs on both the
	 * success output and the output carried by the `execFile` rejection: a
	 * failed run still names its passed and failed tests. Only when the output
	 * holds neither outcomes nor a file-level status — a compile error, a
	 * timeout, a missing compiler — are the items errored with the reason.
	 */
	private reportFileResults(
		run: vscode.TestRun,
		items: vscode.TestItem[],
		output: string,
		errorMessage?: string,
	): void {
		const outcomes = parseTestOutput(output)
		const status = parseTestFileStatus(output)
		const byName = new Map(outcomes.map((outcome) => [outcome.name, outcome]))
		const failed = outcomes.some((outcome) => !outcome.passed)
		for (const item of items) {
			const testName = selectionForItemId(item.id)?.name
			if (testName === undefined) {
				// A file item aggregates the run: it passes only when something
				// ran and nothing failed.
				if (outcomes.length > 0) {
					if (failed) {
						run.failed(item, new vscode.TestMessage("One or more tests failed."))
					} else {
						run.passed(item)
					}
				} else if (status === "passed") {
					run.passed(item)
				} else {
					run.errored(
						item,
						new vscode.TestMessage(errorMessage ?? "This test did not run."),
					)
				}
				continue
			}
			const outcome = byName.get(testName)
			if (outcome) {
				if (outcome.passed) {
					run.passed(item)
				} else {
					run.failed(item, new vscode.TestMessage(outcome.message ?? "Failed"))
				}
			} else if (status === "passed") {
				// A file-level OK means every test in it passed. With `-stats`
				// each one is named above, so reaching here means the output
				// predates that flag.
				run.passed(item)
			} else {
				// Not in the output means it did not run, which is a different
				// problem from running and failing.
				run.errored(item, new vscode.TestMessage(errorMessage ?? "This test did not run."))
			}
		}
	}

	/** Run the selected tests.
	 *
	 * A test runs `v test` on its own file with `-run-only` set to its name, so
	 * the filter the Test Explorer already provides is the one V understands. A
	 * file item runs every test in it. Selection is read from the item ids
	 * rather than the labels: a label is a display name, while the id says
	 * whether the item is a file or one test inside it.
	 */
	private async runTests(
		request: vscode.TestRunRequest,
		token: vscode.CancellationToken,
	): Promise<void> {
		const run = this.controller.createTestRun(request)
		const selected = request.include ?? [...this.controller.items].map(([, item]) => item)
		const byFile = new Map<string, { wholeFile: boolean; names: Set<string> }>()
		for (const item of selected) {
			const selection = selectionForItemId(item.id)
			if (!selection) {
				continue
			}
			const entry = byFile.get(selection.filePath) ?? { wholeFile: false, names: new Set() }
			if (selection.name === undefined) {
				entry.wholeFile = true
			} else {
				entry.names.add(selection.name)
			}
			byFile.set(selection.filePath, entry)
		}

		for (const [filePath, selection] of byFile) {
			if (token.isCancellationRequested) {
				break
			}
			const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))
			const vCommand = vCommandForProgram(filePath, folder)
			// One name filters to that test; anything else runs the file, and the
			// outcomes below report only the tests that were asked for.
			const nameFilter =
				!selection.wholeFile && selection.names.size === 1
					? [...selection.names][0]
					: undefined
			const args = testRunArgs(filePath, nameFilter)
			const items = selected.filter(
				(item) => selectionForItemId(item.id)?.filePath === filePath,
			)

			for (const item of items) {
				run.started(item)
			}
			const result = await runTestProcess(
				vCommand,
				args,
				folder?.uri.fsPath,
				runTimeoutMs,
				token,
			)
			if (result.cancelled || token.isCancellationRequested) {
				for (const item of items) {
					run.skipped(item)
				}
				break
			}
			const output = `${result.stdout}\n${result.stderr}`
			if (
				result.code === 0 ||
				parseTestOutput(output).length > 0 ||
				parseTestFileStatus(output) !== undefined
			) {
				// A failing run still names its tests; only the items with no
				// outcome take the failure message, which names the timeout
				// when the run never finished.
				this.reportFileResults(
					run,
					items,
					output,
					result.timedOut
						? `The test run timed out after ${runTimeoutMs / 1000} seconds.`
						: undefined,
				)
			} else {
				const message = result.timedOut
					? `The test run timed out after ${runTimeoutMs / 1000} seconds.`
					: result.code === null
						? "Could not start the test process."
						: `The test run failed (exit code ${result.code}).`
				for (const item of items) {
					run.errored(item, new vscode.TestMessage(message))
				}
			}
		}
		run.end()
	}

	dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose()
		}
		this.items.clear()
	}
}

/** Register the V test explorer.
 *
 * Discovery is asynchronous and best-effort: a workspace with no `_test.v` files
 * simply shows an empty tree, and a file that cannot be read is skipped rather than
 * failing activation.
 */
export function registerTestExplorer(context: vscode.ExtensionContext): void {
	const explorer = new VTestExplorer()
	context.subscriptions.push(explorer)
	void explorer.refresh()
}
