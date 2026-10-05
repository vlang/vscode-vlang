import * as assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"
import { requireCurrentVCompiler, UnsupportedVCompilerError } from "../toolSupport"

async function fixture(run: (root: string) => Promise<void>): Promise<void> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "vscode-vlang-support-test-"))
	try {
		await run(root)
	} finally {
		await fs.rm(root, { recursive: true, force: true })
	}
}

describe("current V compiler support", () => {
	it("checks actual constrained-generic definitions in an isolated temporary source", async () => {
		await fixture(async (root) => {
			let probeDirectory = ""
			await requireCurrentVCompiler("/configured/V compiler", {
				directory: root,
				env: { VFLAGS: "-old-compiler", V_DIAGNOSTICS_SERVER: "1", CUSTOM: "kept" },
				run: async (command, args, options) => {
					assert.equal(command, "/configured/V compiler")
					assert.ok(args.includes("-new-compiler"))
					assert.ok(!args.includes("-old-compiler"))
					assert.equal(options.env?.VFLAGS, undefined)
					assert.equal(options.env?.V_DIAGNOSTICS_SERVER, undefined)
					assert.equal(options.env?.CUSTOM, "kept")
					assert.equal(options.env?.V_MACOS_V3_NO_FALLBACK, "1")
					probeDirectory = options.cwd
					assert.equal(path.dirname(probeDirectory), root)
					const file = args.at(-1)!
					const source = await fs.readFile(file, "utf8")
					assert.ok(source.includes("fn name_of[T Named](value T)"))
					return { stdout: "", stderr: `${file}:9:3\n` }
				},
			})
			assert.ok(probeDirectory)
			assert.deepEqual(await fs.readdir(root), [])
		})
	})

	it("rejects old compilers and unrelated answers instead of accepting a version string", async () => {
		await fixture(async (root) => {
			for (const output of [
				"V 0.5.2 3005dc3",
				"unknown option `-vls-mode`",
				"/another/program/main.v:9:3",
				"",
			]) {
				await assert.rejects(
					requireCurrentVCompiler("/old/v", {
						directory: root,
						run: async () => ({ stdout: output, stderr: "" }),
					}),
					(error: unknown) =>
						error instanceof UnsupportedVCompilerError &&
						error.message.includes("master"),
				)
				assert.deepEqual(await fs.readdir(root), [])
			}
		})
	})

	it("cleans the temporary fixture after compiler failure or a bounded timeout", async () => {
		await fixture(async (root) => {
			await assert.rejects(
				requireCurrentVCompiler("/stalled/v", {
					directory: root,
					run: async (_command, _args, options) => {
						assert.equal(options.timeoutMs, 20_000)
						throw new Error("v timed out.")
					},
				}),
				/required by VLS.*timed out/,
			)
			assert.deepEqual(await fs.readdir(root), [])
		})
	})

	it("preserves cancellation and removes the probe before returning", async () => {
		await fixture(async (root) => {
			const controller = new AbortController()
			await assert.rejects(
				requireCurrentVCompiler("/configured/v", {
					directory: root,
					signal: controller.signal,
					run: async () => {
						controller.abort()
						controller.signal.throwIfAborted()
						return { stdout: "", stderr: "" }
					},
				}),
				{ name: "AbortError" },
			)
			assert.deepEqual(await fs.readdir(root), [])
		})
	})
})
