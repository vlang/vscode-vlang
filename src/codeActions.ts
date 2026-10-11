import * as vscode from "vscode"
import { generateTestSkeleton, testFileName } from "./testSkeleton"

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
		const skeleton = generateTestSkeleton(document.getText())
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
		vscode.commands.registerCommand("v.generateTestFile", (uri: vscode.Uri) =>
			generateTestFile(uri),
		),
	)
}
