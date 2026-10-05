import * as assert from "assert"
import { promises as fs } from "fs"
import * as os from "os"
import * as path from "path"
import { describe, it } from "node:test"
import {
	installTool,
	readManagedToolInstallation,
	runToolProcess,
	type ToolName,
	type ToolProcessOptions,
	type ToolProcessRunner,
} from "../toolInstallation"
import { MIN_VLS_REVISION, VLS_SUPPORT_BASELINE } from "../toolSupport"

const revision = "0123456789abcdef0123456789abcdef01234567"

interface ProcessCall {
	command: string
	args: string[]
	options: ToolProcessOptions
}

function fakeBuild(
	tool: ToolName,
	calls: ProcessCall[],
	platform = process.platform,
): ToolProcessRunner {
	return async (command, args, options) => {
		calls.push({ command, args, options })
		if (command === "git") {
			return { stdout: args.includes("rev-parse") ? `${revision}\n` : "", stderr: "" }
		}
		if (args.includes("-line-info")) {
			return { stdout: `${args.at(-1)}:9:3\n`, stderr: "" }
		}
		const executable = path.join(options.cwd, tool + (platform === "win32" ? ".exe" : ""))
		if (command !== executable) {
			await fs.writeFile(executable, "built executable")
			return { stdout: "build succeeded", stderr: "" }
		}
		if (tool === "v") {
			return { stdout: `V 0.5.2 ${revision.slice(0, 7)}\n`, stderr: "" }
		}
		const response = JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			result: {
				capabilities: {
					hoverProvider: true,
					definitionProvider: true,
					completionProvider: {},
					renameProvider: { prepareProvider: true },
				},
			},
		})
		return {
			stdout: `Content-Length: ${Buffer.byteLength(response)}\r\n\r\n${response}`,
			stderr: "",
		}
	}
}

async function withTemporaryRoot(run: (root: string) => Promise<void>): Promise<void> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "vscode-vlang-install-test-"))
	try {
		await run(root)
	} finally {
		await fs.rm(root, { recursive: true, force: true })
	}
}

