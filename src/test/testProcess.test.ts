import * as assert from "assert"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { describe, it } from "node:test"
import { runTestProcess, type TestProcessToken } from "../testProcess"

function liveToken(): { token: TestProcessToken; cancel(): void } {
	const listeners = new Set<() => void>()
	return {
		token: {
			isCancellationRequested: false,
			onCancellationRequested(listener: () => void) {
				listeners.add(listener)
				return {
					dispose() {
						listeners.delete(listener)
					},
				}
			},
		},
		cancel() {
			for (const listener of [...listeners]) {
				listener()
			}
		},
	}
}

function idleToken(): TestProcessToken {
	return {
		isCancellationRequested: false,
		onCancellationRequested() {
			return { dispose() {} }
		},
	}
}

describe("test process", () => {
	it("captures output and the exit code of a failing run", async () => {
		// A failing `v test` still names its tests, so the output must survive
		// a non-zero exit rather than arriving as a rejection without it.
		const result = await runTestProcess(
			process.execPath,
			["-e", "console.log('out');console.error('err');process.exit(3)"],
			undefined,
			10_000,
			idleToken(),
		)
		assert.ok(result.stdout.includes("out"))
		assert.ok(result.stderr.includes("err"))
		assert.strictEqual(result.code, 3)
		assert.strictEqual(result.timedOut, false)
		assert.strictEqual(result.cancelled, false)
	})

	it("reports a timeout instead of waiting out a stuck run", async () => {
		const result = await runTestProcess(
			process.execPath,
			["-e", "setTimeout(() => {}, 30_000)"],
			undefined,
			200,
			idleToken(),
		)
		assert.strictEqual(result.timedOut, true)
		assert.strictEqual(result.cancelled, false)
		assert.strictEqual(result.code, null)
	})

	it("reports cancellation when the token fires", async () => {
		const { token, cancel } = liveToken()
		const pending = runTestProcess(
			process.execPath,
			["-e", "setTimeout(() => {}, 30_000)"],
			undefined,
			10_000,
			token,
		)
		setTimeout(cancel, 100)
		const result = await pending
		assert.strictEqual(result.cancelled, true)
		assert.strictEqual(result.timedOut, false)
	})

	it("kills the whole tree on cancellation, not just the compiler", async () => {
		// `v test` runs each compiled test as its own child: killing only the
		// parent orphans the test binary. The grandchild writes a marker late;
		// a tree kill means the marker never appears.
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vls-test-tree-"))
		try {
			const marker = path.join(directory, "grandchild-ran")
			const grandchild = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'), 800)`
			const script = [
				'const { spawn } = require("child_process");',
				`const grandchild = spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], { detached: true, stdio: "ignore" });`,
				"grandchild.unref();",
				"setTimeout(() => {}, 30_000);",
			].join("\n")
			const { token, cancel } = liveToken()
			const pending = runTestProcess(
				process.execPath,
				["-e", script],
				undefined,
				30_000,
				token,
			)
			setTimeout(cancel, 200)
			const result = await pending
			assert.strictEqual(result.cancelled, true)
			// Past the marker deadline: had the grandchild survived, the file
			// would exist now.
			await new Promise((resolve) => setTimeout(resolve, 1_500))
			assert.strictEqual(fs.existsSync(marker), false)
		} finally {
			fs.rmSync(directory, { recursive: true, force: true })
		}
	})

	it(
		"launches Windows batch files through the command interpreter",
		{ skip: process.platform !== "win32" },
		async () => {
			const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vls-test-bat-"))
			try {
				const launcher = path.join(directory, "vshim.bat")
				fs.writeFileSync(launcher, "@echo off\r\necho bat-output\r\n")
				const result = await runTestProcess(launcher, [], undefined, 10_000, idleToken())
				assert.ok(
					result.stdout.includes("bat-output"),
					`batch output missing: ${result.stdout}`,
				)
				assert.strictEqual(result.code, 0)
			} finally {
				fs.rmSync(directory, { recursive: true, force: true })
			}
		},
	)
})
