// Measure coverage of the source modules, without the test files.
//
// The suite is bundled first (see the `coverage` npm script), then `node --test`
// is run here rather than from a shell. The coverage excludes are passed as argv
// entries: `--test-coverage-exclude='**/*.test.ts'` only loses its quotes where the
// shell strips them, so on Windows the pattern keeps them and excludes nothing,
// which silently reports a different number there than on Linux.

const { spawnSync } = require("child_process")
const path = require("path")

const entryPoint = path.join(__dirname, "..", "out", "test")
const bundles = require("fs")
	.readdirSync(entryPoint)
	.filter((name) => name.endsWith(".test.js"))
	.map((name) => path.join(entryPoint, name))
	.sort()

if (bundles.length === 0) {
	console.error("No test bundles found. Run the build step first.")
	process.exit(1)
}

const result = spawnSync(
	process.execPath,
	[
		"--test",
		"--experimental-test-coverage",
		"--enable-source-maps",
		// Every suite is bundled, so a test file's own lines are counted twice over:
		// once in its bundle and once against the module it exercises.
		"--test-coverage-exclude=**/*.test.ts",
		// The vscode stand-in is exercised through whatever module imports it, so
		// its own high numbers say nothing about the extension.
		"--test-coverage-exclude=**/fixtures/**",
		...bundles,
	],
	{ stdio: "inherit" },
)

process.exit(result.status ?? 1)
