import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, it } from "node:test"
import { ToolManager } from "../toolManager"
import { MIN_VLS_REVISION } from "../toolVersions"
import { resetVscode, setSetting, state, Uri } from "./fixtures/vscode"

const latest = "b".repeat(40)
const originalFetch = globalThis.fetch
const originalPath = process.env.PATH
const originalHome = process.env.HOME
let root = ""
let requests: string[] = []
let upstreamVlsVersion = "0.0.3"

function executable(name: string, revision = latest.slice(0, 7)): string {
	const file = path.join(root, name)
	fs.writeFileSync(file, `#!/usr/bin/env node\nconsole.log("V 0.5.2 ${revision}")\n`)
	fs.chmodSync(file, 0o755)
	return file
}

function vlsExecutable(version: string): string {
	const file = path.join(root, `vls-${version}`)
	fs.writeFileSync(file, `#!/usr/bin/env node\nconsole.log("VLS ${version}")\n`)
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
				if (value === undefined) values.delete(key)
				else values.set(key, value)
			},
		},
		values,
	}
}

function manager(
	contextValue: ReturnType<typeof context>,
	vlsRejected?: () => Promise<boolean>,
): ToolManager {
	return new ToolManager(
		contextValue as unknown as ConstructorParameters<typeof ToolManager>[0],
		async (update) => update(),
		vlsRejected,
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
			text: async () => `const vls_version = '${upstreamVlsVersion}'\n`,
		} as Response
	}) as typeof fetch
}

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-vlang-manager-test-"))
	requests = []
	upstreamVlsVersion = "0.0.3"
	resetVscode()
	fakeGitHub()
})

afterEach(() => {
	globalThis.fetch = originalFetch
	process.env.PATH = originalPath
	process.env.HOME = originalHome
	delete process.env.VSCODE_VLANG_TEST_ROOT
	fs.rmSync(root, { recursive: true, force: true })
})

