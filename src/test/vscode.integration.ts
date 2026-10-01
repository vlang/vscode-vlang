import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import * as vscode from "vscode"

type ServerEvent = {
	event: string
	pid: number
	settings?: { vls?: { diagnostics?: { enabled?: boolean }; inlayHints?: { enabled?: boolean } } }
}

async function waitFor<T>(
	getValue: () => Promise<T | undefined> | T | undefined,
	label: string,
): Promise<T> {
	const deadline = Date.now() + 30_000
	while (Date.now() < deadline) {
		const value = await getValue()
		if (value !== undefined) return value
		await new Promise((resolve) => setTimeout(resolve, 200))
	}
	throw new Error(`Timed out waiting for ${label}`)
}

function serverEvents(): ServerEvent[] {
	const file = process.env.TEST_VLS_EVENTS
	if (!file || !fs.existsSync(file)) return []
	return fs
		.readFileSync(file, "utf8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as ServerEvent)
}

async function taskExit(command: string, ...args: unknown[]): Promise<number | undefined> {
	let listener: vscode.Disposable | undefined
	let timer: NodeJS.Timeout | undefined
	const done = new Promise<number | undefined>((resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`Timed out waiting for ${command} task`)), 60_000)
		listener = vscode.tasks.onDidEndTaskProcess((event) => {
			if (event.execution.task.definition.type !== "v") return
			resolve(event.exitCode)
		})
	})
	try {
		await vscode.commands.executeCommand(command, ...args)
		return await done
	} finally {
		listener?.dispose()
		if (timer) clearTimeout(timer)
	}
}

