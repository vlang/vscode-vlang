import { execFile } from "child_process"
import * as fs from "fs"
import * as vscode from "vscode"
import { emptyLiteralAt, fillStructBody, structFields } from "./fillStruct"
import { parseByVersion } from "./documentMemo"
import type { CoverageDecorationController } from "./coverageDecoration"
import { canonicalFilePath } from "./coverageProfile"
import {
	allTestsTitle,
	coverageFilterFor,
	ExistingTest,
	planTestGeneration,
	testActionTitle,
} from "./testGeneration"
import { generateTestSkeleton, testFileName } from "./testSkeleton"
import { processLaunchCommand } from "./processExecution"

/** A code action that generates a test skeleton for a V source file.
 *
 * V has no test framework, so the file layout is the whole contract: `foo.v` is
 * tested by `foo_test.v` beside it, and a test file holds only `test_` functions.
 * This action creates that file with one `test_` function per public function in
 * the source, each with a placeholder assertion.
 *
 * The action is offered on `.v` files only, and only when the source has public
 * functions to test. It never overwrites an existing test file.
 */
export class GenerateTestSkeletonAction implements vscode.CodeActionProvider {
	// The range and context parameters are part of the CodeActionProvider interface
	// but are not needed here: the action applies to the whole file, and the
	// decision to offer it does not depend on the diagnostics in context.
	provideCodeActions(document: vscode.TextDocument): vscode.CodeAction[] {
		if (document.languageId !== "v") {
			return []
		}
		const skeleton = parseByVersion(document, generateTestSkeleton)
		if (!skeleton) {
			return []
		}
		const action = new vscode.CodeAction(
			`Generate test file (${skeleton.tests.length} tests)`,
			vscode.CodeActionKind.Refactor,
		)
		action.command = {
			command: "v.generateTestFile",
			title: "Generate Test File",
			arguments: [document.uri],
		}
		return [action]
	}
}

/** What the edit should do to the test file.
 *
 * A file that is not there is created. A file that is has the user asked first,
 * and overwriting it *replaces* its contents: `createFile` asks for an absent
 * file, so it is refused in exactly the case overwriting applies to. The choice
 * is its own function because it is the whole decision, and the path it used to
 * live on was the one place a test could not reach.
 */
export function testFileStrategy(
	exists: boolean,
	overwriteConfirmed: boolean,
): "create" | "replace" | "cancel" {
	if (!exists) {
		return "create"
	}
	return overwriteConfirmed ? "replace" : "cancel"
}

/** The end of a document, as the replacement range needs it.
 *
 * A document of one empty line ends at 0,0, so replacing from there is an insert:
 * the range is empty and nothing of the old file is left. An empty document is
 * reported by the editor as one empty line, which is why the zero case is valid
 * rather than an error.
 */
export function documentEnd(
	lineCount: number,
	lastLineText: string,
): {
	line: number
	character: number
} {
	if (lineCount < 1) {
		return { line: 0, character: 0 }
	}
	return { line: lineCount - 1, character: lastLineText.length }
}

/** A code action that writes the test functions a coverage run says are missing.
 *
 * Where the skeleton above offers one test per public function, this offers only
 * the ones a test run never entered, read from the coverage the V test task
 * recorded. It is therefore not offered until such a task has run.
 */
export class GenerateUntestedTestsAction implements vscode.CodeActionProvider {
	constructor(private readonly coverage: CoverageDecorationController) {}

	provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
		_context: vscode.CodeActionContext,
	): vscode.CodeAction[] {
		if (document.languageId !== "v" || document.uri.scheme !== "file") {
			return []
		}
		const uncovered = this.coverage.uncoveredFunctions(canonicalFilePath(document.uri.fsPath))
		const plan = planTestGeneration(uncovered, readExistingTestSync(document))
		if (plan.kind === "unavailable" || plan.kind === "up-to-date") {
			return []
		}
		const actions: vscode.CodeAction[] = []
		// A selection inside one function offers just that function, so the
		// lightbulb answers the question the cursor asked.
		const selected = plan.functions.filter((fn) =>
			document.lineCount > fn.line ? range.contains(document.lineAt(fn.line).range) : false,
		)
		const offered = selected.length > 0 ? selected : []
		for (const fn of offered) {
			const action = new vscode.CodeAction(
				testActionTitle(fn),
				vscode.CodeActionKind.QuickFix,
			)
			action.command = {
				command: "v.generateTests",
				title: "Generate Test",
				arguments: [document.uri, [fn.name]],
			}
			actions.push(action)
		}
		if (offered.length > 0) {
			const all = new vscode.CodeAction(
				allTestsTitle(plan.functions.length),
				vscode.CodeActionKind.QuickFix,
			)
			all.command = {
				command: "v.generateTests",
				title: "Generate Tests",
				arguments: [document.uri, plan.functions.map((fn) => fn.name)],
			}
			actions.push(all)
		}
		return actions
	}
}

