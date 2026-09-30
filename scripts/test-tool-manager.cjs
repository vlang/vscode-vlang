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
		const outfile = path.join(temporaryDirectory, "tool-manager.test.cjs")
		await esbuild.build({
			entryPoints: [path.join(root, "src", "test", "toolManager.test.ts")],
			outfile,
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
		execFileSync(process.execPath, ["--test", outfile], { stdio: "inherit" })
	} finally {
		fs.rmSync(temporaryDirectory, { recursive: true, force: true })
	}
}

main().catch((error) => {
	console.error(error)
	process.exitCode = 1
})
