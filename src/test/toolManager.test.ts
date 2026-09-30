import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, it } from "node:test"
import { ToolManager } from "../toolManager"
import { resetVscode, setSetting, state, Uri } from "./fixtures/vscode"

const latest = "b".repeat(40)
const originalFetch = globalThis.fetch
const originalPath = process.env.PATH
let root = ""
let requests: string[] = []

function executable(name: string, revision = latest.slice(0, 7)): string {
	const file = path.join(root, name)
	fs.writeFileSync(file, `#!/usr/bin/env node\nconsole.log("V 0.5.2 ${revision}")\n`)
	fs.chmodSync(file, 0o755)
	return file
}

function context() {
	const values = new Map<string, unknown>()
	return {
		globalStorageUri: Uri.file(path.join(root, "storage")),
		globalState: {
			get<T>(key: string, fallback?: T): T {
				return (values.get(key) as T | undefined) ?? (fallback as T)
			},
			async update(key: string, value: unknown) {
				values.set(key, value)
			},
		},
		values,
	}
}

function manager(contextValue: ReturnType<typeof context>): ToolManager {
	return new ToolManager(
		contextValue as unknown as ConstructorParameters<typeof ToolManager>[0],
		async (update) => update(),
	)
}

function fakeGitHub(failTool?: string): void {
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input)
		requests.push(url)
		if (failTool && url.includes(`/vlang/${failTool}/`)) {
			return { ok: false, status: 503, json: async () => ({}) } as Response
		}
		return {
			ok: true,
			status: 200,
			json: async () =>
				url.includes("/compare/")
					? { status: "diverged", ahead_by: 1, behind_by: 1 }
					: { sha: latest },
		} as Response
	}) as typeof fetch
}

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-vlang-manager-test-"))
	requests = []
	resetVscode()
	fakeGitHub()
})

afterEach(() => {
	globalThis.fetch = originalFetch
	process.env.PATH = originalPath
	fs.rmSync(root, { recursive: true, force: true })
})