/** The test file beside a document, read synchronously so a code action can
 * decide from it. A file that cannot be read is treated as absent, which the
 * plan then reports as a create. */
function readExistingTestSync(document: vscode.TextDocument): ExistingTest {
	const testPath = testFileName(document.fileName)
	try {
		const content = fs.readFileSync(testPath, "utf8")
		return { testPath, content }
	} catch {
		return { testPath, content: undefined }
	}
}

/** Create the `_test.v` file for a source file.
 *
 * Refuses to discard work the user already wrote by asking first, and replaces
 * the file only when they confirm. The caller is told whether it was written.
 */
export async function generateTestFile(uri: vscode.Uri): Promise<boolean> {
	const source = await vscode.workspace.fs.readFile(uri).then(
		(buffer) => buffer.toString(),
		() => "",
	)
	const skeleton = generateTestSkeleton(source)
	if (!skeleton) {
		void vscode.window.showWarningMessage(
			"No public functions to test in this file. A test skeleton needs at least one.",
		)
		return false
	}

	const testPath = testFileName(uri.fsPath)
	const testUri = vscode.Uri.file(testPath)
	const exists = await vscode.workspace.fs.stat(testUri).then(
		() => true,
		() => false,
	)
	const overwrite = exists
		? await vscode.window.showWarningMessage(
				`${testPath} already exists. Overwrite it?`,
				"Overwrite",
				"Cancel",
			)
		: undefined
	const strategy = testFileStrategy(exists, overwrite === "Overwrite")
	if (strategy === "cancel") {
		return false
	}

	const workspaceEdit = new vscode.WorkspaceEdit()
	if (strategy === "replace") {
		const existing = await vscode.workspace.openTextDocument(testUri)
		const end = documentEnd(existing.lineCount, existing.lineAt(existing.lineCount - 1).text)
		workspaceEdit.replace(
			testUri,
			new vscode.Range(0, 0, end.line, end.character),
			skeleton.content,
		)
	} else {
		workspaceEdit.createFile(testUri)
		workspaceEdit.insert(testUri, new vscode.Position(0, 0), skeleton.content)
	}
	const applied = await vscode.workspace.applyEdit(workspaceEdit)
	if (!applied) {
		void vscode.window.showErrorMessage(`Could not write ${testPath}.`)
		return false
	}
	await vscode.window.showTextDocument(testUri, { preview: false })
	return true
}

/** A code action that fills an empty struct literal from its declaration.
 *
 * Offered on a line holding `Name{}` when `struct Name` is declared in the
 * same file with fillable fields. Only the same file is read: cross-file
 * lookup is the language server's job.
 */
export class FillStructFieldsAction implements vscode.CodeActionProvider {
	// The context parameters are part of the CodeActionProvider interface
	// but are not needed here: the offer depends on the line only.
	provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
		if (document.languageId !== "v") {
			return []
		}
		if (range.start.line < 0 || range.start.line >= document.lineCount) {
			return []
		}
		const literal = emptyLiteralAt(document.lineAt(range.start.line).text)
		if (!literal) {
			return []
		}
		const fields = parseByVersion(document, (source) => structFields(source, literal.name))
		if (!fields || fields.length === 0) {
			return []
		}
		const action = new vscode.CodeAction(
			`Fill struct ${literal.name}`,
			vscode.CodeActionKind.Refactor,
		)
		action.command = {
			command: "v.fillStruct",
			title: "Fill Struct Fields",
			arguments: [document.uri, range.start.line],
		}
		return [action]
	}
}

/** Fill the empty struct literal at a line with its declared fields. */
export async function fillStruct(uri?: vscode.Uri, line?: number): Promise<boolean> {
	const document = uri
		? await vscode.workspace.openTextDocument(uri)
		: vscode.window.activeTextEditor?.document
	if (!document || document.uri.scheme !== "file") {
		void vscode.window.showErrorMessage("No V file to fill a struct in.")
		return false
	}
	const at = line ?? vscode.window.activeTextEditor?.selection.active.line
	if (at === undefined || at < 0 || at >= document.lineCount) {
		return false
	}
	const literal = emptyLiteralAt(document.lineAt(at).text)
	if (!literal) {
		return false
	}
	const fields = structFields(document.getText(), literal.name)
	if (!fields || fields.length === 0) {
		void vscode.window.showErrorMessage(`No fillable fields found for struct ${literal.name}.`)
		return false
	}
	const edit = new vscode.WorkspaceEdit()
	edit.replace(
		document.uri,
		new vscode.Range(at, literal.start, at, literal.end),
		fillStructBody(fields),
	)
	const applied = await vscode.workspace.applyEdit(edit)
	if (!applied) {
		void vscode.window.showErrorMessage("Could not fill the struct.")
		return false
	}
	return true
}

