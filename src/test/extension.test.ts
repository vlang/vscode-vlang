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

/** A platform-native absolute path from POSIX-shaped segments.
 *
 * Fixtures read better written `/project/cmd/app/main.v`, but the code under test
 * mixes `path.resolve`, which produces a drive-lettered absolute path on Windows,
 * with `path.normalize`, which does not. Passing a raw `/project` into both meant
 * three of these tests passed on Linux and failed on Windows, which CI could not
 * see because it only ran on `ubuntu-latest`.
 */
const fixture = (...segments: string[]): string => path.resolve(...segments)

const repositoryRoot = path.resolve(__dirname, "..", "..")

function readManifest(): Record<string, any> {
	return JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"))
}

/** Every `commands.registerCommand("<id>")` in `src/`.
 *
 * Reading the ids out of the source rather than listing them is the point: a test
 * that names the commands someone remembered cannot notice a new one being
 * registered and left undeclared.
 */
function registeredCommands(): Set<string> {
	const registered = new Set<string>()
	for (const file of fs.readdirSync(path.join(repositoryRoot, "src"), { encoding: "utf8" })) {
		if (!file.endsWith(".ts")) {
			continue
		}
		const contents = fs.readFileSync(path.join(repositoryRoot, "src", file), "utf8")
		for (const match of contents.matchAll(/registerCommand\("([^"]+)"/g)) {
			registered.add(match[1])
		}
	}
	return registered
}

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

	it("declares every registered command, and no command it does not register", () => {
		const declared = new Set<string>(
			readManifest().contributes.commands.map((entry: { command: string }) => entry.command),
		)
		const registered = registeredCommands()
		assert.ok(registered.size > 0, "no registered commands were found in src/")

		// `v.vls.openOutput` was registered but never declared, so it did not appear
		// in the Command Palette and could not be bound to a key.
		const undeclared = [...registered].filter((command) => !declared.has(command))
		assert.deepStrictEqual(undeclared, [], `commands not in contributes.commands: ${undeclared}`)
		// A declared command that nothing registers is a palette entry that silently
		// fails, which is the same class of bug from the other direction.
		const unused = [...declared].filter((command) => !registered.has(command))
		assert.deepStrictEqual(unused, [], `commands declared but never registered: ${unused}`)
	})

	it("declares every legacy setting the code still honours, with its replacement", () => {
		const properties = readManifest().contributes.configuration.properties
		const declared = new Set<string>(Object.keys(properties))

		// `migratedSetting` falls back to a `vls.*` key whenever the matching `v.*`
		// key is unset, so those keys keep working. They were never in the manifest,
		// so a user who set one was told "Unknown Configuration Setting" with no hint
		// about what to move to.
		const honoured = new Set<string>()
		for (const file of fs.readdirSync(path.join(repositoryRoot, "src"), { encoding: "utf8" })) {
			if (!file.endsWith(".ts")) {
				continue
			}
			const contents = fs.readFileSync(path.join(repositoryRoot, "src", file), "utf8")
			for (const match of contents.matchAll(
				/migratedSetting\(\s*"[^"]+",\s*"[^"]+",\s*"vls",\s*"([^"]+)"/g,
			)) {
				honoured.add(`vls.${match[1]}`)
			}
		}
		assert.ok(honoured.size > 0, "no legacy settings were found in src/")

		const undeclared = [...honoured].filter((key) => !declared.has(key))
		assert.deepStrictEqual(
			undeclared,
			[],
			`legacy settings honoured in code but missing from the manifest: ${undeclared}`,
		)
		// A deprecated setting that names no replacement leaves the user no next step.
		for (const key of honoured) {
			assert.ok(
				properties[key].markdownDeprecationMessage,
				`${key} is deprecated but does not say what replaced it`,
			)
		}
	})

	it("shows the notices of V in task output as information", () => {
		const packagePath = path.resolve(__dirname, "..", "..", "package.json")
		const manifest = JSON.parse(fs.readFileSync(packagePath, "utf8"))
		const matcher = manifest.contributes.problemMatchers.find((entry: { name: string }) => {
			return entry.name === "vls"
		})
		const pattern = new RegExp(matcher.pattern.regexp)
		// VS Code reads `error`, `warning` and `info` from the captured severity and
		// gives any other value, as the `notice` of V, the severity of the matcher, or
		// an error when the matcher sets none.
		const severityOf = (line: string): string => {
			const captured = pattern.exec(line)?.[matcher.pattern.severity]
			if (captured !== undefined && ["error", "warning", "info"].includes(captured)) {
				return captured
			}
			return matcher.severity ?? "error"
		}
		assert.strictEqual(severityOf("main.v:3:5: error: undefined ident: `x`"), "error")
		assert.strictEqual(severityOf("main.v:4:2: warning: unused variable: `y`"), "warning")
		assert.strictEqual(severityOf("lib/lib.v:7:7: notice: unused constant: `z`"), "info")
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
		const base = fixture("workspace")
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
			base,
		)

		// The profile is keyed by `canonicalFilePath`, which lowercases on Windows
		// because that filesystem is case-insensitive. Looking a key up any other way
		// finds nothing there, which is what made this test fail on Windows only.
		assert.deepStrictEqual(
			profile.get(canonicalFilePath(path.join(base, "src", "example.v"))),
			{
				covered: [3, 8],
				uncovered: [12],
			},
		)
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
		const target = fixture("project", "module", "main.v")
		const dirtyVDocument = (filePath: string) => ({ filePath, languageId: "v", isDirty: true })

		assert.ok(
			shouldSaveTaskDocument(target, undefined, dirtyVDocument(fixture("project", "module", "sibling.v"))),
		)
		assert.ok(
			shouldSaveTaskDocument(
				target,
				undefined,
				dirtyVDocument(fixture("project", "module", "lib", "imported.v")),
			),
		)
		assert.ok(
			!shouldSaveTaskDocument(target, undefined, dirtyVDocument(fixture("project", "other", "dirty.v"))),
		)
	})

	it("uses the nearest V project root for standalone saves and coverage", () => {
		const target = fixture("project", "cmd", "app", "main.v")
		// The v.mod probe is a stand-in for the filesystem, so it has to be handed the
		// same spelling the walk produces. On Windows those differ: `path.normalize`
		// leaves `/project/v.mod` as `\project\v.mod` while `path.dirname` on a
		// POSIX-shaped input still returns forward slashes.
		const vmod = fixture("project", "v.mod")
		const vmodExists = (filePath: string) => {
			return filePath === vmod
		}
		const projectRoot = standaloneTaskScope(target, vmodExists)
		const dirtyImport = {
			filePath: fixture("project", "lib", "foo", "foo.v"),
			languageId: "v",
			isDirty: true,
		}

		assert.strictEqual(projectRoot, fixture("project"))
		assert.strictEqual(taskCoverageRoot(target, undefined, vmodExists), projectRoot)
		assert.strictEqual(taskWorkingDirectory(target), fixture("project", "cmd", "app"))
		assert.ok(shouldSaveTaskDocument(target, projectRoot, dirtyImport))
		assert.strictEqual(standaloneTaskScope(target, () => false), fixture("project", "cmd", "app"))
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
		const base = fixture("workspace")
		const filePath = path.join(base, "cmd", "app", "main.v")
		const workingDirectory = taskWorkingDirectory(filePath, base)
		assert.strictEqual(workingDirectory, base)
		assert.deepStrictEqual(codeLensTaskSpec("vls.runFile", filePath, "", workingDirectory), {
			action: "run",
			args: ["-nocolor", "run", path.join("cmd", "app")],
			name: "Run Main",
		})
	})

	it("scopes and preserves the configured server compiler", () => {
		// The template keeps a forward slash so the placeholder is the only thing that
		// decides the spelling; `path.join` would bake in the host separator and the
		// two sides would then differ on Windows for no reason.
		const configured = "${workspaceFolder}/bin/v"
		assert.strictEqual(
			path.normalize(serverCommand(configured, "/workspace") ?? ""),
			path.normalize(path.join("/workspace", "bin", "v")),
		)
		const missing = path.join("/missing", "custom-v")
		assert.strictEqual(serverCommand(missing, "/workspace"), missing)
	})
})
