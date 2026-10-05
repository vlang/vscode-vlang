import * as assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"
import { requireSupportedVls, UnsupportedVlsError } from "../vlsSupport"

describe("supported VLS installations", () => {
	it("accepts supported semantic versions, managed or external alike", async () => {
		for (const version of [
			"0.0.3",
			"0.0.3+package.1",
			"0.0.10",
			"0.1.0",
			"1.0.0",
			"0.0.4-rc.1",
		]) {
			assert.deepEqual(
				await requireSupportedVls("/any/vls", {
					readIdentity: async () => ({ version }),
				}),
				{ version },
			)
		}
	})

	it("rejects old, prerelease-minimum and unidentified installations", async () => {
		for (const version of [undefined, "0.0.2", "0.0.3-rc.1", "0.0.3-dev", "0.0.02", "master"]) {
			await assert.rejects(
				requireSupportedVls("/any/vls", {
					readIdentity: async () => (version ? { version } : undefined),
				}),
				UnsupportedVlsError,
			)
		}
	})

	it("reads the version from the executable with its configured launcher arguments", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "vscode-vlang-support-"))
		try {
			const launcher = path.join(root, "vls.js")
			await fs.writeFile(
				launcher,
				"if (process.argv.at(-1) === '--version') console.log('VLS 0.0.3')\n",
			)
			assert.deepEqual(await requireSupportedVls(process.execPath, { args: [launcher] }), {
				version: "0.0.3",
			})
			const unversioned = path.join(root, "old-vls.js")
			await fs.writeFile(unversioned, "")
			await assert.rejects(
				requireSupportedVls(process.execPath, { args: [unversioned] }),
				UnsupportedVlsError,
			)
		} finally {
			await fs.rm(root, { recursive: true, force: true })
		}
	})

	it("propagates cancellation rather than reporting an unsupported server", async () => {
		const controller = new AbortController()
		await assert.rejects(
			requireSupportedVls("/any/vls", {
				signal: controller.signal,
				readIdentity: async () => {
					controller.abort()
					return undefined
				},
			}),
			{ name: "AbortError" },
		)
	})
})