describe("ToolManager VS Code adapter", () => {
	it("keeps a supported externally installed VLS without offering managed adoption", async () => {
		const binary = vlsExecutable("0.0.3")
		setSetting("v.vls.command", binary)
		const owner = manager(context())
		try {
			await owner.check(false, "vls")
			assert.deepEqual(requests, [])
			await owner.check(true, "vls")
			assert.deepEqual(requests, [
				"https://api.github.com/repos/vlang/vls/commits/master",
				`https://raw.githubusercontent.com/vlang/vls/${latest}/main.v`,
			])
			assert.deepEqual(state.updates, [])
			assert.ok(
				state.information.some((message) =>
					message.includes("reports the latest upstream version"),
				),
			)
			assert.ok(!state.information.some((message) => message.includes("Build the latest")))
			assert.ok(!state.information.some((message) => message.includes("up to date")))
			assert.equal(state.settings.get("v.vls.command")?.value, binary)
		} finally {
			owner.dispose()
		}
	})

	it("leaves an unsupported VLS to the server's startup error unless run manually", async () => {
		setSetting("v.vls.command", vlsExecutable("0.0.2"))
		const owner = manager(context(), async () => true)
		const offers = () =>
			state.information.filter((message) => message.includes("older than 0.0.3")).length
		try {
			await owner.check(false, "vls")
			assert.equal(offers(), 0)
			await owner.check(true, "vls")
			assert.equal(offers(), 1)
		} finally {
			owner.dispose()
		}
	})

	it("offers a newer upstream VLS version on a manual check", async () => {
		setSetting("v.vls.command", vlsExecutable("0.0.3"))
		upstreamVlsVersion = "0.0.4"
		const owner = manager(context())
		try {
			await owner.check(true, "vls")
			assert.ok(
				state.information.some((message) =>
					message.startsWith("VLS 0.0.4 is available (installed: 0.0.3)."),
				),
			)
		} finally {
			owner.dispose()
		}
	})

	it("still offers installation for an unsupported external VLS version", async () => {
		const binary = vlsExecutable("0.0.2")
		setSetting("v.vls.command", binary)
		const owner = manager(context())
		try {
			await owner.check(true, "vls")
			assert.ok(
				state.information.some((message) =>
					message.startsWith(
						"The installed VLS is older than 0.0.3 or does not report its version.",
					),
				),
			)
			assert.ok(state.information.some((message) => message.includes("Build the latest")))
			assert.deepEqual(state.updates, [])
		} finally {
			owner.dispose()
		}
	})

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

	it("offers to rebuild an unstamped managed VLS even when its revision is current", async () => {
		const ownerContext = context()
		const directory = path.join(ownerContext.globalStorageUri.fsPath, "tools", "vls-unstamped")
		fs.mkdirSync(directory, { recursive: true })
		const binary = path.join(directory, "vls")
		const content = "#!/usr/bin/env node\nconsole.log('old installation')\n"
		fs.writeFileSync(binary, content)
		fs.chmodSync(binary, 0o755)
		fs.writeFileSync(
			path.join(directory, ".vscode-vlang-installation.json"),
			JSON.stringify({
				schemaVersion: 1,
				tool: "vls",
				revision: latest,
				executable: "vls",
				sha256: createHash("sha256").update(content).digest("hex"),
				installedAt: new Date().toISOString(),
			}),
		)
		setSetting("v.vls.command", binary)
		const owner = manager(ownerContext)
		try {
			await owner.check(true, "vls")
			assert.ok(state.information.some((message) => message.includes("older than 0.0.3")))
			assert.ok(
				!state.information.some((message) => message.includes("up to date with upstream")),
			)
			assert.equal(fs.readFileSync(binary, "utf8"), content)
		} finally {
			owner.dispose()
		}
	})

	it("keeps an unstamped managed VLS when its source ancestry proves support", async () => {
		const ownerContext = context()
		const directory = path.join(ownerContext.globalStorageUri.fsPath, "tools", "vls-unstamped")
		fs.mkdirSync(directory, { recursive: true })
		const binary = path.join(directory, "vls")
		const content = "#!/usr/bin/env node\nconsole.log('unversioned VLS')\n"
		fs.writeFileSync(binary, content)
		fs.chmodSync(binary, 0o755)
		fs.writeFileSync(
			path.join(directory, ".vscode-vlang-installation.json"),
			JSON.stringify({
				schemaVersion: 1,
				tool: "vls",
				revision: latest,
				executable: "vls",
				sha256: createHash("sha256").update(content).digest("hex"),
				installedAt: new Date().toISOString(),
			}),
		)
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = String(input)
			requests.push(url)
			return {
				ok: true,
				status: 200,
				json: async () =>
					url.endsWith(`/compare/${MIN_VLS_REVISION}...${latest}`)
						? { status: "ahead", ahead_by: 1, behind_by: 0 }
						: { sha: latest },
			} as Response
		}) as typeof fetch
		setSetting("v.vls.command", binary)
		const owner = manager(ownerContext)
		try {
			await owner.check(true, "vls")
			assert.ok(state.information.some((message) => message.includes("up to date")))
			assert.ok(!state.information.some((message) => message.includes("Build the latest")))
			assert.deepEqual(state.updates, [])
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
			ownerContext.values.delete("tools.lastUpdateChecks")
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

	it("prefers this machine's managed V over PATH while the setting is automatic", async () => {
		const ownerContext = context()
		const managed = executable("v-managed")
		fs.mkdirSync(path.join(root, "bin"))
		const onPath = path.join(root, "bin", "v")
		fs.copyFileSync(executable("v-path", "aaaaaaa"), onPath)
		fs.chmodSync(onPath, 0o755)
		process.env.PATH = `${path.join(root, "bin")}${path.delimiter}${originalPath}`
		ownerContext.values.set("tools.managed.v", managed)
		setSetting("v.vls.enable", false)
		const owner = manager(ownerContext)
		try {
			await owner.check(true, "v")
			assert.deepEqual(requests, ["https://api.github.com/repos/vlang/v/commits/master"])
			assert.ok(state.information.some((message) => message.includes("up to date")))
			setSetting("v.executablePath", onPath)
			await owner.check(true, "v")
			assert.ok(requests.some((url) => url.includes("/compare/aaaaaaa...")))
		} finally {
			owner.dispose()
		}
	})

	it("selects managed builds without writing paths to settings and removes the replaced one", async () => {
		const ownerContext = context()
		const owner = manager(ownerContext) as unknown as {
			inspect(tool: string): Promise<unknown>
			use(tool: string, executable: string, previous: unknown): Promise<void>
			cleanUp(): Promise<void>
			dispose(): void
		}
		const installation = (name: string) => {
			const directory = path.join(ownerContext.globalStorageUri.fsPath, "tools", name)
			fs.mkdirSync(directory, { recursive: true })
			const file = path.join(directory, "v")
			fs.writeFileSync(file, "#!/bin/sh\n")
			fs.chmodSync(file, 0o755)
			return file
		}
		try {
			const first = installation("v-aaaaaa")
			await owner.use("v", first, await owner.inspect("v"))
			assert.deepEqual(state.updates, [])
			assert.equal(ownerContext.values.get("tools.managed.v"), first)

			setSetting("v.executablePath", "/opt/custom/v", "workspace")
			const second = installation("v-bbbbbb")
			await owner.use("v", second, await owner.inspect("v"))
			await owner.cleanUp()
			assert.deepEqual(state.settings.get("v.executablePath"), {
				value: "v",
				scope: "workspace",
			})
			assert.equal(ownerContext.values.get("tools.managed.v"), second)
			assert.ok(!fs.existsSync(path.dirname(first)))
			assert.ok(fs.existsSync(second))
			assert.deepEqual(ownerContext.values.get("tools.retired"), [])
		} finally {
			owner.dispose()
		}
	})

	it("retries removing a replaced installation on the next activation", async (t) => {
		if (process.platform === "win32" || process.getuid?.() === 0)
			return t.skip("needs POSIX permissions that apply to this user")
		const ownerContext = context()
		const tools = path.join(ownerContext.globalStorageUri.fsPath, "tools")
		const replaced = path.join(tools, "vls-aaaaaa")
		fs.mkdirSync(replaced, { recursive: true })
		ownerContext.values.set("tools.retired", [replaced])
		// Like a running executable on Windows, the directory cannot be moved yet.
		fs.chmodSync(tools, 0o555)
		const first = manager(ownerContext) as unknown as {
			cleanUp(): Promise<void>
			dispose(): void
		}
		try {
			await first.cleanUp()
			assert.ok(fs.existsSync(replaced))
			assert.deepEqual(ownerContext.values.get("tools.retired"), [replaced])
		} finally {
			fs.chmodSync(tools, 0o755)
			first.dispose()
		}
		const second = manager(ownerContext) as unknown as {
			cleanUp(): Promise<void>
			dispose(): void
		}
		try {
			await second.cleanUp()
			assert.ok(!fs.existsSync(replaced))
			assert.deepEqual(ownerContext.values.get("tools.retired"), [])
		} finally {
			second.dispose()
		}
	})

	it("explains why a manual request waits for an unanswered prompt", async () => {
		setSetting("v.executablePath", path.join(root, "missing-v"))
		setSetting("v.vls.enable", false)
		let answer: (value: string | undefined) => void = () => undefined
		state.promptResponse = new Promise<string | undefined>((resolve) => {
			answer = resolve
		}) as unknown as string
		const owner = manager(context())
		try {
			const automatic = owner.check()
			for (let index = 0; index < 100 && state.prompts === 0; index++)
				await new Promise((resolve) => setImmediate(resolve))
			assert.equal(state.prompts, 1)
			state.promptResponse = "Later"
			const manual = owner.check(true, "v")
			assert.ok(
				state.information.some((message) => message.includes("waiting for your answer")),
			)
			answer("Later")
			await automatic
			await manual
			assert.equal(
				state.information.filter((message) => message.includes("V was not found")).length,
				2,
			)
		} finally {
			owner.dispose()
		}
	})

	it("remembers a declined missing-tool prompt until a manual check", async () => {
		setSetting("v.executablePath", path.join(root, "missing-v"))
		setSetting("v.vls.enable", false)
		const owner = manager(context())
		const prompts = () =>
			state.information.filter((message) => message.includes("V was not found")).length
		try {
			await owner.check()
			await owner.check()
			assert.equal(prompts(), 1)
			await owner.check(true)
			assert.equal(prompts(), 2)
		} finally {
			owner.dispose()
		}
	})

	it("retries an unavailable automatic check on the next activation", async () => {
		setSetting("v.executablePath", executable("v-offline"))
		setSetting("v.vls.enable", false)
		fakeGitHub("v")
		const owner = manager(context())
		try {
			await owner.check()
			await owner.check()
			assert.equal(requests.length, 2)
			assert.deepEqual(state.errors, [])
		} finally {
			owner.dispose()
		}
	})

	it("asks for missing V when VLS needs it, even after V was declined", async () => {
		setSetting("v.executablePath", path.join(root, "missing-v"))
		setSetting("v.vls.command", path.join(root, "missing-vls"))
		const owner = manager(context())
		const vPrompts = () =>
			state.information.filter((message) => message.startsWith("V was not found")).length
		try {
			await owner.check(false, "v")
			assert.equal(vPrompts(), 1)
			// Building fails quickly without Git; only the prompts matter here.
			process.env.PATH = path.join(root, "empty")
			state.promptResponse = "Install and Use"
			await owner.check(false, "vls")
			assert.ok(
				state.information.some((message) =>
					message.startsWith("V was not found, and VLS needs it to build."),
				),
			)
			assert.ok(!state.errors.some((message) => message.includes("Install V first")))
		} finally {
			owner.dispose()
		}
	})

	it("inspects an unstamped managed VLS 0.0.3 without GitHub", async () => {
		const ownerContext = context()
		const directory = path.join(ownerContext.globalStorageUri.fsPath, "tools", "vls-legacy")
		fs.mkdirSync(directory, { recursive: true })
		const binary = path.join(directory, "vls")
		const content = "#!/usr/bin/env node\nconsole.log('VLS 0.0.3')\n"
		fs.writeFileSync(binary, content)
		fs.chmodSync(binary, 0o755)
		fs.writeFileSync(
			path.join(directory, ".vscode-vlang-installation.json"),
			JSON.stringify({
				schemaVersion: 1,
				tool: "vls",
				revision: "e".repeat(40),
				executable: "vls",
				sha256: createHash("sha256").update(content).digest("hex"),
				installedAt: new Date().toISOString(),
			}),
		)
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			requests.push(String(input))
			throw new TypeError("fetch failed")
		}) as typeof fetch
		setSetting("v.vls.command", binary)
		setSetting("v.tools.checkForUpdates", false)
		const owner = manager(ownerContext)
		try {
			await owner.check(false, "vls")
			assert.deepEqual(requests, [])
			assert.ok(!state.logs.some((message) => message.includes("fetch failed")))
		} finally {
			owner.dispose()
		}
	})
})
