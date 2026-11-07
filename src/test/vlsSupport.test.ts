import * as assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"
import { requireSupportedVls, UnsupportedVlsError } from "../vlsSupport"

async function rejection(action: () => Promise<unknown>): Promise<UnsupportedVlsError> {
	try {
		await action()
	} catch (error) {
		assert.ok(error instanceof UnsupportedVlsError, `unexpected ${String(error)}`)
		return error
	}
	return assert.fail("the gate must reject the server")
}

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

	it("accepts another server that reports a version of its own", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "vscode-vlang-velvet-"))
		try {
			const velvet = path.join(root, "velvet.cjs")
			await fs.writeFile(
				velvet,
				"if (process.argv.at(-1) === '--version')" +
					" console.log('velvet version 0.8.5+abc1234')\n",
			)
			assert.deepEqual(await requireSupportedVls(process.execPath, { args: [velvet] }), {
				name: "velvet",
				version: "0.8.5+abc1234",
			})
		} finally {
			await fs.rm(root, { recursive: true, force: true })
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

	it("refuses another server reporting a version below the minimum", async () => {
		const error = await rejection(() =>
			requireSupportedVls("/custom/velvet", {
				readIdentity: async () => ({ name: "velvet", version: "0.0.2" }),
			}),
		)
		assert.match(error.message, /\/custom\/velvet/)
		assert.match(error.message, /velvet 0\.0\.2/)
		assert.match(error.message, /0\.0\.3/)
		// The install command would replace the server the user configured.
		assert.equal(error.updatable, false)
	})

	it("names the command it ran and offers no install for an unidentifiable server", async () => {
		const error = await rejection(() =>
			requireSupportedVls("/custom/velvet", { readIdentity: async () => undefined }),
		)
		assert.match(error.message, /\/custom\/velvet --version/)
		assert.match(error.message, /VLS <version>.*<name> version <version>/)
		assert.match(error.message, /v\.vls\.command/)
		assert.equal(error.updatable, false)
	})

	it("still offers the update for an outdated VLS it identified", async () => {
		const error = await rejection(() =>
			requireSupportedVls("/managed/vls", {
				readIdentity: async () => ({ name: "VLS", version: "0.0.2" }),
			}),
		)
		assert.equal(error.updatable, true)
		assert.match(error.message, /VLS 0\.0\.2/)
		assert.match(error.message, /Install or Update VLS/)
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
				name: "VLS",
				version: "0.0.3",
			})
			const unversioned = path.join(root, "old-vls.js")
			await fs.writeFile(unversioned, "")
			const error = await rejection(() =>
				requireSupportedVls(process.execPath, { args: [unversioned] }),
			)
			assert.ok(
				error.message.includes(`${process.execPath} --version`),
				`message names the command: ${error.message}`,
			)
			assert.equal(error.updatable, false)
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