describe("ToolManager VS Code adapter", () => {
	it("checks updates once daily for each effective configuration", async () => {
		const first = executable("v-first")
		const second = executable("v-second")
		setSetting("v.executablePath", first)
		setSetting("v.vls.enable", false)
		setSetting("v.tools.checkForUpdates", true)
		const owner = manager(context())
		try {
			await owner.check()
			await owner.check()
			assert.equal(requests.length, 1)
			setSetting("v.executablePath", second)
			await owner.check()
			assert.equal(requests.length, 2)
		} finally {
			owner.dispose()
		}
	})

	it("does not report both tools current when a manual check fails", async () => {
		const tool = executable("v-current")
		setSetting("v.executablePath", tool)
		setSetting("v.vls.command", tool)
		fakeGitHub("vls")
		const owner = manager(context())
		try {
			await owner.check(true)
			assert.ok(state.errors.some((message) => message.includes("GitHub returned HTTP 503")))
			assert.ok(
				!state.information.some((message) => message.includes("up to date with upstream")),
			)
		} finally {
			owner.dispose()
		}
	})

	it("shows an unknown external revision once after dismissal, but manual check overrides", async () => {
		setSetting("v.executablePath", executable("v-external", "aaaaaaa"))
		setSetting("v.vls.enable", false)
		const ownerContext = context()
		const owner = manager(ownerContext)
		try {
			await owner.check()
			assert.equal(
				state.information.filter((message) => message.includes("cannot be verified"))
					.length,
				1,
			)
			for (const key of ownerContext.values.keys()) {
				if (key.startsWith("tools.lastUpdateCheck.")) ownerContext.values.delete(key)
			}
			await owner.check()
			assert.equal(
				state.information.filter((message) => message.includes("cannot be verified"))
					.length,
				1,
			)
			await owner.check(true)
			assert.equal(
				state.information.filter((message) => message.includes("cannot be verified"))
					.length,
				2,
			)
		} finally {
			owner.dispose()
		}
	})

	it("reports compare rate limits without offering an unverified update", async () => {
		setSetting("v.executablePath", executable("v-rate-limited", "aaaaaaa"))
		setSetting("v.vls.enable", false)
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = String(input)
			requests.push(url)
			return url.includes("/compare/")
				? ({ ok: false, status: 429, json: async () => ({}) } as Response)
				: ({ ok: true, status: 200, json: async () => ({ sha: latest }) } as Response)
		}) as typeof fetch
		const owner = manager(context())
		try {
			await owner.check()
			assert.ok(state.logs.some((message) => message.includes("HTTP 429")))
			assert.ok(
				!state.information.some((message) => message.includes("Build the latest upstream")),
			)
			await owner.check(true)
			assert.ok(state.errors.some((message) => message.includes("HTTP 429")))
			assert.ok(
				!state.information.some((message) => message.includes("Build the latest upstream")),
			)
		} finally {
			owner.dispose()
		}
	})

	it("compares against the latest release on the release channel", async () => {
		const release = "c".repeat(40)
		setSetting("v.executablePath", executable("v-release", release.slice(0, 7)))
		setSetting("v.vls.enable", false)
		setSetting("v.tools.updateChannel", "release")
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = String(input)
			requests.push(url)
			const body = url.endsWith("/releases/latest")
				? { tag_name: "0.5.2" }
				: url.endsWith("/commits/0.5.2")
					? { sha: release }
					: { sha: latest }
			return { ok: true, status: 200, json: async () => body } as Response
		}) as typeof fetch
		const owner = manager(context())
		try {
			await owner.check(true)
			assert.deepEqual(requests, [
				"https://api.github.com/repos/vlang/v/releases/latest",
				"https://api.github.com/repos/vlang/v/commits/0.5.2",
			])
			assert.ok(
				state.information.some((message) =>
					message.includes("up to date with the latest release"),
				),
			)
		} finally {
			owner.dispose()
		}
	})

	it("keeps VLS on master when V follows releases", async () => {
		setSetting("v.vls.command", executable("vls-external"))
		setSetting("v.tools.updateChannel", "release")
		const owner = manager(context())
		try {
			await owner.check(true, "vls")
			assert.deepEqual(requests, ["https://api.github.com/repos/vlang/vls/commits/master"])
		} finally {
			owner.dispose()
		}
	})

	it("offers the release by its tag when the installed build is older", async () => {
		const release = "c".repeat(40)
		setSetting("v.executablePath", executable("v-old", "aaaaaaa"))
		setSetting("v.vls.enable", false)
		setSetting("v.tools.updateChannel", "release")
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = String(input)
			requests.push(url)
			const body = url.endsWith("/releases/latest")
				? { tag_name: "0.5.2" }
				: url.includes("/compare/")
					? { status: "ahead", ahead_by: 3, behind_by: 0 }
					: { sha: release }
			return { ok: true, status: 200, json: async () => body } as Response
		}) as typeof fetch
		const owner = manager(context())
		try {
			await owner.check(true)
			assert.ok(
				requests.includes(
					`https://api.github.com/repos/vlang/v/compare/aaaaaaa...${release}`,
				),
			)
			assert.ok(
				state.information.some(
					(message) =>
						message.startsWith("V 0.5.2 is available.") &&
						message.includes("Build V 0.5.2 in extension storage"),
				),
			)
		} finally {
			owner.dispose()
		}
	})

	it("prompts for a missing compiler even when update checks are disabled", async () => {
		setSetting("v.executablePath", path.join(root, "missing-v"))
		setSetting("v.vls.enable", false)
		setSetting("v.tools.checkForUpdates", false)
		const owner = manager(context())
		try {
			await owner.check()
			assert.ok(state.information.some((message) => message.includes("V was not found")))
			assert.deepEqual(requests, [])
			assert.deepEqual(state.updates, [])
		} finally {
			owner.dispose()
		}
	})

	it("keeps settings unchanged when an accepted installation fails", async () => {
		setSetting("v.executablePath", path.join(root, "missing-v"))
		setSetting("v.vls.enable", false)
		state.promptResponse = "Install and Use"
		process.env.PATH = root
		const owner = manager(context())
		try {
			await owner.check()
			assert.ok(state.errors.some((message) => message.startsWith("V:")))
			assert.deepEqual(state.updates, [])
			assert.equal(
				state.settings.get("v.executablePath")?.value,
				path.join(root, "missing-v"),
			)
		} finally {
			owner.dispose()
		}
	})
})
