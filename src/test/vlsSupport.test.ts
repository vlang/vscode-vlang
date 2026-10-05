import * as assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"
import { MIN_VLS_REVISION, VLS_SUPPORT_BASELINE } from "../toolVersions"
import {
	requireSupportedVls,
	UnsupportedVlsError,
	VlsVerificationUnavailableError,
} from "../vlsSupport"

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
			assert.equal(
				(
					await requireSupportedVls(executable, root, {
						readIdentity: async () =>
							assert.fail("Managed baseline needs no CLI request"),
					})
				).revision,
				MIN_VLS_REVISION,
			)
		})
	})

	it("accepts the exact baseline from older managed metadata without a baseline stamp", async () => {
		await withInstallation(async (root, executable, manifest) => {
			delete manifest.vlsBaseline
			await fs.writeFile(
				path.join(path.dirname(executable), ".vscode-vlang-installation.json"),
				JSON.stringify(manifest),
			)
			assert.equal(
				(
					await requireSupportedVls(executable, root, {
						readIdentity: async () => assert.fail("Exact source revision needs no CLI"),
					})
				).revision,
				MIN_VLS_REVISION,
			)
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
			await assert.rejects(
				requireSupportedVls(executable, root, {
					readIdentity: async () => undefined,
					fetcher: async () =>
						new Response(
							JSON.stringify({ status: "behind", ahead_by: 0, behind_by: 3 }),
						),
				}),
				UnsupportedVlsError,
			)
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

	it("accepts externally installed supported semantic versions without GitHub or managed metadata", async () => {
		for (const version of [
			"0.0.3",
			"0.0.3+package.1",
			"0.0.10",
			"0.1.0",
			"1.0.0",
			"0.0.4-rc.1",
		]) {
			assert.deepEqual(
				await requireSupportedVls("/external/vls", "/managed/storage", {
					readIdentity: async () => ({ version }),
					fetcher: async () => assert.fail("Supported version must not require GitHub"),
				}),
				{ version },
			)
		}
	})

	it("rejects old, prerelease-minimum and unidentified external installations", async () => {
		for (const version of [undefined, "0.0.2", "0.0.3-rc.1", "0.0.3-dev", "0.0.02", "master"]) {
			await assert.rejects(
				requireSupportedVls("/external/vls", "/managed/storage", {
					readIdentity: async () => (version ? { version } : undefined),
					fetcher: async () => assert.fail("No source identity to compare"),
				}),
				UnsupportedVlsError,
			)
		}
	})

	it("accepts the minimum source identity independently of its old semantic version", async () => {
		for (const revision of [MIN_VLS_REVISION, MIN_VLS_REVISION.slice(0, 7)]) {
			assert.deepEqual(
				await requireSupportedVls("/external/vls", "/managed/storage", {
					readIdentity: async () => ({ version: "0.0.2", revision }),
					fetcher: async () => assert.fail("Exact baseline needs no GitHub"),
				}),
				{ version: "0.0.2", revision },
			)
		}
	})

	it("requires proof of source ancestry for a different reported commit", async () => {
		const revision = "a".repeat(40)
		for (const supported of [true, false]) {
			const pending = requireSupportedVls(`/external/vls-${supported}`, "/managed/storage", {
				readIdentity: async () => ({ revision }),
				fetcher: async (url) => {
					assert.equal(
						url,
						`https://api.github.com/repos/vlang/vls/compare/${MIN_VLS_REVISION}...${revision}`,
					)
					return new Response(
						JSON.stringify(
							supported
								? { status: "ahead", ahead_by: 2, behind_by: 0 }
								: { status: "behind", ahead_by: 0, behind_by: 2 },
						),
					)
				},
			})
			if (supported) assert.deepEqual(await pending, { revision })
			else await assert.rejects(pending, UnsupportedVlsError)
		}
	})

	it("reports an unavailable ancestry check instead of an unsupported server", async () => {
		const revision = "c".repeat(40)
		const pending = requireSupportedVls("/offline/vls", "/managed/storage", {
			readIdentity: async () => ({ revision }),
			fetcher: async () => {
				throw new TypeError("fetch failed")
			},
		})
		await assert.rejects(pending, (error: unknown) => {
			assert.ok(error instanceof VlsVerificationUnavailableError)
			assert.ok(!(error instanceof UnsupportedVlsError))
			assert.match(error.message, /Could not verify that VLS ccccccc.*fetch failed/)
			return true
		})
	})

	it("does not prompt to update a supported external replacement merely because its managed hash changed", async () => {
		await withInstallation(async (root, executable) => {
			await fs.writeFile(executable, "external updated binary")
			assert.deepEqual(
				await requireSupportedVls(executable, root, {
					readIdentity: async () => ({ version: "0.0.3" }),
				}),
				{ version: "0.0.3" },
			)
		})
	})

	it("propagates cancellation rather than reporting an unsupported server", async () => {
		const controller = new AbortController()
		await assert.rejects(
			requireSupportedVls("/external/vls", "/managed/storage", {
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
