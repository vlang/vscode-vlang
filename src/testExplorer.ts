import { execFile as _execFile } from "child_process"
import { promisify } from "util"
import * as path from "path"
import * as vscode from "vscode"
import { parseTestFile, parseTestOutput, testRunArgs, VTest } from "./testDiscovery"
import { vCommandFor } from "./vExecutable"

const execFile = promisify(_execFile)

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
	 * tracking which file changed into which item.
	 */
	async refresh(): Promise<void> {
		const files = await vscode.workspace.findFiles("**/*_test.v", "**/node_modules/**")
		const seen = new Set<string>()
		for (const file of files) {
			const filePath = file.fsPath
			seen.add(filePath)
			const content = await vscode.workspace.fs.readFile(file).then(
				(buffer) => buffer.toString(),
				() => "",
			)
			const tests = parseTestFile(content)
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
		// a stale entry behind.
		for (const [id] of this.items) {
			if (id.startsWith(filePrefix) && !seen.has(id.slice(filePrefix.length))) {
				this.controller.items.delete(id)
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
			return existing
		}
		const item = this.controller.createTestItem(id, test.name, parent.uri)
		item.range = new vscode.Range(test.line - 1, 0, test.line - 1, 0)
		this.items.set(id, item)
		return item
	}

	/** Run the selected tests.
	 *
	 * A test runs `v test` on its own file with `VTEST_ONLY_FN` set to its name, so
	 * the filter the Test Explorer already provides is the one V understands. A file
	 * with no selection runs every test in it.
	 */
	private async runTests(
		request: vscode.TestRunRequest,
		token: vscode.CancellationToken,
	): Promise<void> {
		const run = this.controller.createTestRun(request)
		const selected = request.include ?? [...this.controller.items].map(([, item]) => item)
		const byFile = new Map<string, vscode.TestItem[]>()
		for (const item of selected) {
			const filePath = item.uri?.fsPath
			if (!filePath) {
				continue
			}
			const list = byFile.get(filePath) ?? []
			list.push(item)
			byFile.set(filePath, list)
		}

		for (const [filePath, items] of byFile) {
			if (token.isCancellationRequested) {
				break
			}
			const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))
			const vCommand = folder ? vCommandFor(folder) : "v"
			const names = items.map((item) => item.label).filter((label) => label !== undefined)
			const args = testRunArgs(filePath, names.length === 1 ? names[0] : undefined)

			for (const item of items) {
				run.started(item)
			}
			try {
				const { stdout, stderr } = await execFile(vCommand, args, {
					cwd: folder?.uri.fsPath,
					timeout: runTimeoutMs,
				})
				const outcomes = parseTestOutput(`${stdout}\n${stderr}`)
				const byName = new Map(outcomes.map((outcome) => [outcome.name, outcome]))
				for (const item of items) {
					const outcome = byName.get(item.label)
					if (!outcome) {
						// Not in the output means it did not run, which is a different
						// problem from running and failing.
						run.errored(item, new vscode.TestMessage("This test did not run."))
						continue
					}
					if (outcome.passed) {
						run.passed(item)
					} else {
						run.failed(item, new vscode.TestMessage(outcome.message ?? "Failed"))
					}
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : "The test run failed."
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