export async function run(): Promise<void> {
	const workspace = process.env.TEST_WORKSPACE
	assert.ok(workspace)
	const fakeVls = process.env.TEST_FAKE_VLS === "1"
	const extension = vscode.extensions.getExtension("vlanguage.vscode-vlang")
	assert.ok(extension, "vscode-vlang extension is installed in the test host")
	await extension.activate()
	const commands = await vscode.commands.getCommands(true)
	for (const command of ["v.install", "v.vls.update", "v.tools.checkForUpdates"]) {
		assert.ok(commands.includes(command), `Command ${command} must be registered`)
	}
	assert.equal(
		vscode.workspace.getConfiguration("v.tools").get<boolean>("checkForUpdates"),
		false,
		"test host must not check GitHub for updates",
	)
	const main = await vscode.workspace.openTextDocument(path.join(workspace, "main.v"))
	await vscode.window.showTextDocument(main)
	assert.equal(main.languageId, "v")
	console.log("Extension activated and V document opened")

	const tasks = await vscode.tasks.fetchTasks({ type: "v" })
	assert.deepEqual(tasks.map((task) => task.definition.action).sort(), [
		"build",
		"prod",
		"run",
		"test",
	])
	assert.equal(await taskExit("vls.build"), 0)
	assert.equal(await taskExit("vls.run"), 0)
	assert.equal(await taskExit("v.run"), 0)
	assert.equal(await taskExit("v.prod"), 0)
	const version = await vscode.commands.executeCommand<string>("v.ver")
	assert.match(version, /^V \d/)
	console.log("Build, run, current-file run, and optimized build passed")

	const runLens = await waitFor(async () => {
		const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
			"vscode.executeCodeLensProvider",
			main.uri,
		)
		return lenses?.find((lens) => lens.command?.command === "vls.runFile")
	}, "VLS run CodeLens")
	assert.ok(runLens.command)
	assert.equal(await taskExit(runLens.command.command, ...(runLens.command.arguments ?? [])), 0)
	console.log("VLS CodeLens task passed")

	const testDocument = await vscode.workspace.openTextDocument(
		path.join(workspace, "main_test.v"),
	)
	await vscode.window.showTextDocument(testDocument)
	assert.equal(await taskExit("vls.test"), 0)
	await vscode.commands.executeCommand("vls.coverage.clear")
	console.log("Test and coverage clear passed")

	for (const extension of ["vh", "vv", "vsh"]) {
		const uri = vscode.Uri.file(path.join(workspace, `sample.${extension}`))
		await vscode.workspace.fs.writeFile(uri, Buffer.from("module main\n"))
		assert.equal((await vscode.workspace.openTextDocument(uri)).languageId, "v")
	}
	const header = await vscode.workspace.openTextDocument(path.join(workspace, "sample.vh"))
	const headerEditor = await vscode.window.showTextDocument(header)
	await headerEditor.edit((edit) =>
		edit.insert(new vscode.Position(1, 0), "\nfn header_sum(a int,b int) int{return a+b}\n"),
	)
	assert.equal(await vscode.commands.executeCommand<boolean>("v.fmt"), true)
	assert.equal(header.isDirty, true)
	assert.match(header.getText(), /fn header_sum\(a int, b int\) int \{/)
	console.log("Header buffer formatting passed")
	const script = await vscode.workspace.openTextDocument(path.join(workspace, "sample.vsh"))
	await vscode.window.showTextDocument(script)
	let startedTasks = 0
	const taskListener = vscode.tasks.onDidStartTask((event) => {
		if (event.execution.task.definition.type === "v") startedTasks++
	})
	try {
		await vscode.commands.executeCommand("v.prod")
		await new Promise((resolve) => setTimeout(resolve, 250))
		assert.equal(startedTasks, 0, "optimized build must reject .vsh without starting a task")
	} finally {
		taskListener.dispose()
	}
	console.log("Script optimized build rejection passed")

	await vscode.window.showTextDocument(main)
	const position = new vscode.Position(2, 21)
	const completions = await waitFor(
		async () =>
			vscode.commands.executeCommand<vscode.CompletionList>(
				"vscode.executeCompletionItemProvider",
				main.uri,
				position,
			),
		"completion provider",
	)
	if (!fakeVls) {
		assert.ok(completions.items.length > 0, "real VLS returned no completions for add")
		console.log(`Real VLS completion: ${completions.items.length} items`)
	} else {
		assert.ok(completions.items.some((item) => item.label === "fake_completion"))
	}
	const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
		"vscode.executeHoverProvider",
		main.uri,
		position,
	)
	assert.ok(hovers?.length, "VLS hover missing for add")
	if (!fakeVls) console.log(`Real VLS hover: ${hovers.length} results`)
	const definitions = await vscode.commands.executeCommand<
		(vscode.Location | vscode.LocationLink)[]
	>("vscode.executeDefinitionProvider", main.uri, position)
	if (fakeVls)
		assert.ok(
			definitions?.some(
				(location) =>
					("uri" in location ? location.uri : location.targetUri).toString() ===
					main.uri.toString(),
			),
		)
	else {
		assert.ok(
			definitions?.some((location) =>
				("uri" in location ? location.uri : location.targetUri).fsPath.endsWith("helper.v"),
			),
			"real VLS did not resolve add to helper.v",
		)
		console.log(`Real VLS definition: ${definitions.length} results`)
	}
	let realRenameMissesTest = false
	const rename = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
		"vscode.executeDocumentRenameProvider",
		main.uri,
		position,
		"renamed",
	)
	if (fakeVls) assert.ok(rename?.get(main.uri).some((edit) => edit.newText === "renamed"))
	else {
		const editedFiles =
			rename
				?.entries()
				.map(([uri, edits]) => `${path.basename(uri.fsPath)}:${edits.length}`) ?? []
		console.log(`Real VLS rename: ${editedFiles.join(", ")}`)
		assert.ok(
			rename?.get(vscode.Uri.file(path.join(workspace, "helper.v"))).length,
			"real VLS rename missed the add declaration in helper.v",
		)
		assert.ok(rename?.get(main.uri).length, "real VLS rename missed the main.v reference")
		realRenameMissesTest = !rename?.get(testDocument.uri).length
	}
	if (!fakeVls) {
		const editor = await vscode.window.showTextDocument(main)
		await editor.edit((edit) => edit.insert(new vscode.Position(2, 0), "   "))
	}
	const formatting = await vscode.commands.executeCommand<vscode.TextEdit[]>(
		"vscode.executeFormatDocumentProvider",
		main.uri,
		{ tabSize: 4, insertSpaces: false },
	)
	if (fakeVls) assert.ok(formatting?.length)
	else {
		assert.ok(formatting?.length, "real VLS did not format deliberately misindented code")
		console.log(
			`Real VLS formatting of deliberately misindented code: ${formatting.length} edits`,
		)
	}
	console.log(
		fakeVls
			? "LSP completion, hover, definition, rename, and formatting passed"
			: "Real VLS feature probes completed",
	)

	if (!fakeVls) {
		const dirty = await vscode.window.showTextDocument(main)
		await dirty.edit((edit) => edit.insert(new vscode.Position(0, 0), "\n"))
		assert.equal(main.isDirty, true)
		assert.equal(await vscode.commands.executeCommand<boolean>("v.fmt"), true)
		assert.equal(main.isDirty, true)
		assert.ok(main.getText().startsWith("module main"))
		assert.equal(
			realRenameMissesTest,
			false,
			"real VLS rename missed the add reference in main_test.v",
		)
		console.log("Real VLS and V compiler smoke test passed")
		return
	}

	const initialPid = await waitFor(
		() =>
			serverEvents()
				.filter((event) => event.event === "settings")
				.at(-1)?.pid,
		"initial VLS settings",
	)
	assert.equal(
		serverEvents().find((event) => event.event === "settings")?.settings?.vls?.diagnostics
			?.enabled,
		false,
		"initial diagnostics=false must reach VLS",
	)
	assert.equal(vscode.languages.getDiagnostics().flatMap(([, entries]) => entries).length, 0)
	const settings = vscode.workspace.getConfiguration("v.vls")
	await settings.update("diagnostics", true, vscode.ConfigurationTarget.Workspace)
	await waitFor(() => {
		const matching = serverEvents().find(
			(event) =>
				event.event === "settings" && event.settings?.vls?.diagnostics?.enabled === true,
		)
		return matching ? true : undefined
	}, "updated diagnostics setting")
	await waitFor(
		() =>
			vscode.languages
				.getDiagnostics()
				.some(([, diagnostics]) =>
					diagnostics.some((diagnostic) => diagnostic.source === "fake-vls"),
				)
				? true
				: undefined,
		"diagnostics",
	)
	await settings.update("diagnostics", false, vscode.ConfigurationTarget.Workspace)
	await waitFor(
		() =>
			vscode.languages
				.getDiagnostics()
				.every(([, diagnostics]) =>
					diagnostics.every((diagnostic) => diagnostic.source !== "fake-vls"),
				)
				? true
				: undefined,
		"stale diagnostics cleared",
	)
	await settings.update("diagnostics", true, vscode.ConfigurationTarget.Workspace)
	await waitFor(
		() =>
			serverEvents()
				.filter((event) => event.event === "settings")
				.at(-1)?.settings?.vls?.diagnostics?.enabled
				? true
				: undefined,
		"diagnostics reenabled",
	)
	await settings.update("inlayHints.enabled", false, vscode.ConfigurationTarget.Workspace)
	await waitFor(
		() =>
			serverEvents()
				.filter((event) => event.event === "settings")
				.at(-1)?.settings?.vls?.inlayHints?.enabled === false
				? true
				: undefined,
		"inlay hints disabled",
	)
	await settings.update("inlayHints.enabled", true, vscode.ConfigurationTarget.Workspace)
	await waitFor(
		() =>
			serverEvents()
				.filter((event) => event.event === "settings")
				.at(-1)?.settings?.vls?.inlayHints?.enabled === true
				? true
				: undefined,
		"inlay hints reenabled",
	)
	await settings.update("diagnostics", false, vscode.ConfigurationTarget.Workspace)
	await settings.update("inlayHints.enabled", false, vscode.ConfigurationTarget.Workspace)
	// The server being replaced also receives the disabled settings; only a pid
	// started by the restart is still alive to be killed.
	const replacedPids = new Set(serverEvents().map((event) => event.pid))
	await vscode.commands.executeCommand("v.vls.restart")
	const crashedPid = await waitFor(() => {
		const latest = serverEvents()
			.filter((event) => event.event === "settings")
			.at(-1)
		return latest &&
			!replacedPids.has(latest.pid) &&
			latest.settings?.vls?.diagnostics?.enabled === false &&
			latest.settings.vls.inlayHints?.enabled === false
			? latest.pid
			: undefined
	}, "disabled settings on restarted VLS")
	process.kill(crashedPid, "SIGKILL")
	await waitFor(() => {
		const latest = serverEvents()
			.filter((event) => event.event === "settings")
			.at(-1)
		return latest?.pid !== crashedPid &&
			latest?.settings?.vls?.diagnostics?.enabled === false &&
			latest.settings.vls.inlayHints?.enabled === false
			? latest.pid
			: undefined
	}, "VLS automatic crash recovery with disabled settings")
	await settings.update("diagnostics", true, vscode.ConfigurationTarget.Workspace)
	await settings.update("inlayHints.enabled", true, vscode.ConfigurationTarget.Workspace)
	await waitFor(() => {
		const latest = serverEvents()
			.filter((event) => event.event === "settings")
			.at(-1)
		return latest?.settings?.vls?.diagnostics?.enabled === true &&
			latest.settings.vls.inlayHints?.enabled === true
			? true
			: undefined
	}, "settings restored after crash")
	console.log("VLS automatic crash recovery preserved settings")
	const pidBeforeRestart = serverEvents()
		.filter((event) => event.event === "settings")
		.at(-1)?.pid
	await vscode.commands.executeCommand("v.vls.restart")
	const restartedPid = await waitFor(() => {
		const latest = serverEvents()
			.filter((event) => event.event === "settings")
			.at(-1)
		return latest?.pid !== pidBeforeRestart && latest?.settings?.vls?.diagnostics?.enabled
			? latest.pid
			: undefined
	}, "fresh VLS client after restart")
	assert.notEqual(initialPid, restartedPid)
	console.log("Live settings, diagnostics, and fresh VLS restart passed")

	await settings.update("enable", false, vscode.ConfigurationTarget.Workspace)
	await waitFor(
		() =>
			serverEvents().some((event) => event.pid === restartedPid && event.event === "exit")
				? true
				: undefined,
		"VLS disabled",
	)
	await settings.update("enable", true, vscode.ConfigurationTarget.Workspace)
	const reenabledPid = await waitFor(() => {
		const latest = serverEvents()
			.filter((event) => event.event === "settings")
			.at(-1)
		return latest?.pid !== restartedPid && latest?.settings?.vls?.diagnostics?.enabled
			? latest.pid
			: undefined
	}, "VLS reenabled")
	console.log("VLS disable and enable passed")

	const currentCommand = settings.inspect<string>("command")?.workspaceValue
	const pidBeforeFailure = reenabledPid
	await settings.update(
		"command",
		path.join(workspace, "missing-vls"),
		vscode.ConfigurationTarget.Workspace,
	)
	await waitFor(
		() =>
			serverEvents().some((event) => event.pid === pidBeforeFailure && event.event === "exit")
				? true
				: undefined,
		"old VLS stopped after invalid command",
	)
	await settings.update("command", currentCommand, vscode.ConfigurationTarget.Workspace)
	await waitFor(() => {
		const latest = serverEvents()
			.filter((event) => event.event === "settings")
			.at(-1)
		return latest?.pid !== pidBeforeFailure && latest?.settings?.vls?.diagnostics?.enabled
			? latest.pid
			: undefined
	}, "VLS recovery after invalid command")
	console.log("VLS failure recovery passed")

	const dirty = await vscode.window.showTextDocument(main)
	await dirty.edit((edit) => edit.insert(new vscode.Position(0, 0), "\n"))
	assert.equal(main.isDirty, true)
	await vscode.commands.executeCommand("v.fmt")
	assert.equal(main.isDirty, true, "formatting must preserve the unsaved editor buffer")
	assert.ok(main.getText().startsWith("module main"), "V fmt must apply to the editor buffer")
	console.log("Unsaved-buffer formatting passed")
}