describe("managed tool installations", () => {
	it("builds pinned official V source and verifies executable metadata", async () => {
		await withTemporaryRoot(async (root) => {
			const calls: ProcessCall[] = []
			const installed = await installTool("v", revision, root, undefined, {
				run: fakeBuild("v", calls),
			})
			assert.strictEqual(path.dirname(installed.directory), path.join(root, "tools"))
			assert.deepStrictEqual(
				await readManagedToolInstallation(installed.executable, "v", root),
				installed,
			)
			assert.deepStrictEqual(
				calls.find((call) => call.args.includes("fetch"))?.args.slice(-4),
				["fetch", "--depth=1", "https://github.com/vlang/v.git", revision],
			)
			assert.ok(calls.every((call) => call.options.cwd === installed.directory))
			assert.ok(
				calls.every(
					(call) =>
						call.options.env?.VMODULES === path.join(installed.directory, ".vmodules"),
				),
			)
			assert.ok(
				calls.every(
					(call) => call.options.env?.TMPDIR === path.join(installed.directory, ".tmp"),
				),
			)
			await fs.writeFile(installed.executable, "user rebuilt or replaced this binary")
			assert.strictEqual(
				await readManagedToolInstallation(installed.executable, "v", root),
				undefined,
			)
		})
	})

	it("builds V with an installed V instead of bootstrapping from vc", async () => {
		await withTemporaryRoot(async (root) => {
			const calls: ProcessCall[] = []
			const installation = await installTool("v", revision, root, "/installed/v", {
				run: fakeBuild("v", calls),
				platform: "linux",
			})
			const builds = calls
				.filter(
					(call) => call.command !== "git" && call.command !== installation.executable,
				)
				.map((call) => [call.command, ...call.args])
			assert.deepEqual(builds.slice(0, 2), [
				["make", "latest_tcc"],
				["/installed/v", "-o", installation.executable, "cmd/v"],
			])
			assert.ok(!builds.some((args) => args.length === 1 && args[0] === "make"))
		})
	})

	it("falls back to the full bootstrap when the installed V cannot build V", async () => {
		await withTemporaryRoot(async (root) => {
			const calls: ProcessCall[] = []
			const build = fakeBuild("v", calls)
			const installation = await installTool("v", revision, root, "/installed/v", {
				run: async (command, args, options) => {
					if (command === "/installed/v") {
						calls.push({ command, args, options })
						throw new Error("old compiler cannot build this revision")
					}
					return build(command, args, options)
				},
				platform: "linux",
			})
			const builds = calls
				.filter(
					(call) => call.command !== "git" && call.command !== installation.executable,
				)
				.map((call) => [call.command, ...call.args])
			assert.deepEqual(builds.slice(0, 3), [
				["make", "latest_tcc"],
				["/installed/v", "-o", installation.executable, "cmd/v"],
				["make"],
			])
			assert.equal(installation.revision, revision)
		})
	})

	it("keeps existing installations intact when a replacement build fails", async () => {
		await withTemporaryRoot(async (root) => {
			const installed = await installTool("v", revision, root, undefined, {
				run: fakeBuild("v", []),
			})
			const previousFiles = await fs.readdir(path.join(root, "tools"))
			const build = fakeBuild("v", [])
			await assert.rejects(
				installTool("v", revision, root, undefined, {
					run: async (command, args, options) => {
						if (command !== "git") {
							await fs.writeFile(
								path.join(options.cwd, "incomplete-output"),
								"partial",
							)
							throw new Error("C compiler missing")
						}
						return build(command, args, options)
					},
				}),
				/C compiler missing/,
			)
			assert.deepStrictEqual(await fs.readdir(path.join(root, "tools")), previousFiles)
			assert.strictEqual(await fs.readFile(installed.executable, "utf8"), "built executable")
			assert.ok(await readManagedToolInstallation(installed.executable, "v", root))
		})
	})

	it("cleans only the candidate when cancellation arrives during a build", async () => {
		await withTemporaryRoot(async (root) => {
			const installed = await installTool("v", revision, root, undefined, {
				run: fakeBuild("v", []),
			})
			const abort = new AbortController()
			const build = fakeBuild("v", [])
			await assert.rejects(
				installTool("v", revision, root, undefined, {
					signal: abort.signal,
					run: async (command, args, options) => {
						const result = await build(command, args, options)
						if (command !== "git") {
							abort.abort()
						}
						return result
					},
				}),
				{ name: "AbortError" },
			)
			assert.deepStrictEqual(await fs.readdir(path.join(root, "tools")), [
				path.basename(installed.directory),
			])
		})
	})

	it("rejects invalid revisions and VLS without a compiler before creating storage", async () => {
		await withTemporaryRoot(async (root) => {
			for (const invalid of ["master", "--upload-pack=unsafe", "abcdef0", `${revision}\n`]) {
				await assert.rejects(installTool("v", invalid, root), /full Git commit hash/)
			}
			await assert.rejects(installTool("vls", revision, root), /configure the V compiler/)
			const abort = new AbortController()
			abort.abort()
			await assert.rejects(
				installTool("v", revision, root, undefined, { signal: abort.signal }),
				{ name: "AbortError" },
			)
			assert.deepStrictEqual(await fs.readdir(root), [])
		})
	})

	it("rejects mismatched fetched source before running the build", async () => {
		await withTemporaryRoot(async (root) => {
			const calls: ProcessCall[] = []
			const build = fakeBuild("v", calls)
			await assert.rejects(
				installTool("v", revision, root, undefined, {
					run: async (command, args, options) =>
						args.includes("rev-parse")
							? { stdout: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", stderr: "" }
							: build(command, args, options),
				}),
				/does not match/,
			)
			assert.ok(calls.every((call) => call.command === "git"))
			assert.deepStrictEqual(await fs.readdir(path.join(root, "tools")), [])
		})
	})

	it("rejects a compiler reporting the wrong version and removes its candidate", async () => {
		await withTemporaryRoot(async (root) => {
			const build = fakeBuild("v", [])
			await assert.rejects(
				installTool("v", revision, root, undefined, {
					run: async (command, args, options) =>
						args.includes("version")
							? { stdout: "V 0.5.2 aaaaaaa", stderr: "" }
							: build(command, args, options),
				}),
				/requested version/,
			)
			assert.deepStrictEqual(await fs.readdir(path.join(root, "tools")), [])
		})
	})

	it("builds VLS with literal compiler arguments and probes its LSP capabilities", async () => {
		await withTemporaryRoot(async (root) => {
			const calls: ProcessCall[] = []
			const compiler = path.join(root, "V compiler $(literal); & chars")
			const installed = await installTool("vls", revision, root, compiler, {
				run: fakeBuild("vls", calls),
			})
			const buildCall = calls.find(
				(call) => call.command === compiler && call.args.includes("-o"),
			)
			assert.deepStrictEqual(buildCall?.args, [
				"-new-compiler",
				"-o",
				installed.executable,
				".",
			])
			const probe = calls.find((call) => call.command === installed.executable)
			assert.ok(probe?.options.input?.includes('"method":"initialize"'))
			assert.ok(probe?.options.input?.includes('"method":"shutdown"'))
			assert.strictEqual(probe?.options.env?.VLS_V_COMMAND, compiler)
			assert.equal(installed.vlsBaseline, VLS_SUPPORT_BASELINE)
			assert.ok(
				calls.some(
					(call) =>
						call.command === "git" &&
						call.args.includes("merge-base") &&
						call.args.includes(MIN_VLS_REVISION),
				),
			)
			assert.ok(await readManagedToolInstallation(installed.executable, "vls", root))
		})
	})

	it("rejects VLS builds which do not complete LSP initialization", async () => {
		await withTemporaryRoot(async (root) => {
			const unsupported = JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				result: { capabilities: {} },
			})
			for (const response of [
				`Content-Length: ${Buffer.byteLength(unsupported)}\r\n\r\n${unsupported}`,
				"",
				"Content-Length: 123\r\n\r\n{}",
				"Content-Length: 2\r\n\r\n{}",
				"not an LSP server",
			]) {
				const build = fakeBuild("vls", [])
				await assert.rejects(
					installTool("vls", revision, root, "/test/compiler", {
						run: async (command, args, options) =>
							options.input
								? { stdout: response, stderr: "" }
								: build(command, args, options),
					}),
					/initialize capabilities/,
				)
			}
			assert.deepStrictEqual(await fs.readdir(path.join(root, "tools")), [])
		})
	})

	it("rejects VLS source that does not contain the current supported baseline", async () => {
		await withTemporaryRoot(async (root) => {
			const calls: ProcessCall[] = []
			const build = fakeBuild("vls", calls)
			await assert.rejects(
				installTool("vls", revision, root, "/configured/v", {
					run: async (command, args, options) => {
						if (args.includes("merge-base")) throw new Error("not an ancestor")
						return build(command, args, options)
					},
				}),
				/VLS source must include 4f668aa/,
			)
			assert.ok(calls.every((call) => call.command === "git"))
			assert.deepEqual(await fs.readdir(path.join(root, "tools")), [])
		})
	})

	it("rejects unsupported V before compiling VLS and removes only its candidate", async () => {
		await withTemporaryRoot(async (root) => {
			const calls: ProcessCall[] = []
			const build = fakeBuild("vls", calls)
			await assert.rejects(
				installTool("vls", revision, root, "/old/v", {
					run: async (command, args, options) => {
						if (args.includes("-line-info"))
							throw new Error("unknown option `-vls-mode`")
						return build(command, args, options)
					},
				}),
				/Install or Update V using the master channel/,
			)
			assert.ok(!calls.some((call) => call.args.includes("-o")))
			assert.deepEqual(await fs.readdir(path.join(root, "tools")), [])
		})
	})

	it("uses the official Windows build script and executable suffix", async () => {
		await withTemporaryRoot(async (root) => {
			const calls: ProcessCall[] = []
			const installed = await installTool("v", revision, root, undefined, {
				platform: "win32",
				run: fakeBuild("v", calls, "win32"),
			})
			assert.strictEqual(path.basename(installed.executable), "v.exe")
			assert.deepStrictEqual(calls.find((call) => call.command === "cmd.exe")?.args, [
				"/d",
				"/s",
				"/c",
				"makev.bat",
			])
		})
	})

	it("prepares the compatibility compiler and retains its private runtime before recording metadata", async () => {
		await withTemporaryRoot(async (root) => {
			for (const platform of ["darwin", "win32"] as const) {
				const calls: ProcessCall[] = []
				const build = fakeBuild("v", calls, platform)
				const installed = await installTool("v", revision, root, undefined, {
					platform,
					findExecutable: (name) => {
						assert.strictEqual(platform, "win32")
						assert.strictEqual(name, "make")
						return "make"
					},
					run: async (command, args, options) => {
						const result = await build(command, args, options)
						if (args.includes("checkout")) {
							const helperDirectory = path.join(options.cwd, "cmd", "tools")
							await fs.mkdir(helperDirectory, { recursive: true })
							await fs.writeFile(
								path.join(helperDirectory, "install_v1_fallback.sh"),
								"installer",
							)
						}
						if (command === "make" && args[0] === "v1") {
							const cache = options.env?.V1_FALLBACK_CACHE_DIR
							assert.strictEqual(cache, path.join(options.cwd, ".v1-cache"))
							await fs.mkdir(cache!)
							await fs.writeFile(path.join(cache!, "runtime"), "required at runtime")
							await fs.writeFile(
								path.join(options.cwd, platform === "win32" ? "v.exe" : "v"),
								"after compatibility setup",
							)
						}
						return result
					},
				})
				assert.ok(calls.some((call) => call.command === "make" && call.args[0] === "v1"))
				assert.strictEqual(
					await fs.readFile(
						path.join(installed.directory, ".v1-cache", "runtime"),
						"utf8",
					),
					"required at runtime",
				)
				assert.ok(await readManagedToolInstallation(installed.executable, "v", root))
			}
		})
	})

	for (const available of [
		["make", "gmake", "mingw32-make"],
		["gmake", "mingw32-make"],
		["mingw32-make"],
		[],
	]) {
		it(`prepares Windows compatibility with ${available[0] ?? "no GNU make on PATH"}`, async () => {
			await withTemporaryRoot(async (root) => {
				const calls: ProcessCall[] = []
				const lookups: string[] = []
				const build = fakeBuild("v", calls, "win32")
				const makePath = path.join(root, "MSYS2 tools", `${available[0]}.exe`)
				const installing = installTool("v", revision, root, undefined, {
					platform: "win32",
					findExecutable: (name) => {
						lookups.push(name)
						return available.includes(name)
							? path.join(root, "MSYS2 tools", `${name}.exe`)
							: undefined
					},
					run: async (command, args, options) => {
						const result = await build(command, args, options)
						if (args.includes("checkout")) {
							const helperDirectory = path.join(options.cwd, "cmd", "tools")
							await fs.mkdir(helperDirectory, { recursive: true })
							await fs.writeFile(
								path.join(helperDirectory, "install_v1_fallback.sh"),
								"installer",
							)
						}
						return result
					},
				})
				if (available.length === 0) {
					await assert.rejects(installing, /MSYS2.*mingw32-make.*sh.*PATH/)
					assert.ok(!calls.some((call) => call.args[0] === "v1"))
					assert.deepStrictEqual(await fs.readdir(path.join(root, "tools")), [])
				} else {
					const installed = await installing
					assert.deepStrictEqual(
						calls.filter((call) => call.args[0] === "v1").map((call) => call.command),
						[makePath],
					)
					assert.ok(await readManagedToolInstallation(installed.executable, "v", root))
				}
				assert.deepStrictEqual(
					lookups,
					["make", "gmake", "mingw32-make"].slice(
						0,
						available.length === 0 ? 3 : 4 - available.length,
					),
				)
			})
		})
	}

	it("does not accept copied metadata for an external or symlinked executable", async () => {
		await withTemporaryRoot(async (root) => {
			const installed = await installTool("v", revision, root, undefined, {
				run: fakeBuild("v", []),
			})
			const external = path.join(root, "external")
			await fs.cp(installed.directory, external, { recursive: true })
			assert.strictEqual(
				await readManagedToolInstallation(path.join(external, "v"), "v", root),
				undefined,
			)
			await fs.rm(installed.executable)
			await fs.symlink(
				path.join(external, path.basename(installed.executable)),
				installed.executable,
			)
			assert.strictEqual(
				await readManagedToolInstallation(installed.executable, "v", root),
				undefined,
			)
		})
	})

	it("passes shell metacharacters as literal process arguments", async () => {
		await withTemporaryRoot(async (root) => {
			const literal = "$(echo unsafe); & `echo unsafe`"
			const result = await runToolProcess(
				process.execPath,
				["-e", "process.stdout.write(process.argv[1])", literal],
				{ cwd: root, timeoutMs: 5000 },
			)
			assert.strictEqual(result.stdout, literal)
		})
	})

	it("times out running subprocesses", async () => {
		await withTemporaryRoot(async (root) => {
			await assert.rejects(
				runToolProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
					cwd: root,
					timeoutMs: 50,
				}),
				/timed out/,
			)
		})
	})

	it("cancels build descendants before removing their candidate directory", async () => {
		await withTemporaryRoot(async (root) => {
			const marker = path.join(root, "descendant-wrote-after-cancellation")
			const abort = new AbortController()
			const descendant = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected'), 350); console.log('ready')`
			const parent = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {stdio: ['ignore', 'inherit', 'inherit']}); setInterval(() => {}, 1000)`
			await assert.rejects(
				runToolProcess(process.execPath, ["-e", parent], {
					cwd: root,
					timeoutMs: 5000,
					signal: abort.signal,
					onOutput: (output) => {
						if (output.includes("ready")) {
							abort.abort()
						}
					},
				}),
				{ name: "AbortError" },
			)
			await new Promise((resolve) => setTimeout(resolve, 500))
			await assert.rejects(fs.stat(marker), { code: "ENOENT" })
		})
	})
})
