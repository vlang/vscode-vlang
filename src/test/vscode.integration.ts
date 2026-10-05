import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import * as vscode from "vscode"
import { runFormattingRegressionTests } from "./formatting.integration"
import { runIssue523Checks } from "./issue523.integration"
import {
	assertVlsStartupConfiguration,
	currentVlsSettings,
	type ServerEvent,
} from "./lifecycle.integration"

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

async function assertVlsReady(pid: number, document: vscode.TextDocument): Promise<void> {
	const documents = vscode.workspace.textDocuments
		.filter((open) => open.uri.scheme === "file" && open.languageId === "v")
		.map((open) => open.uri.toString())
	await waitFor(() => {
		const opened = new Set(
			serverEvents()
				.filter((event) => event.pid === pid && event.event === "open")
				.map((event) => event.uri),
		)
		return documents.every((uri) => opened.has(uri)) ? true : undefined
	}, `open documents synchronized to VLS ${pid}`)
	const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
		"vscode.executeHoverProvider",
		document.uri,
		new vscode.Position(2, 21),
	)
	assert.ok(hovers?.length, "VLS must answer document requests after restarting")
	assert.equal(currentVlsSettings(serverEvents())?.pid, pid)
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

async function runCurrentVlsFeatureChecks(workspace: string): Promise<void> {
	const directory = vscode.Uri.file(path.join(workspace, "current-vls"))
	await vscode.workspace.fs.createDirectory(directory)
	await vscode.workspace.fs.writeFile(
		vscode.Uri.joinPath(directory, "v.mod"),
		Buffer.from("Module { name: 'current_vls_host_test' }\n"),
	)
	const moduleDirectory = vscode.Uri.joinPath(directory, "textx")
	await vscode.workspace.fs.createDirectory(moduleDirectory)
	await vscode.workspace.fs.writeFile(
		vscode.Uri.joinPath(moduleDirectory, "textx.v"),
		Buffer.from("module textx\n\npub fn answer() int { return 7 }\n"),
	)
	const uri = vscode.Uri.joinPath(directory, "main.v")
	await vscode.workspace.fs.writeFile(uri, Buffer.from("module main\n\nfn main() {\n\ttex\n}\n"))
	const document = await vscode.workspace.openTextDocument(uri)
	const editor = await vscode.window.showTextDocument(document)
	const imported = await waitFor(async () => {
		const result = await vscode.commands.executeCommand<vscode.CompletionList>(
			"vscode.executeCompletionItemProvider",
			uri,
			new vscode.Position(3, 4),
		)
		return result?.items.find((item) => {
			const label = typeof item.label === "string" ? item.label : item.label.label
			return (
				label === "textx" &&
				item.additionalTextEdits?.some((edit) => /import textx\b/.test(edit.newText))
			)
		})
	}, "current VLS auto-import completion")
	assert.equal(imported.kind, vscode.CompletionItemKind.Module)
	const importEdit = new vscode.WorkspaceEdit()
	importEdit.set(uri, [
		...(imported.additionalTextEdits ?? []),
		vscode.TextEdit.replace(new vscode.Range(3, 1, 3, 4), "textx.answer()"),
	])
	assert.equal(await vscode.workspace.applyEdit(importEdit), true)
	assert.match(document.getText(), /import textx\b/)
	assert.match(document.getText(), /textx\.answer\(\)/)
	assert.equal(await document.save(), true)
	assert.equal(await taskExit("v.run"), 0)
	console.log("Real VLS auto-import edits applied and the resulting program ran")

	assert.equal(
		await editor.edit((edit) =>
			edit.replace(
				new vscode.Range(
					document.positionAt(0),
					document.positionAt(document.getText().length),
				),
				"module main\n\nfn main() {\n\tscore := 7\n\tprintln(score)\n}\n",
			),
		),
		true,
	)
	async function scoreHint(type: string): Promise<vscode.InlayHint> {
		return waitFor(async () => {
			const hints = await vscode.commands.executeCommand<vscode.InlayHint[]>(
				"vscode.executeInlayHintProvider",
				uri,
				new vscode.Range(0, 0, document.lineCount, 0),
			)
			return hints?.find((hint) => {
				const label =
					typeof hint.label === "string"
						? hint.label
						: hint.label.map((part) => part.value).join("")
				return hint.position.line === 3 && new RegExp(`\\b${type}\\b`).test(label)
			})
		}, `current VLS ${type} hint for the unsaved score buffer`)
	}
	assert.equal((await scoreHint("int")).kind, vscode.InlayHintKind.Type)
	assert.equal((await scoreHint("int")).kind, vscode.InlayHintKind.Type)
	assert.equal(
		await editor.edit((edit) => edit.replace(new vscode.Range(3, 10, 3, 11), "'siete'")),
		true,
	)
	assert.equal(document.isDirty, true)
	assert.equal((await scoreHint("string")).kind, vscode.InlayHintKind.Type)
	console.log("Real VLS inlay hints repeat and refresh after an unsaved type change")
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
	await runFormattingRegressionTests(workspace)
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
		assert.ok(
			rename?.get(testDocument.uri).length,
			"current VLS rename must include the add reference in main_test.v",
		)
		let conflicting: vscode.WorkspaceEdit | undefined
		try {
			conflicting = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
				"vscode.executeDocumentRenameProvider",
				main.uri,
				position,
				"main",
			)
		} catch (error) {
			assert.match(String(error), /cannot rename|redefin|conflict|cannot safely/i)
		}
		assert.ok(!conflicting?.size, "current VLS must refuse a rename colliding with main")
		assert.match(main.getText(), /println\(add\(1, 2\)\)/)
		console.log("Real VLS three-file rename and collision refusal passed")
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
		await runCurrentVlsFeatureChecks(workspace)
		const outlineDirectory = vscode.Uri.file(path.join(workspace, "outline"))
		await vscode.workspace.fs.createDirectory(outlineDirectory)
		const outlineUri = vscode.Uri.joinPath(outlineDirectory, "main.v")
		const source = [
			"module main",
			"",
			"import os",
			"import strings",
			"",
			"struct OutlineItem {",
			"\tname string",
			"}",
			"",
			"enum OutlineColor {",
			"\tred",
			"\tblue",
			"}",
			"",
			"fn main() {",
			"\tprintln(os.args)",
			"\tprintln(strings.new_builder(16))",
			"}",
			"",
		].join("\n")
		await vscode.workspace.fs.writeFile(outlineUri, Buffer.from(source))
		const outline = await vscode.workspace.openTextDocument(outlineUri)
		await vscode.window.showTextDocument(outline)
		const mainSymbol = await waitFor(async () => {
			const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
				"vscode.executeDocumentSymbolProvider",
				outlineUri,
			)
			return symbols?.find((symbol) => symbol.name === "main")
		}, "main function in the real VLS outline")
		assert.equal(mainSymbol.kind, vscode.SymbolKind.Function)
		assert.equal(mainSymbol.selectionRange.start.line, 14)
		const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
			"vscode.executeFoldingRangeProvider",
			outlineUri,
		)
		for (const [label, start, end] of [
			["imports", 2, 3],
			["struct", 5, 7],
			["enum", 9, 12],
			["function", 14, 17],
		] as const) {
			assert.ok(
				ranges?.some((range) => range.start === start && range.end === end),
				`real VLS did not provide the ${label} folding range`,
			)
		}
		assert.equal(
			ranges?.find((range) => range.start === 2)?.kind,
			vscode.FoldingRangeKind.Imports,
		)
		console.log("Real VLS main outline and imports, struct, enum, function folding passed")
		const dirty = await vscode.window.showTextDocument(main)
		await dirty.edit((edit) => edit.insert(new vscode.Position(0, 0), "\n"))
		assert.equal(main.isDirty, true)
		assert.equal(await vscode.commands.executeCommand<boolean>("v.fmt"), true)
		assert.equal(main.isDirty, true)
		assert.ok(main.getText().startsWith("module main"))
		await runIssue523Checks(workspace, fakeVls)
		console.log("Real VLS and V compiler smoke test passed")
		return
	}

	const initialPid = await waitFor(
		() => currentVlsSettings(serverEvents())?.pid,
		"initial VLS settings",
	)
	assertVlsStartupConfiguration(serverEvents())
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
		return currentVlsSettings(serverEvents())?.settings?.vls?.diagnostics?.enabled === true
			? true
			: undefined
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
			currentVlsSettings(serverEvents())?.settings?.vls?.diagnostics?.enabled
				? true
				: undefined,
		"diagnostics reenabled",
	)
	await settings.update("inlayHints.enabled", false, vscode.ConfigurationTarget.Workspace)
	await waitFor(
		() =>
			currentVlsSettings(serverEvents())?.settings?.vls?.inlayHints?.enabled === false
				? true
				: undefined,
		"inlay hints disabled",
	)
	await settings.update("inlayHints.enabled", true, vscode.ConfigurationTarget.Workspace)
	await waitFor(
		() =>
			currentVlsSettings(serverEvents())?.settings?.vls?.inlayHints?.enabled === true
				? true
				: undefined,
		"inlay hints reenabled",
	)
	await settings.update("diagnostics", false, vscode.ConfigurationTarget.Workspace)
	await settings.update("inlayHints.enabled", false, vscode.ConfigurationTarget.Workspace)
	// Settings updates queue restarts too. Wait for the newest initialized server's
	// settings, not a historical settings event from an intermediate server.
	const replacedPids = new Set(serverEvents().map((event) => event.pid))
	await vscode.commands.executeCommand("v.vls.restart")
	const crashedPid = await waitFor(() => {
		const latest = currentVlsSettings(serverEvents())
		return latest &&
			!replacedPids.has(latest.pid) &&
			latest.settings?.vls?.diagnostics?.enabled === false &&
			latest.settings.vls.inlayHints?.enabled === false
			? latest.pid
			: undefined
	}, "disabled settings on restarted VLS")
	// Startup document notifications can still be in flight after settings arrive.
	await assertVlsReady(crashedPid, main)
	process.kill(crashedPid, "SIGKILL")
	const recoveredPid = await waitFor(() => {
		const latest = currentVlsSettings(serverEvents())
		return latest?.pid !== crashedPid &&
			latest?.settings?.vls?.diagnostics?.enabled === false &&
			latest.settings.vls.inlayHints?.enabled === false
			? latest.pid
			: undefined
	}, "VLS automatic crash recovery with disabled settings")
	await assertVlsReady(recoveredPid, main)
	await settings.update("diagnostics", true, vscode.ConfigurationTarget.Workspace)
	await settings.update("inlayHints.enabled", true, vscode.ConfigurationTarget.Workspace)
	await waitFor(() => {
		const latest = currentVlsSettings(serverEvents())
		return latest?.settings?.vls?.diagnostics?.enabled === true &&
			latest.settings.vls.inlayHints?.enabled === true
			? true
			: undefined
	}, "settings restored after crash")
	console.log("VLS automatic crash recovery preserved settings")
	const pidBeforeRestart = currentVlsSettings(serverEvents())?.pid
	await vscode.commands.executeCommand("v.vls.restart")
	const restartedPid = await waitFor(() => {
		const latest = currentVlsSettings(serverEvents())
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
		const latest = currentVlsSettings(serverEvents())
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
		const latest = currentVlsSettings(serverEvents())
		return latest?.pid !== pidBeforeFailure && latest?.settings?.vls?.diagnostics?.enabled
			? latest.pid
			: undefined
	}, "VLS recovery after invalid command")
	console.log("VLS failure recovery passed")
	const manifestPath = process.env.TEST_VLS_MANIFEST
	assert.ok(manifestPath, "fixture host must provide managed VLS metadata")
	const currentManifest = fs.readFileSync(manifestPath, "utf8")
	const previousManifest = JSON.parse(currentManifest) as Record<string, unknown>
	previousManifest.revision = "436058d058b2ae9cb17d329d7b7f73ec129b2b8a"
	delete previousManifest.vlsBaseline
	fs.writeFileSync(manifestPath, JSON.stringify(previousManifest))
	const spawnsBeforeRejection = serverEvents().filter((event) => event.event === "spawn").length
	await vscode.commands.executeCommand("v.vls.restart")
	await new Promise((resolve) => setTimeout(resolve, 750))
	assert.equal(
		serverEvents().filter((event) => event.event === "spawn").length,
		spawnsBeforeRejection,
		"a VLS installation older than the supported baseline must not start",
	)
	assert.equal(currentVlsSettings(serverEvents()), undefined)
	fs.writeFileSync(manifestPath, currentManifest)
	await vscode.commands.executeCommand("v.vls.restart")
	await waitFor(
		() => currentVlsSettings(serverEvents()),
		"supported VLS restored after rejection",
	)
	console.log("Unsupported VLS is rejected and the supported installation restarts")

	const dirty = await vscode.window.showTextDocument(main)
	await dirty.edit((edit) => edit.insert(new vscode.Position(0, 0), "\n"))
	assert.equal(main.isDirty, true)
	await vscode.commands.executeCommand("v.fmt")
	assert.equal(main.isDirty, true, "formatting must preserve the unsaved editor buffer")
	assert.ok(main.getText().startsWith("module main"), "V fmt must apply to the editor buffer")
	console.log("Unsaved-buffer formatting passed")
	await runIssue523Checks(workspace, fakeVls)
	const restored = await waitFor(
		() => currentVlsSettings(serverEvents()),
		"VLS configuration restored after formatting checks",
	)
	await assertVlsReady(restored.pid, main)
	assertVlsStartupConfiguration(serverEvents())
	console.log("VLS configuration was sent once per initialized server without racing shutdown")
}
