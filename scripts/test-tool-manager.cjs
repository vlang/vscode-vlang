const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { execFileSync } = require("node:child_process")
const esbuild = require("esbuild")

async function main() {
	const root = path.resolve(__dirname, "..")
	const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-vlang-tool-manager-"))
	try {
		const fixture = path.join(root, "src", "test", "fixtures", "vscode.ts")
		const tests = ["toolManager.test", "exec.test"]
		await esbuild.build({
			entryPoints: tests.map((name) => path.join(root, "src", "test", `${name}.ts`)),
			outdir: temporaryDirectory,
			outExtension: { ".js": ".cjs" },
			bundle: true,
			platform: "node",
			target: "node24",
			format: "cjs",
			plugins: [
				{
					name: "vscode-test-double",
					setup(build) {
						build.onResolve({ filter: /^vscode$/ }, () => ({ path: fixture }))
					},
				},
			],
		})
		execFileSync(
			process.execPath,
			["--test", ...tests.map((name) => path.join(temporaryDirectory, `${name}.cjs`))],
			{ stdio: "inherit" },
		)
	} finally {
		fs.rmSync(temporaryDirectory, { recursive: true, force: true })
	}
}

main().catch((error) => {
	console.error(error)
	process.exitCode = 1
})
