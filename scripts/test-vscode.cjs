const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { execFileSync } = require("node:child_process")
const {
	downloadAndUnzipVSCode,
	resolveCliArgsFromVSCodeExecutablePath,
	runTests,
} = require("@vscode/test-electron")

async function main() {
	const root = path.resolve(__dirname, "..")
	const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-vlang-test-"))
	const workspace = path.join(temporaryDirectory, "workspace")
	fs.mkdirSync(path.join(workspace, ".vscode"), { recursive: true })
	fs.writeFileSync(
		path.join(workspace, ".vscode", "settings.json"),
		JSON.stringify(
			process.env.TEST_LEGACY_SETTINGS
				? {
					"vls.command": process.env.VLS_BINARY || path.join(os.homedir(), "code/vls/vls"),
					"vls.vCommand": process.env.V_BINARY || path.join(os.homedir(), "code/v/v"),
				}
				: {
					"v.vls.command": process.env.VLS_BINARY || path.join(os.homedir(), "code/vls/vls"),
					"v.executablePath": process.env.V_BINARY || path.join(os.homedir(), "code/v/v"),
					"v.vls.diagnostics": false,
				},
		),
	)
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
		const extensionsDirectory = path.join(temporaryDirectory, "extensions")
		const userDataDirectory = path.join(temporaryDirectory, "user-data")
		const cachePath = path.join(os.tmpdir(), "vscode-vlang-code")
		let vscodeExecutablePath = process.env.CODE_EXECUTABLE || undefined
		let extensionDevelopmentPath = root
		if (process.env.TEST_PACKAGED) {
			vscodeExecutablePath ||= await downloadAndUnzipVSCode({ cachePath })
			const [cli, ...cliArguments] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath)
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
			fs.writeFileSync(path.join(extensionDevelopmentPath, "extension.js"), "exports.activate = () => {}\n")
		}
		await runTests({
			cachePath,
			vscodeExecutablePath,
			extensionDevelopmentPath,
			extensionTestsPath: path.join(root, "out/test/vscode.integration.js"),
			extensionTestsEnv: {
				TEST_WORKSPACE: workspace,
				TEST_LEGACY_SETTINGS: process.env.TEST_LEGACY_SETTINGS,
			},
			launchArgs: [
				workspace,
				`--user-data-dir=${userDataDirectory}`,
				`--extensions-dir=${extensionsDirectory}`,
				"--no-sandbox",
				"--skip-welcome",
				"--skip-release-notes",
			],
		})
	} finally {
		fs.rmSync(temporaryDirectory, { recursive: true, force: true })
	}
}

main().catch((error) => {
	console.error(error)
	process.exitCode = 1
})
