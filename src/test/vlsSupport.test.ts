import * as assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"
import { MIN_VLS_REVISION, VLS_SUPPORT_BASELINE } from "../toolSupport"
import { requireSupportedVls, UnsupportedVlsError } from "../vlsSupport"

async function withInstallation(
	run: (root: string, executable: string, manifest: Record<string, unknown>) => Promise<void>,
): Promise<void> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "vscode-vlang-support-"))
	try {
		const directory = path.join(root, "tools", "vls-current")
		await fs.mkdir(directory, { recursive: true })
		const executable = path.join(directory, "vls")
		await fs.writeFile(executable, "verified VLS fixture")
		const manifest = {
			schemaVersion: 1,
			tool: "vls",
			revision: MIN_VLS_REVISION,
			executable: "vls",
			sha256: createHash("sha256").update("verified VLS fixture").digest("hex"),
			installedAt: "2026-10-05T00:00:00Z",
			vlsBaseline: VLS_SUPPORT_BASELINE,
		}
		await fs.writeFile(
			path.join(directory, ".vscode-vlang-installation.json"),
			JSON.stringify(manifest),
		)
		await run(root, executable, manifest)
	} finally {
		await fs.rm(root, { recursive: true, force: true })
	}
}

describe("supported VLS installations", () => {
	it("accepts an intact build verified against the current source baseline", async () => {
		await withInstallation(async (root, executable) => {
			assert.equal((await requireSupportedVls(executable, root)).revision, MIN_VLS_REVISION)
		})
	})

	it("rejects an old installation even when its binary hash is intact", async () => {
		await withInstallation(async (root, executable, manifest) => {
			delete (manifest as Record<string, unknown>).vlsBaseline
			manifest.revision = "436058d058b2ae9cb17d329d7b7f73ec129b2b8a"
			await fs.writeFile(
				path.join(path.dirname(executable), ".vscode-vlang-installation.json"),
				JSON.stringify(manifest),
			)
			await assert.rejects(requireSupportedVls(executable, root), UnsupportedVlsError)
		})
	})

	it("rejects a replaced binary instead of trusting its revision metadata", async () => {
		await withInstallation(async (root, executable) => {
			await fs.writeFile(executable, "older replacement")
			await assert.rejects(requireSupportedVls(executable, root), UnsupportedVlsError)
		})
	})

	it("rejects unversioned external executables", async () => {
		await withInstallation(async (root) => {
			const external = path.join(root, "external-vls")
			await fs.writeFile(external, "unversioned external VLS")
			await assert.rejects(requireSupportedVls(external, root), UnsupportedVlsError)
		})
	})
})
