import * as assert from "assert"
import { execFileSync } from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { describe, it } from "node:test"
import {
	classifyCompareResponse,
	compareVersions,
	getLatestRelease,
	getLatestRevision,
	getUpdateStatus,
	getUpstreamVlsVersion,
	isSupportedVlsVersion,
	parseVlsIdentity,
	parseVRevision,
	readVlsIdentity,
	readVRevision,
} from "../toolVersions"

const latest = "b583c013c8c57e892893cac9498a4715bc0647ea"
const previous = "7647ce1c6fad63b5578bc07883139906de74b2f8"

function response(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status })
}

describe("tool revision checks", () => {
	it("reads compiler revisions without treating semantic versions as build identity", () => {
		assert.strictEqual(parseVRevision("V 0.5.2 b583c01\n"), "b583c01")
		assert.strictEqual(parseVRevision(`V 0.5.2 ${latest.toUpperCase()}`), latest)
		assert.strictEqual(parseVRevision("V 0.5.2-dev abc1234"), "abc1234")
		assert.strictEqual(parseVRevision("V 0.5.2 abc1234.b583c01"), "b583c01")
		for (const invalid of [
			"V 0.5.2",
			"VLS 0.0.2",
			"V 0.5.2 unknown",
			"V 0.5.2 abc123",
			"V 0.5.2 abc1234-dirty",
			"V 0.5.2 abc1234\nextra output",
		]) {
			assert.strictEqual(parseVRevision(invalid), undefined)
		}
	})

	it("compares VLS semantic versions numerically and observes prerelease precedence", () => {
		for (const version of [
			"0.0.3",
			"0.0.3+package.1",
			"0.0.10",
			"0.1.0",
			"1.0.0",
			"0.0.4-rc.1",
		]) {
			assert.equal(isSupportedVlsVersion(version), true, version)
		}
		for (const version of [
			undefined,
			"0.0.2",
			"0.0.3-rc.1",
			"0.0.3-dev",
			"0.0.4-01",
			"0.00.3",
			"0.0.03",
			"0.0.3.1",
			"master",
			"9007199254740992.0.0",
		]) {
			assert.equal(isSupportedVlsVersion(version), false, version)
		}
	})

	it("orders versions by semantic version precedence", () => {
		const ordered = [
			"0.0.3-alpha",
			"0.0.3-alpha.1",
			"0.0.3-alpha.beta",
			"0.0.3-beta.2",
			"0.0.3-beta.11",
			"0.0.3",
			"0.0.4",
			"0.1.0",
		]
		for (let index = 1; index < ordered.length; index++) {
			assert.equal(compareVersions(ordered[index - 1]!, ordered[index]!), -1)
			assert.equal(compareVersions(ordered[index]!, ordered[index - 1]!), 1)
		}
		assert.equal(compareVersions("0.0.3+build.1", "0.0.3"), 0)
		assert.equal(compareVersions("0.0.3", "master"), undefined)
	})

	it("reads the version constant upstream VLS declares in its source", async () => {
		const urls: string[] = []
		const source =
			(text: string, status = 200) =>
			async (url: string) => {
				urls.push(url)
				return new Response(text, { status })
			}
		assert.equal(
			await getUpstreamVlsVersion(
				latest,
				undefined,
				source(
					"const vls_version = '0.0.3'\n\nserver_info: ServerInfo{\n\tname: 'vls'\n\tversion: vls_version\n}",
				),
			),
			"0.0.3",
		)
		assert.deepEqual(urls, [`https://raw.githubusercontent.com/vlang/vls/${latest}/main.v`])
		// Sources before the constant (VLS 0.0.2) only had a literal in ServerInfo.
		assert.equal(
			await getUpstreamVlsVersion(
				latest,
				undefined,
				source("server_info: ServerInfo{\n\tname: 'vls'\n\tversion: '0.0.2'\n}"),
			),
			undefined,
		)
		assert.equal(await getUpstreamVlsVersion(latest, undefined, source("", 404)), undefined)
		await assert.rejects(getUpstreamVlsVersion(latest, undefined, source("", 503)), /HTTP 503/)
		assert.equal(await getUpstreamVlsVersion("abc1234", undefined, source("")), undefined)
		assert.equal(urls.length, 4)
	})

	it("reads only explicit VLS version output, optionally with its build commit", () => {
		assert.deepEqual(parseVlsIdentity("VLS 0.0.3\n"), { version: "0.0.3" })
		assert.deepEqual(parseVlsIdentity(`VLS 0.0.3 ${latest.toUpperCase()}`), {
			version: "0.0.3",
			revision: latest,
		})
		for (const output of [
			"VLS revision abc1234",
			"VLS 0.0.3 (commit abc1234)",
			"0.0.3",
			"V 0.5.2 abc1234",
			"VLS 0.00.3",
			"VLS 0.0.3-01",
			"VLS 0.0.3 abc123",
			"VLS 0.0.3 master",
			"VLS 0.0.3\nadditional output",
			"2026-10-05 abc1234",
		]) {
			assert.equal(parseVlsIdentity(output), undefined, output)
		}
	})

	it("reads external launcher metadata without shell interpretation", async () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vls-version-"))
		const script = path.join(directory, "server with spaces; $unexpected.cjs")
		try {
			fs.writeFileSync(
				script,
				"if (process.argv.at(-1) !== '--version') process.exit(1); process.stdout.write('VLS 0.0.3\\n');",
			)
			assert.deepEqual(
				await readVlsIdentity(process.execPath, undefined, { args: [script] }),
				{ version: "0.0.3" },
			)
		} finally {
			fs.rmSync(directory, { recursive: true, force: true })
		}
	})

	it(
		"reads the standalone version before configured server transport arguments",
		{ skip: process.platform === "win32" },
		async () => {
			const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vls-standalone-"))
			const executable = path.join(directory, "vls")
			try {
				fs.writeFileSync(
					executable,
					'#!/bin/sh\n[ "$#" -eq 1 ] && [ "$1" = --version ] || exit 1\nprintf \'VLS 0.0.3\\n\'\n',
					{ mode: 0o755 },
				)
				assert.deepEqual(
					await readVlsIdentity(executable, undefined, { args: ["--port", "12345"] }),
					{ version: "0.0.3" },
				)
			} finally {
				fs.rmSync(directory, { recursive: true, force: true })
			}
		},
	)

	it("bounds a hanging metadata launcher and handles cancellation", async () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vls-timeout-"))
		const script = path.join(directory, "server.cjs")
		try {
			fs.writeFileSync(script, "setInterval(() => {}, 1000)")
			const started = performance.now()
			assert.equal(
				await readVlsIdentity(process.execPath, undefined, {
					args: [script],
					timeoutMs: 150,
				}),
				undefined,
			)
			assert.ok(performance.now() - started < 2_000)
			const controller = new AbortController()
			const pending = readVlsIdentity(process.execPath, controller.signal, { args: [script] })
			setTimeout(() => controller.abort(), 50)
			assert.equal(await pending, undefined)
			assert.equal(await readVlsIdentity(process.execPath, AbortSignal.abort()), undefined)
		} finally {
			fs.rmSync(directory, { recursive: true, force: true })
		}
	})

	it("only identifies a strict upstream descendant as outdated", () => {
		assert.strictEqual(
			classifyCompareResponse({ status: "ahead", ahead_by: 4, behind_by: 0 }),
			"outdated",
		)
		assert.strictEqual(
			classifyCompareResponse({ status: "identical", ahead_by: 0, behind_by: 0 }),
			"current",
		)
		assert.strictEqual(
			classifyCompareResponse({ status: "behind", ahead_by: 0, behind_by: 2 }),
			"current",
		)
		for (const invalid of [
			{ status: "diverged", ahead_by: 2, behind_by: 3 },
			{ status: "ahead", ahead_by: 2, behind_by: 3 },
			{ status: "ahead", ahead_by: 0, behind_by: 0 },
			{ status: "ahead", ahead_by: "2", behind_by: 0 },
			{ status: "ahead", ahead_by: 1.5, behind_by: 0 },
			{ status: "ahead", ahead_by: 2, behind_by: -1 },
			{ status: "ahead" },
			null,
			[],
		]) {
			assert.strictEqual(classifyCompareResponse(invalid), "unknown")
		}
	})

	it("fetches the official master commit and validates its identity", async () => {
		for (const tool of ["v", "vls"] as const) {
			const revision = await getLatestRevision(tool, undefined, async (url, options) => {
				assert.strictEqual(url, `https://api.github.com/repos/vlang/${tool}/commits/master`)
				assert.ok(options.signal instanceof AbortSignal)
				assert.ok(options.headers)
				return response({ sha: latest.toUpperCase() })
			})
			assert.strictEqual(revision, latest)
		}
		for (const sha of [undefined, "master", "b583c01", `${latest}extra`]) {
			await assert.rejects(
				getLatestRevision("v", undefined, async () => response({ sha })),
				/invalid revision/,
			)
		}
	})

	it("resolves the latest release tag to its commit", async () => {
		const urls: string[] = []
		const release = await getLatestRelease("v", undefined, async (url) => {
			urls.push(url)
			return url.endsWith("/releases/latest")
				? response({ tag_name: "0.5.2" })
				: response({ sha: previous.toUpperCase() })
		})
		assert.deepEqual(release, { tag: "0.5.2", revision: previous })
		assert.deepEqual(urls, [
			"https://api.github.com/repos/vlang/v/releases/latest",
			"https://api.github.com/repos/vlang/v/commits/0.5.2",
		])
		for (const tag_name of [undefined, "", "../master", "0.5.2?x", "a b"]) {
			await assert.rejects(
				getLatestRelease("v", undefined, async () => response({ tag_name })),
				/invalid release/,
			)
		}
		await assert.rejects(
			getLatestRelease("vls", undefined, async (url) =>
				url.endsWith("/releases/latest")
					? response({ tag_name: "0.3" })
					: response({ sha: "0.3" }),
			),
			/invalid revision for vls 0.3/,
		)
	})

	it("reports latest-revision HTTP errors and propagates cancellation", async () => {
		await assert.rejects(
			getLatestRevision("v", undefined, async () => response({}, 403)),
			/HTTP 403/,
		)
		const controller = new AbortController()
		const pending = getLatestRevision("v", controller.signal, (_url, options) => {
			return new Promise((_resolve, reject) => {
				options.signal?.addEventListener("abort", () => reject(new Error("cancelled")), {
					once: true,
				})
			})
		})
		controller.abort()
		await assert.rejects(pending, /cancelled/)
	})

	it("skips the network for matching or unidentifiable revisions", async () => {
		const noFetch = async (): Promise<Response> => {
			assert.fail("Unexpected GitHub request")
		}
		for (const local of [latest, latest.slice(0, 7), latest.slice(0, 12).toUpperCase()]) {
			assert.strictEqual(
				await getUpdateStatus("v", local, latest, undefined, noFetch),
				"current",
			)
		}
		for (const local of [undefined, "", "master", "abc123", "../../main", `${latest}-dirty`]) {
			assert.strictEqual(
				await getUpdateStatus("vls", local, latest, undefined, noFetch),
				"unknown",
			)
		}
		assert.strictEqual(
			await getUpdateStatus("v", previous, "master", undefined, noFetch),
			"unknown",
		)
		assert.strictEqual(
			await getUpdateStatus("v", previous, latest, AbortSignal.abort(), noFetch),
			"unknown",
		)
	})

	it("compares installed builds against upstream in the correct direction", async () => {
		const result = await getUpdateStatus("vls", previous, latest, undefined, async (url) => {
			assert.strictEqual(
				url,
				`https://api.github.com/repos/vlang/vls/compare/${previous}...${latest}`,
			)
			return response({ status: "ahead", ahead_by: 185, behind_by: 0 })
		})
		assert.strictEqual(result, "outdated")
	})

	it("distinguishes unknown commits from unavailable comparison requests", async () => {
		for (const status of [404, 422]) {
			assert.strictEqual(
				await getUpdateStatus("v", previous, latest, undefined, async () =>
					response({}, status),
				),
				"unknown",
			)
		}
		for (const status of [403, 429, 500]) {
			await assert.rejects(
				getUpdateStatus("v", previous, latest, undefined, async () => response({}, status)),
				new RegExp(`HTTP ${status}`),
			)
		}
		await assert.rejects(
			getUpdateStatus("v", previous, latest, undefined, async () => {
				throw new Error("offline")
			}),
			/offline/,
		)
		await assert.rejects(
			getUpdateStatus(
				"v",
				previous,
				latest,
				undefined,
				async () => new Response("invalid JSON"),
			),
			SyntaxError,
		)
	})

	it("returns unknown when the compiler probe fails or is already cancelled", async () => {
		assert.strictEqual(await readVRevision(process.execPath), undefined)
		assert.strictEqual(await readVRevision(process.execPath, AbortSignal.abort()), undefined)
	})

	it(
		"probes a compiler path containing shell characters without using a shell",
		{
			skip: process.platform === "win32",
		},
		async () => {
			const directory = fs.mkdtempSync(path.join(os.tmpdir(), "v-version-"))
			const executable = path.join(directory, "v compiler; $unexpected")
			try {
				fs.writeFileSync(
					executable,
					"#!/bin/sh\n[ \"$1\" = version ] || exit 1\nprintf 'V 0.5.2 b583c01\\n'\n",
					{
						mode: 0o755,
					},
				)
				assert.strictEqual(await readVRevision(executable), "b583c01")
			} finally {
				fs.rmSync(directory, { recursive: true, force: true })
			}
		},
	)

	it(
		"expands an abbreviated revision from the git clone the compiler was built in",
		{
			skip: process.platform === "win32",
		},
		async () => {
			const directory = fs.mkdtempSync(path.join(os.tmpdir(), "v-clone-"))
			const git = (...args: string[]) =>
				execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim()
			try {
				git("init", "--quiet")
				git(
					"-c",
					"user.name=V",
					"-c",
					"user.email=v@example.com",
					"commit",
					"--quiet",
					"--allow-empty",
					"-m",
					"initial",
				)
				const full = git("rev-parse", "HEAD")
				const executable = path.join(directory, "v")
				fs.writeFileSync(
					executable,
					`#!/bin/sh\nprintf 'V 0.5.2 ${full.slice(0, 7)}\\n'\n`,
					{ mode: 0o755 },
				)
				const link = path.join(directory, "bin-v")
				fs.symlinkSync(executable, link)
				assert.strictEqual(await readVRevision(link), full)
			} finally {
				fs.rmSync(directory, { recursive: true, force: true })
			}
		},
	)
})
