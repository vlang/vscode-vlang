import * as assert from "node:assert/strict"
import * as path from "node:path"
import * as vscode from "vscode"

async function waitFor<T>(getValue: () => Promise<T | undefined>, label: string): Promise<T> {
	const deadline = Date.now() + 30_000
	while (Date.now() < deadline) {
		const value = await getValue()
		if (value !== undefined) return value
		await new Promise((resolve) => setTimeout(resolve, 300))
	}
	throw new Error(`Timed out waiting for ${label}`)
}

async function taskExit(command: string, ...args: unknown[]): Promise<number | undefined> {
	const done = new Promise<number | undefined>((resolve, reject) => {
		const timer = setTimeout(() => {
			listener.dispose()
			reject(new Error(`Timed out waiting for ${command} task`))
		}, 60_000)
		const listener = vscode.tasks.onDidEndTaskProcess((event) => {
			if (event.execution.task.definition.type !== "v") return
			clearTimeout(timer)
			listener.dispose()
			resolve(event.exitCode)
		})
	})
	await vscode.commands.executeCommand(command, ...args)
	return done
}

export async function run(): Promise<void> {
	const workspace = process.env.TEST_WORKSPACE
	assert.ok(workspace)
	const extension = vscode.extensions.getExtension("vlanguage.vscode-vlang")
	assert.ok(extension, "vscode-vlang extension is installed in the test host")
	await extension.activate()
	console.log("Activated vscode-vlang with local VLS")

	const main = await vscode.workspace.openTextDocument(path.join(workspace, "main.v"))
	await vscode.window.showTextDocument(main)
	assert.equal(main.languageId, "v")

	const tasks = await vscode.tasks.fetchTasks({ type: "v" })
	assert.deepEqual(tasks.map((task) => task.definition.action).sort(), ["build", "run", "test"])

	const runLens = await waitFor(async () => {
		const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
			"vscode.executeCodeLensProvider",
			main.uri,
		)
		return lenses?.find((lens) => lens.command?.command === "vls.runFile")
	}, "VLS CodeLens")
	console.log("VLS CodeLens available")

	assert.equal(await taskExit("vls.build"), 0)
	console.log("Build task passed")
	assert.equal(await taskExit("vls.run"), 0)
	console.log("Run task passed")
	assert.equal(await taskExit("v.run"), 0)
	console.log("Run current file task passed")
	assert.ok(runLens.command)
	assert.equal(
		await taskExit(runLens.command.command, ...(runLens.command.arguments ?? [])),
		0,
	)
	console.log("CodeLens run task passed")

	const testDocument = await vscode.workspace.openTextDocument(
		path.join(workspace, "main_test.v"),
	)
	await vscode.window.showTextDocument(testDocument)
	assert.equal(await taskExit("vls.test"), 0)
	console.log("Test and coverage task passed")
	await vscode.commands.executeCommand("vls.coverage.clear")
	console.log("Coverage clear command passed")
	for (const extension of ["vh", "vv", "vsh"]) {
		const uri = vscode.Uri.file(path.join(workspace, `sample.${extension}`))
		await vscode.workspace.fs.writeFile(uri, Buffer.from("module main\n"))
		assert.equal((await vscode.workspace.openTextDocument(uri)).languageId, "v")
	}
	console.log("V file associations passed")

	if (!process.env.TEST_LEGACY_SETTINGS) {
		const brokenUri = vscode.Uri.file(path.join(workspace, "broken.v"))
		await vscode.workspace.fs.writeFile(
			brokenUri,
			Buffer.from("module main\n\nfn broken() { println(undefined_symbol) }\n"),
		)
		const broken = await vscode.workspace.openTextDocument(brokenUri)
		const editor = await vscode.window.showTextDocument(broken)
		await new Promise((resolve) => setTimeout(resolve, 1500))
		assert.equal(vscode.languages.getDiagnostics(brokenUri).length, 0)
		await vscode.workspace
			.getConfiguration("v.vls")
			.update("diagnostics", true, vscode.ConfigurationTarget.Workspace)
		await editor.edit((edit) => edit.insert(broken.positionAt(broken.getText().length), "\n"))
		await waitFor(async () => {
			return vscode.languages.getDiagnostics(brokenUri).length > 0 ? true : undefined
		}, "VLS diagnostics after enabling")
		console.log("Live diagnostics setting passed")
	}
}
