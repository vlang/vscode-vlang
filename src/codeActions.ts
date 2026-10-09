import * as vscode from "vscode"
import { emptyLiteralAt, fillStructBody, structFields } from "./fillStruct"
import { parseByVersion } from "./documentMemo"
import { generateTestSkeleton, sourceFileName, testFileName } from "./testSkeleton"

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

/** Create the `_test.v` file for a source file.
 *
 * Refuses to overwrite an existing test file, because that would discard work the
 * user already wrote. The caller is told whether the file was created.
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
	if (exists) {
		const overwrite = await vscode.window.showWarningMessage(
			`${testPath} already exists. Overwrite it?`,
			"Overwrite",
			"Cancel",
		)
		if (overwrite !== "Overwrite") {
			return false
		}
	}

	const workspaceEdit = new vscode.WorkspaceEdit()
	workspaceEdit.createFile(testUri, { ignoreIfExists: false })
	workspaceEdit.insert(testUri, new vscode.Position(0, 0), skeleton.content)
	const applied = await vscode.workspace.applyEdit(workspaceEdit)
	if (!applied) {
		void vscode.window.showErrorMessage(`Could not create ${testPath}.`)
		return false
	}
	await vscode.window.showTextDocument(testUri, { preview: false })
	return true
}

/** Open the test file for a source file, or the source for a test file.
 *
 * From a source file with no test file yet, this generates one rather than
 * opening an empty editor. From a test file whose source is gone, it says
 * so instead of opening nothing.
 */
export async function toggleTestFile(uri?: vscode.Uri): Promise<void> {
	const target = uri ?? vscode.window.activeTextEditor?.document.uri
	if (!target || target.scheme !== "file") {
		void vscode.window.showErrorMessage("No V file to toggle from.")
		return
	}
	const source = sourceFileName(target.fsPath)
	if (source !== undefined) {
		const sourceUri = vscode.Uri.file(source)
		const exists = await vscode.workspace.fs.stat(sourceUri).then(
			() => true,
			() => false,
		)
		if (!exists) {
			void vscode.window.showErrorMessage(`Source file not found: ${source}.`)
			return
		}
		await vscode.window.showTextDocument(sourceUri, { preview: false })
		return
	}
	const generated = await generateTestFile(target)
	if (!generated) {
		const testUri = vscode.Uri.file(testFileName(target.fsPath))
		const exists = await vscode.workspace.fs.stat(testUri).then(
			() => true,
			() => false,
		)
		if (exists) {
			await vscode.window.showTextDocument(testUri, { preview: false })
		}
	}
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
 *
 * The command is registered separately from the provider so it can be bound to a
 * key, and the provider is what offers it in the CodeLens and context menu.
 */
export function registerCodeActions(context: vscode.ExtensionContext): void {
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
		vscode.commands.registerCommand("v.generateTestFile", (uri: vscode.Uri) =>
			generateTestFile(uri),
		),
		vscode.commands.registerCommand("v.fillStruct", (uri?: vscode.Uri, line?: number) =>
			fillStruct(uri, line),
		),
		vscode.commands.registerCommand("v.toggleTestFile", (uri?: vscode.Uri) =>
			toggleTestFile(uri),
		),
	)
}
