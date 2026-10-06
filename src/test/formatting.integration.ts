import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import * as vscode from "vscode"

/** Run against the real compiler, including when the language server is a fixture. */
export async function runFormattingRegressionTests(workspace: string): Promise<void> {
	const previous = vscode.window.activeTextEditor
	const directory = fs.mkdtempSync(path.join(workspace, "format-context-"))
	const documents: vscode.TextDocument[] = []
	const open = async (name: string, source: string) => {
		const file = path.join(directory, name)
		fs.mkdirSync(path.dirname(file), { recursive: true })
		fs.writeFileSync(file, source)
		const document = await vscode.workspace.openTextDocument(file)
		documents.push(document)
		const editor = await vscode.window.showTextDocument(document)
		return { document, editor, file }
	}
	try {
		fs.writeFileSync(path.join(directory, "v.mod"), "Module { name: 'format_context' }\n")
		fs.mkdirSync(path.join(directory, "src", "json"), { recursive: true })
		fs.writeFileSync(
			path.join(directory, "src", "json", "json.v"),
			"module json\n\npub fn encode(value int) string { return value.str() }\n",
		)
		const saved = "module main\n\nimport json\n\nfn main() { println(json.encode(1)) }\n"
		const snapshot = saved.replace("encode(1)", "encode(42)")
		const { document, editor, file } = await open("src/main.v", saved)
		await editor.edit((edit) =>
			edit.replace(
				new vscode.Range(document.positionAt(0), document.positionAt(saved.length)),
				snapshot,
			),
		)
		assert.equal(await vscode.commands.executeCommand<boolean>("v.fmt"), true)
		assert.match(document.getText(), /import json\b/)
		assert.match(document.getText(), /json\.encode\(42\)/)
		assert.doesNotMatch(document.getText(), /json2/)
		assert.ok(document.getText().endsWith("\n"), "formatter must preserve its trailing newline")
		assert.equal(document.isDirty, true)
		assert.equal(fs.readFileSync(file, "utf8"), saved, "formatting must not save the document")

		const fixture = await open("sample.vv", snapshot)
		assert.equal(await vscode.commands.executeCommand<boolean>("v.fmt"), true)
		assert.doesNotMatch(
			fixture.document.getText(),
			/json2/,
			".vv fixtures opt out of migration",
		)

		const script = await open("sample.vsh", "println( 'script' )\n")
		assert.equal(await vscode.commands.executeCommand<boolean>("v.fmt"), true)
		assert.equal(script.document.getText(), "println('script')\n")

		const skippedSource = "module main\n\nfn main( ){ println( 'unchanged' ) }\n"
		const skipped = await open("sample_vfmt_off.v", skippedSource)
		assert.equal(await vscode.commands.executeCommand<boolean>("v.fmt"), true)
		assert.equal(skipped.document.getText(), skippedSource)
		console.log("Formatting preserves project imports, unsaved buffers, fixtures and scripts")
	} finally {
		for (const document of documents) {
			if (document.isClosed) continue
			await vscode.window.showTextDocument(document)
			await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor")
		}
		if (previous && !previous.document.isClosed)
			await vscode.window.showTextDocument(previous.document)
		fs.rmSync(directory, { recursive: true, force: true })
	}
}
