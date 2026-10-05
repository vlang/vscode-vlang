const assert = require("node:assert/strict")
const { createHash } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { execFileSync, spawnSync } = require("node:child_process")
const {
	downloadAndUnzipVSCode,
	resolveCliArgsFromVSCodeExecutablePath,
	runTests,
} = require("@vscode/test-electron")

function resolveExecutable(candidate) {
	if (candidate && (path.isAbsolute(candidate) || candidate.includes(path.sep))) {
		if (!fs.existsSync(candidate)) throw new Error(`Executable not found: ${candidate}`)
		return fs.realpathSync(candidate)
	}
	const command = candidate || "v"
	const lookup = spawnSync(process.platform === "win32" ? "where" : "which", [command], {
		encoding: "utf8",
	})
	if (lookup.status !== 0) {
		throw new Error(
			`Cannot find ${command}. Set V_BINARY to a V compiler path or add it to PATH.`,
		)
	}
	return lookup.stdout.trim().split(/\r?\n/)[0]
}

function verifyNotificationLogs(directory) {
	let checked = 0
	function visit(current) {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const file = path.join(current, entry.name)
			if (entry.isDirectory()) {
				visit(file)
			} else if (entry.isFile() && entry.name.endsWith(".log")) {
				checked++
				assert.doesNotMatch(
					fs.readFileSync(file, "utf8"),
					/Sending (?:notification workspace\/didChangeConfiguration|document notification \S+) failed/,
					`LSP notification failed during the host run: ${file}`,
				)
			}
		}
	}
	assert.ok(fs.existsSync(directory), "VS Code must create logs for the host run")
	visit(directory)
	assert.ok(checked, "The host must produce logs before notification errors can be checked")
	console.log("Host logs contain no failed VLS configuration or document notifications")
}

