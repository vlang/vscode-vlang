import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import * as vscode from "vscode"

/** Exercise the editor's save formatter and compiler command independently of VLS. */
export async function runIssue523Checks(workspace: string, fakeVls: boolean): Promise<void> {
	const directory = path.join(workspace, "issue523")
	const file = path.join(directory, "format_on_save.v")
	fs.mkdirSync(directory, { recursive: true })
	fs.writeFileSync(file, 'module main\n\nfn issue523_probe(){println("format on save")}\n')
	const document = await vscode.workspace.openTextDocument(file)
	const editor = await vscode.window.showTextDocument(document)
	const settings = vscode.workspace.getConfiguration("v.vls")
	const previousCommand = settings.inspect<string>("command")?.workspaceValue
	const editorSettings = vscode.workspace.getConfiguration("editor", document.uri)
	const previousFormatOnSave =
		editorSettings.inspect<boolean>("formatOnSave")?.workspaceLanguageValue
	const previousFormatter =
		editorSettings.inspect<string>("defaultFormatter")?.workspaceLanguageValue
	try {
		await editorSettings.update(
			"formatOnSave",
			true,
			vscode.ConfigurationTarget.Workspace,
			true,
		)
		await editorSettings.update(
			"defaultFormatter",
			"vlanguage.vscode-vlang",
			vscode.ConfigurationTarget.Workspace,
			true,
		)
		const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
			"vscode.executeFormatDocumentProvider",
			document.uri,
			{ tabSize: 4, insertSpaces: false },
		)
		assert.ok(edits?.length, "VLS must register an editor formatter before saving")
		await editor.edit((edit) => edit.insert(new vscode.Position(2, 0), " "))
		assert.equal(await document.save(), true)
		assert.equal(document.isDirty, false)
		if (fakeVls) {
			assert.ok(
				document.getText().startsWith("MODULE"),
				"save must apply the fixture formatter",
			)
		} else {
			assert.match(
				document.getText(),
				/fn issue523_probe\(\) \{\s+println\('format on save'\)/,
			)
		}
		assert.equal(fs.readFileSync(file, "utf8"), document.getText())
		console.log("Issue #523: editor.formatOnSave passed")

		// A missing executable must leave the compiler command registered and usable.
		await settings.update(
			"command",
			path.join(directory, "missing-vls"),
			vscode.ConfigurationTarget.Workspace,
		)
		await vscode.commands.executeCommand("v.vls.restart")
		assert.ok((await vscode.commands.getCommands(true)).includes("v.fmt"))
		const savedText = fs.readFileSync(file, "utf8")
		await editor.edit((edit) =>
			edit.replace(
				new vscode.Range(
					document.positionAt(0),
					document.positionAt(document.getText().length),
				),
				'module main\n\nfn issue523_probe(){println("without vls")}\n',
			),
		)
		assert.equal(await vscode.commands.executeCommand<boolean>("v.fmt"), true)
		assert.match(document.getText(), /fn issue523_probe\(\) \{\s+println\('without vls'\)/)
		assert.equal(document.isDirty, true)
		assert.equal(fs.readFileSync(file, "utf8"), savedText)
		console.log(
			"Issue #523: v.fmt works with a missing VLS executable and preserves the unsaved buffer",
		)
	} finally {
		await editorSettings.update(
			"formatOnSave",
			previousFormatOnSave,
			vscode.ConfigurationTarget.Workspace,
			true,
		)
		await editorSettings.update(
			"defaultFormatter",
			previousFormatter,
			vscode.ConfigurationTarget.Workspace,
			true,
		)
		await settings.update("command", previousCommand, vscode.ConfigurationTarget.Workspace)
		await vscode.commands.executeCommand("v.vls.restart")
	}
}