/** Register the test skeleton code action.
/** Ask `v cover` to write the tests `uri` is missing, and open what it wrote.
 *
 * The writing is `v cover --write-tests`, so the generated file is the one the
 * tool writes everywhere else. The extension names the file, runs the tool, and
 * reveals the result; it never composes a test body itself.
 */
async function generateTestsFor(
	uri: vscode.Uri,
	coverage: CoverageDecorationController,
): Promise<boolean> {
	const uncovered = coverage.uncoveredFunctions(canonicalFilePath(uri.fsPath))
	if (uncovered.length === 0) {
		void vscode.window.showWarningMessage(
			"No untested function is recorded for this file. Run the V test task first.",
		)
		return false
	}
	const directory = coverage.coverageRunDirectory()
	const root = coverage.coverageRunRoot()
	if (!directory || !root) {
		void vscode.window.showWarningMessage(
			"No coverage run is available. Run the V test task first.",
		)
		return false
	}
	let output = ""
	try {
		output = await runWriteTests(vCommandFor(uri), directory, uri.fsPath, root)
	} catch (error) {
		void vscode.window.showErrorMessage(`V could not write the tests: ${String(error)}`)
		return false
	}
	void vscode.window.showInformationMessage(output.trim() || "Wrote the missing tests.")
	return revealTestFile(testFileName(uri.fsPath))
}

function runWriteTests(
	command: string,
	coverageDirectory: string,
	sourceFilePath: string,
	workingDirectory: string,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const launch = processLaunchCommand(command, [
			"cover",
			coverageDirectory,
			"--write-tests",
			"--filter",
			coverageFilterFor(sourceFilePath),
			"-P",
			"false",
		])
		execFile(
			launch.command,
			launch.args,
			{
				cwd: workingDirectory,
				maxBuffer: 4 * 1024 * 1024,
				windowsVerbatimArguments: launch.windowsVerbatimArguments,
			},
			(error, stdout, stderr) =>
				error ? reject(new Error(`${error.message}\n${stdout}${stderr}`)) : resolve(stdout),
		)
	})
}

/** Open the test file, so an open buffer is shown rather than bypassed. */
async function revealTestFile(testPath: string): Promise<boolean> {
	const open = vscode.workspace.textDocuments.find((document) => document.uri.fsPath === testPath)
	if (open) {
		await vscode.window.showTextDocument(open, { preview: false })
		return true
	}
	if (!fs.existsSync(testPath)) {
		void vscode.window.showWarningMessage(`V did not write a test file at ${testPath}`)
		return false
	}
	await vscode.window.showTextDocument(vscode.Uri.file(testPath), { preview: false })
	return true
}

/** The V executable a folder's settings name, falling back to PATH. */
function vCommandFor(uri: vscode.Uri): string {
	const folder = vscode.workspace.getWorkspaceFolder(uri)
	return (
		vscode.workspace.getConfiguration("v", folder).get<string>("executablePath") ||
		vscode.workspace.getConfiguration("vls", folder).get<string>("vCommand") ||
		"v"
	)
}

/** Register the test actions.
 *
 * `coverage` is what the coverage-aware action reads; it is the controller the V
 * test task already drives, so no second source of coverage data exists.
 */
export function registerCodeActions(
	context: vscode.ExtensionContext,
	coverage: CoverageDecorationController,
): void {
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			{ language: "v", scheme: "file" },
			new GenerateTestSkeletonAction(),
			{ providedCodeActionKinds: [vscode.CodeActionKind.Refactor] },
		),
		vscode.languages.registerCodeActionsProvider(
			{ language: "v", scheme: "file" },
			new FillStructFieldsAction(),
			{ providedCodeActionKinds: [vscode.CodeActionKind.Refactor] },
		),
		vscode.languages.registerCodeActionsProvider(
			{ language: "v", scheme: "file" },
			new GenerateUntestedTestsAction(coverage),
			{ providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
		),
		vscode.commands.registerCommand("v.generateTestFile", (uri: vscode.Uri) =>
			generateTestFile(uri),
		),
		vscode.commands.registerCommand("v.fillStruct", (uri?: vscode.Uri, line?: number) =>
			fillStruct(uri, line),
		),
		vscode.commands.registerCommand("v.generateTests", (uri: vscode.Uri, _names?: string[]) =>
			generateTestsFor(uri, coverage),
		),
	)
}