async function main() {
	// Codex itself may run inside a VS Code extension host. Those variables
	// would make the launched Electron executable behave like plain Node.
	delete process.env.ELECTRON_RUN_AS_NODE
	for (const key of Object.keys(process.env)) {
		if (key.startsWith("VSCODE_")) delete process.env[key]
	}
	const root = path.resolve(__dirname, "..")
	const vBinary = resolveExecutable(process.env.V_BINARY)
	const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-vlang-test-"))
	const workspace = path.join(temporaryDirectory, "workspace")
	const fakeVls = !process.env.VLS_BINARY
	const eventsPath = path.join(temporaryDirectory, "vls-events.jsonl")
	const extensionsDirectory = path.join(temporaryDirectory, "extensions")
	const userDataDirectory = path.join(temporaryDirectory, "user-data")
	const minimumVlsRevision = "4f668aa04e2568eb7ffdc6a02198ef14cec3e12a"
	const vlsRevision = process.env.VLS_REVISION || minimumVlsRevision
	assert.match(vlsRevision, /^[a-f\d]{40}$/, "VLS_REVISION must be a full source commit")
	// Each host run owns its installation and metadata. Copy the fixture's Node
	// executable too, so production provenance checks never trust a system binary.
	const vlsDirectory = path.join(
		userDataDirectory,
		"User",
		"globalStorage",
		"vlanguage.vscode-vlang",
		"tools",
		`vls-${vlsRevision}-integration`,
	)
	const managedVls = path.join(vlsDirectory, process.platform === "win32" ? "vls.exe" : "vls")
	const vlsManifest = path.join(vlsDirectory, ".vscode-vlang-installation.json")
	fs.mkdirSync(vlsDirectory, { recursive: true })
	fs.copyFileSync(
		fakeVls ? process.execPath : resolveExecutable(process.env.VLS_BINARY),
		managedVls,
	)
	fs.chmodSync(managedVls, 0o755)
	fs.writeFileSync(
		vlsManifest,
		JSON.stringify({
			schemaVersion: 1,
			tool: "vls",
			revision: vlsRevision,
			vlsBaseline: minimumVlsRevision,
			executable: path.basename(managedVls),
			sha256: createHash("sha256").update(fs.readFileSync(managedVls)).digest("hex"),
			installedAt: new Date().toISOString(),
		}),
	)
	fs.mkdirSync(path.join(workspace, ".vscode"), { recursive: true })
	const settings = {
		"v.executablePath": vBinary,
		"v.vls.command": managedVls,
		"v.vls.args": fakeVls ? [path.join(root, "scripts", "fixtures", "fake-vls.cjs")] : [],
		"v.vls.diagnostics": false,
	}
	if (process.env.TEST_LEGACY_SETTINGS) {
		settings["vls.vCommand"] = settings["v.executablePath"]
		settings["vls.command"] = settings["v.vls.command"]
		settings["vls.args"] = settings["v.vls.args"]
		settings["vls.diagnostics.enabled"] = settings["v.vls.diagnostics"]
		delete settings["v.executablePath"]
		delete settings["v.vls.command"]
		delete settings["v.vls.args"]
		delete settings["v.vls.diagnostics"]
	}
	fs.writeFileSync(path.join(workspace, ".vscode", "settings.json"), JSON.stringify(settings))
	fs.writeFileSync(
		path.join(workspace, "main.v"),
		"module main\n\nfn main() { println(add(1, 2)) }\n",
	)
	fs.writeFileSync(
		path.join(workspace, "helper.v"),
		"module main\n\nfn add(a int, b int) int { return a + b }\n",
	)
	fs.writeFileSync(
		path.join(workspace, "main_test.v"),
		"module main\n\nfn test_add() { assert add(1, 2) == 3 }\n",
	)

	try {
		fs.mkdirSync(path.join(userDataDirectory, "User"), { recursive: true })
		fs.writeFileSync(
			path.join(userDataDirectory, "User", "settings.json"),
			JSON.stringify({ "v.tools.checkForUpdates": false }),
		)
		const cachePath = path.join(os.tmpdir(), "vscode-vlang-code")
		let vscodeExecutablePath = process.env.CODE_EXECUTABLE || undefined
		let extensionDevelopmentPath = root
		if (process.env.TEST_PACKAGED) {
			vscodeExecutablePath ||= await downloadAndUnzipVSCode({ cachePath })
			const [cli, ...cliArguments] =
				resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath)
			const manifest = require(path.join(root, "package.json"))
			execFileSync(
				cli,
				[
					...cliArguments,
					"--install-extension",
					path.join(root, `${manifest.name}-${manifest.version}.vsix`),
					"--extensions-dir",
					extensionsDirectory,
					"--user-data-dir",
					userDataDirectory,
				],
				{ stdio: "inherit" },
			)
			extensionDevelopmentPath = path.join(temporaryDirectory, "test-runner")
			fs.mkdirSync(extensionDevelopmentPath)
			fs.writeFileSync(
				path.join(extensionDevelopmentPath, "package.json"),
				JSON.stringify({
					name: "vscode-vlang-test-runner",
					publisher: "local",
					version: "0.0.1",
					engines: { vscode: "^1.105.0" },
					main: "./extension.js",
				}),
			)
			fs.writeFileSync(
				path.join(extensionDevelopmentPath, "extension.js"),
				"exports.activate = () => {}\n",
			)
		}
		await runTests({
			cachePath,
			vscodeExecutablePath,
			extensionDevelopmentPath,
			extensionTestsPath: path.join(root, "out/test/vscode.integration.js"),
			extensionTestsEnv: {
				TEST_WORKSPACE: workspace,
				TEST_FAKE_VLS: fakeVls ? "1" : "",
				TEST_VLS_EVENTS: eventsPath,
				TEST_VLS_MANIFEST: vlsManifest,
				TEST_LEGACY_SETTINGS: process.env.TEST_LEGACY_SETTINGS || "",
			},
			launchArgs: [
				workspace,
				`--user-data-dir=${userDataDirectory}`,
				`--extensions-dir=${extensionsDirectory}`,
				"--no-sandbox",
				"--skip-welcome",
				"--skip-release-notes",
			],
		}).finally(() => verifyNotificationLogs(path.join(userDataDirectory, "logs")))
	} finally {
		fs.rmSync(temporaryDirectory, { recursive: true, force: true })
	}
}

main().catch((error) => {
	console.error(error)
	process.exitCode = 1
})
