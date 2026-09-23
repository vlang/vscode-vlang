import * as assert from "assert"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { describe, it } from "node:test"
import {
	activeRunTaskSpec,
	codeLensTaskSpec,
	shouldSaveTaskDocument,
	standaloneTaskScope,
	taskCoverageRoot,
	taskWorkingDirectory,
	workspaceTaskSpec,
} from "../taskSpec"
import { serverCommand } from "../vCommand"
import {
	canonicalFilePath,
	coverageArgsForRun,
	fileModificationStateMatches,
	instrumentCoverageArgs,
	parseLcovProfile,
	parseLcovProfileFile,
	pruneStaleCoverageFiles,
	readFileModificationState,
	recordFileChange,
	seedDirtyFileInvalidations,
	visibleCoverageLines,
} from "../coverageProfile"
import {
	isTerminalInterrupt,
	processLaunchCommand,
	processTreeKillCommand,
} from "../processExecution"

describe("VLS VS Code extension", () => {
	it("contributes build, run, and test commands and tasks", () => {
		const packagePath = path.resolve(__dirname, "..", "..", "package.json")
		const manifest = JSON.parse(fs.readFileSync(packagePath, "utf8"))
		const commands = manifest.contributes.commands.map((entry: { command: string }) => {
			return entry.command
		})
		for (const command of ["vls.build", "vls.run", "vls.test", "vls.coverage.clear"]) {
			assert.ok(commands.includes(command))
		}

		const taskDefinition = manifest.contributes.taskDefinitions[0]
		assert.strictEqual(taskDefinition.type, "v")
		assert.deepStrictEqual(taskDefinition.properties.action.enum, ["build", "run", "test"])
		assert.ok(manifest.contributes.configuration.properties["v.executablePath"])
		assert.strictEqual(
			manifest.contributes.configuration.properties["v.vls.coverage.enabled"].default,
			true,
		)
	})

	it("instruments V test arguments with an isolated coverage directory", () => {
		assert.deepStrictEqual(
			instrumentCoverageArgs(["-nocolor", "test", "."], "/tmp/vls-coverage/run"),
			["-no-skip-unused", "-coverage", "/tmp/vls-coverage/run", "-nocolor", "test", "."],
		)
	})

	it("re-evaluates coverage arguments for every task run", () => {
		const args = ["-nocolor", "test", "."]
		const coverageDirectory = "/tmp/vls-coverage/run"

		assert.deepStrictEqual(coverageArgsForRun(args), args)
		assert.deepStrictEqual(coverageArgsForRun(args, coverageDirectory), [
			"-no-skip-unused",
			"-coverage",
			coverageDirectory,
			...args,
		])
	})

	it("quotes Windows command wrapper arguments through the command interpreter", () => {
		const commandInterpreter = "C:\\Windows\\System32\\cmd.exe"
		const launch = processLaunchCommand(
			"C:\\V Compiler\\v.cmd",
			["test", "C:\\My Project\\some&file.v", "100%"],
			"win32",
			commandInterpreter,
		)

		assert.deepStrictEqual(launch, {
			command: commandInterpreter,
			args: [
				"/d",
				"/s",
				"/c",
				'"C:\\V^ Compiler\\v.cmd ^"test^" ^"C:\\My^ Project\\some^&file.v^" ^"100^%^""',
			],
			windowsVerbatimArguments: true,
		})
		assert.deepStrictEqual(processLaunchCommand("C:\\V Compiler\\v.exe", ["test"], "win32"), {
			command: "C:\\V Compiler\\v.exe",
			args: ["test"],
		})
		assert.deepStrictEqual(processLaunchCommand("/usr/local/bin/v.cmd", ["test"], "linux"), {
			command: "/usr/local/bin/v.cmd",
			args: ["test"],
		})
	})

	it("terminates Windows test process trees with taskkill", () => {
		assert.deepStrictEqual(processTreeKillCommand(1234, "win32"), {
			command: "taskkill.exe",
			args: ["/pid", "1234", "/t", "/f"],
		})
		assert.strictEqual(processTreeKillCommand(1234, "darwin"), undefined)
	})

	it("recognizes Ctrl+C terminal input as an interrupt", () => {
		assert.strictEqual(isTerminalInterrupt("\x03"), true)
		assert.strictEqual(isTerminalInterrupt("input\x03"), true)
		assert.strictEqual(isTerminalInterrupt("^C"), false)
	})

	it("parses and merges covered and uncovered LCOV lines", () => {
		const profile = parseLcovProfile(
			[
				"TN:",
				"SF:src/example.v",
				"DA:8,0",
				"DA:3,2",
				"end_of_record",
				"SF:src/example.v",
				"DA:8,1",
				"DA:12,0",
				"end_of_record",
			].join("\n"),
			"/workspace",
		)

		assert.deepStrictEqual(profile.get(path.normalize("/workspace/src/example.v")), {
			covered: [3, 8],
			uncovered: [12],
		})
	})

	it("streams LCOV while filtering files before retaining line data", async () => {
		const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vls-coverage-stream-"))
		const workspace = path.join(temporaryRoot, "workspace")
		const reportPath = path.join(temporaryRoot, "coverage.lcov")
		const includedFile = path.join(workspace, "included.v")
		const excludedFile = path.join(temporaryRoot, "excluded.v")
		try {
			fs.mkdirSync(workspace)
			fs.writeFileSync(includedFile, "module example\n")
			fs.writeFileSync(excludedFile, "module example\n")
			fs.writeFileSync(
				reportPath,
				[
					`SF:${includedFile}`,
					"DA:1,1",
					"end_of_record",
					`SF:${excludedFile}`,
					"DA:1,0",
					"end_of_record",
				].join("\n"),
			)

			const profile = await parseLcovProfileFile(reportPath, workspace, (filePath) => {
				return filePath === canonicalFilePath(includedFile)
			})

			assert.deepStrictEqual(
				[...profile],
				[[canonicalFilePath(includedFile), { covered: [1], uncovered: [] }]],
			)
		} finally {
			fs.rmSync(temporaryRoot, { recursive: true, force: true })
		}
	})

	it("bounds coverage decorations to visible lines", () => {
		const lines = Array.from({ length: 10_000 }, (_value, index) => index + 1)

		assert.deepStrictEqual(
			visibleCoverageLines(lines, [{ start: 99, end: 109 }], lines.length, 5),
			[100, 101, 102, 103, 104],
		)
		assert.deepStrictEqual(visibleCoverageLines([1, 5, 10], [{ start: 4, end: 9 }], 7, 1000), [
			5,
		])
	})

	it("canonicalizes relative LCOV paths through workspace symlinks", () => {
		const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vls-coverage-profile-"))
		const realWorkspace = path.join(temporaryRoot, "real-workspace")
		const linkedWorkspace = path.join(temporaryRoot, "linked-workspace")
		const sourceDirectory = path.join(realWorkspace, "src")
		const sourceFile = path.join(sourceDirectory, "example.v")
		try {
			fs.mkdirSync(sourceDirectory, { recursive: true })
			fs.writeFileSync(sourceFile, "module example\n")
			fs.symlinkSync(
				realWorkspace,
				linkedWorkspace,
				process.platform === "win32" ? "junction" : "dir",
			)

			const profile = parseLcovProfile(
				"SF:src/example.v\nDA:1,1\nend_of_record",
				linkedWorkspace,
			)

			assert.ok(profile.has(canonicalFilePath(sourceFile)))
			assert.ok(!profile.has(path.join(linkedWorkspace, "src", "example.v")))
		} finally {
			fs.rmSync(temporaryRoot, { recursive: true, force: true })
		}
	})

	it("carries dirty document invalidations into a new test generation", () => {
		const changedFiles = new Map<string, number>([
			[canonicalFilePath("/workspace/previous.v"), 2],
		])

		seedDirtyFileInvalidations(
			changedFiles,
			[
				{ filePath: "/workspace/dirty.v", isDirty: true },
				{ filePath: "/workspace/clean.v", isDirty: false },
			],
			3,
		)

		assert.deepStrictEqual([...changedFiles], [[canonicalFilePath("/workspace/dirty.v"), 3]])
	})

	it("detects external filesystem modifications to covered files", () => {
		const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vls-coverage-state-"))
		const sourceFile = path.join(temporaryRoot, "example.v")
		try {
			fs.writeFileSync(sourceFile, "module example\n")
			const state = readFileModificationState(sourceFile)
			assert.ok(state)
			assert.ok(fileModificationStateMatches(sourceFile, state))

			fs.writeFileSync(sourceFile, "module example\n\nfn changed() {}\n")
			assert.ok(!fileModificationStateMatches(sourceFile, state))
		} finally {
			fs.rmSync(temporaryRoot, { recursive: true, force: true })
		}
	})

	it("prunes externally changed closed files from coverage totals", () => {
		const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vls-coverage-prune-"))
		const changedFile = path.join(temporaryRoot, "changed.v")
		const deletedFile = path.join(temporaryRoot, "deleted.v")
		const unchangedFile = path.join(temporaryRoot, "unchanged.v")
		try {
			fs.writeFileSync(changedFile, "module example\n")
			fs.writeFileSync(deletedFile, "module example\n")
			fs.writeFileSync(unchangedFile, "module example\n")
			const changedState = readFileModificationState(changedFile)
			const deletedState = readFileModificationState(deletedFile)
			const unchangedState = readFileModificationState(unchangedFile)
			assert.ok(changedState)
			assert.ok(deletedState)
			assert.ok(unchangedState)
			const profile = new Map([
				[changedFile, { covered: [1], uncovered: [2] }],
				[deletedFile, { covered: [1], uncovered: [] }],
				[unchangedFile, { covered: [1], uncovered: [] }],
			])
			const fileStates = new Map([
				[changedFile, changedState],
				[deletedFile, deletedState],
				[unchangedFile, unchangedState],
			])
			fs.writeFileSync(changedFile, "module example\n\nfn changed() {}\n")
			fs.rmSync(deletedFile)

			assert.strictEqual(pruneStaleCoverageFiles(profile, fileStates), true)
			assert.deepStrictEqual([...profile.keys()], [unchangedFile])
			assert.deepStrictEqual([...fileStates.keys()], [unchangedFile])
			assert.strictEqual(pruneStaleCoverageFiles(profile, fileStates), false)
		} finally {
			fs.rmSync(temporaryRoot, { recursive: true, force: true })
		}
	})

	it("canonicalizes deleted paths reported by a coverage watcher", () => {
		const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vls-coverage-watch-"))
		const realWorkspace = path.join(temporaryRoot, "real-workspace")
		const linkedWorkspace = path.join(temporaryRoot, "linked-workspace")
		const sourceFile = path.join(realWorkspace, "example.v")
		const linkedSourceFile = path.join(linkedWorkspace, "example.v")
		try {
			fs.mkdirSync(realWorkspace)
			fs.writeFileSync(sourceFile, "module example\n")
			fs.symlinkSync(
				realWorkspace,
				linkedWorkspace,
				process.platform === "win32" ? "junction" : "dir",
			)
			const canonicalSourceFile = canonicalFilePath(sourceFile)
			fs.rmSync(sourceFile)

			const changedFiles = new Set<string>()
			recordFileChange(changedFiles, linkedSourceFile)

			assert.deepStrictEqual([...changedFiles], [canonicalSourceFile])
		} finally {
			fs.rmSync(temporaryRoot, { recursive: true, force: true })
		}
	})

	it("defines the preconfigured workspace task arguments", () => {
		assert.deepStrictEqual(workspaceTaskSpec("build"), {
			action: "build",
			args: ["-nocolor", "."],
			name: "Build",
		})
		assert.deepStrictEqual(workspaceTaskSpec("run"), {
			action: "run",
			args: ["-nocolor", "run", "."],
			name: "Run",
		})
		assert.deepStrictEqual(workspaceTaskSpec("test"), {
			action: "test",
			args: ["-nocolor", "test", "."],
			name: "Test",
		})
	})

	it("maps CodeLens actions to V task arguments", () => {
		assert.deepStrictEqual(codeLensTaskSpec("vls.runFile", "/tmp/main.v", ""), {
			action: "run",
			args: ["-nocolor", "run", "."],
			name: "Run Main",
		})
		assert.deepStrictEqual(codeLensTaskSpec("vls.runTests", "/tmp/main_test.v", ""), {
			action: "test",
			args: ["-nocolor", "test", "/tmp/main_test.v"],
			name: "Run Test File",
		})
		assert.deepStrictEqual(codeLensTaskSpec("vls.runTests", "/tmp/main_test.v", "test_one"), {
			action: "test",
			args: ["-nocolor", "test", "/tmp/main_test.v", "-run-only", "test_one"],
			name: "Run Test: test_one",
		})
	})

	it("saves dirty V buffers in the CodeLens workspace before running", () => {
		const target = "/workspace/app/main.v"
		const workspace = "/workspace"
		const document = (filePath: string, languageId = "v", isDirty = true) => ({
			filePath,
			languageId,
			isDirty,
		})

		assert.ok(shouldSaveTaskDocument(target, workspace, document(target)))
		assert.ok(shouldSaveTaskDocument(target, workspace, document("/workspace/app/sibling.v")))
		assert.ok(shouldSaveTaskDocument(target, workspace, document("/workspace/lib/imported.v")))
		assert.ok(
			shouldSaveTaskDocument(
				target,
				workspace,
				document("/workspace/tool.vsh", "shellscript"),
			),
		)
		assert.ok(
			!shouldSaveTaskDocument(
				target,
				workspace,
				document("/workspace/app/clean.v", "v", false),
			),
		)
		assert.ok(
			!shouldSaveTaskDocument(
				target,
				workspace,
				document("/workspace/notes.txt", "plaintext"),
			),
		)
		assert.ok(!shouldSaveTaskDocument(target, workspace, document("/other/workspace/dirty.v")))
	})

	it("limits standalone CodeLens saves to the target module tree", () => {
		const target = "/project/module/main.v"
		const dirtyVDocument = (filePath: string) => ({ filePath, languageId: "v", isDirty: true })

		assert.ok(
			shouldSaveTaskDocument(target, undefined, dirtyVDocument("/project/module/sibling.v")),
		)
		assert.ok(
			shouldSaveTaskDocument(
				target,
				undefined,
				dirtyVDocument("/project/module/lib/imported.v"),
			),
		)
		assert.ok(
			!shouldSaveTaskDocument(target, undefined, dirtyVDocument("/project/other/dirty.v")),
		)
	})

	it("uses the nearest V project root for standalone saves and coverage", () => {
		const target = "/project/cmd/app/main.v"
		const vmodExists = (filePath: string) => {
			return filePath === path.normalize("/project/v.mod")
		}
		const projectRoot = standaloneTaskScope(target, vmodExists)
		const dirtyImport = {
			filePath: "/project/lib/foo/foo.v",
			languageId: "v",
			isDirty: true,
		}

		assert.strictEqual(projectRoot, path.normalize("/project"))
		assert.strictEqual(taskCoverageRoot(target, undefined, vmodExists), projectRoot)
		assert.strictEqual(taskWorkingDirectory(target), path.normalize("/project/cmd/app"))
		assert.ok(shouldSaveTaskDocument(target, projectRoot, dirtyImport))
		assert.strictEqual(
			standaloneTaskScope(target, () => false),
			path.normalize("/project/cmd/app"),
		)
	})

	it("runs active V scripts directly", () => {
		assert.deepStrictEqual(activeRunTaskSpec("/workspace/tools/deploy.vsh", "/workspace"), {
			action: "run",
			args: ["-nocolor", "run", path.join("tools", "deploy.vsh")],
			name: "Run Active Script",
		})
		assert.deepStrictEqual(activeRunTaskSpec("/workspace/app/main.v", "/workspace"), {
			action: "run",
			args: ["-nocolor", "run", "app"],
			name: "Run Active Module",
		})
	})

	it("runs nested modules from the problem matcher base", () => {
		const filePath = path.join("/workspace", "cmd", "app", "main.v")
		const workingDirectory = taskWorkingDirectory(filePath, "/workspace")
		assert.strictEqual(workingDirectory, "/workspace")
		assert.deepStrictEqual(codeLensTaskSpec("vls.runFile", filePath, "", workingDirectory), {
			action: "run",
			args: ["-nocolor", "run", path.join("cmd", "app")],
			name: "Run Main",
		})
	})

	it("scopes and preserves the configured server compiler", () => {
		const configured = path.join("${workspaceFolder}", "bin", "v")
		assert.strictEqual(
			serverCommand(configured, "/workspace"),
			path.join("/workspace", "bin", "v"),
		)
		const missing = path.join("/missing", "custom-v")
		assert.strictEqual(serverCommand(missing, "/workspace"), missing)
	})
})
