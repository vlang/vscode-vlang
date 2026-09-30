import { spawn } from "child_process"
import { createHash } from "crypto"
import { createReadStream, promises as fs } from "fs"
import * as path from "path"
import { processLaunchCommand, processTreeKillCommand } from "./processExecution"

export type ToolName = "v" | "vls"

export interface ToolProcessOptions {
	cwd: string
	timeoutMs: number
	signal?: AbortSignal
	onOutput?: (text: string) => void
	input?: string
	env?: typeof process.env
}

export interface ToolProcessResult {
	stdout: string
	stderr: string
}

export type ToolProcessRunner = (
	command: string,
	args: string[],
	options: ToolProcessOptions,
) => Promise<ToolProcessResult>

export interface ToolInstallationOptions {
	signal?: AbortSignal
	onOutput?: (text: string) => void
	onProgress?: (text: string) => void
	platform?: typeof process.platform
	run?: ToolProcessRunner
}

export interface ManagedToolInstallation {
	tool: ToolName
	revision: string
	executable: string
	directory: string
	sha256: string
	installedAt: string
}

const manifestName = ".vscode-vlang-installation.json"
const fullRevision = /^[a-f\d]{40}$/i
const retainedOutputLimit = 512 * 1024

function cancellationError(): Error {
	const error = new Error("Tool installation cancelled.")
	error.name = "AbortError"
	return error
}

function checkCancelled(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw cancellationError()
	}
}

async function killProcessTree(processId: number): Promise<void> {
	const kill = processTreeKillCommand(processId)
	if (kill) {
		await new Promise<void>((resolve) => {
			const child = spawn(kill.command, kill.args, { shell: false, windowsHide: true })
			child.once("error", () => resolve())
			child.once("close", () => resolve())
		})
		return
	}
	try {
		// Every installation subprocess owns its POSIX process group.
		process.kill(-processId, "SIGKILL")
	} catch {
		// The process may have exited between cancellation and the kill.
	}
}

export const runToolProcess: ToolProcessRunner = (command, args, options) => {
	checkCancelled(options.signal)
	return new Promise((resolve, reject) => {
		const launch = processLaunchCommand(command, args)
		const child = spawn(launch.command, launch.args, {
			cwd: options.cwd,
			env: options.env,
			shell: false,
			windowsHide: true,
			windowsVerbatimArguments: launch.windowsVerbatimArguments,
			detached: process.platform !== "win32",
			stdio: "pipe",
		})
		let stdout = ""
		let stderr = ""
		let failure: Error | undefined
		let termination = Promise.resolve()
		const stop = (error: Error): void => {
			if (failure) {
				return
			}
			failure = error
			if (child.pid !== undefined) {
				termination = killProcessTree(child.pid)
			}
		}
		const cancel = (): void => stop(cancellationError())
		const timeout = setTimeout(() => {
			stop(new Error(`${path.basename(command)} timed out.`))
		}, options.timeoutMs)
		const dispose = (): void => {
			clearTimeout(timeout)
			options.signal?.removeEventListener("abort", cancel)
		}
		options.signal?.addEventListener("abort", cancel, { once: true })
		if (options.signal?.aborted) {
			cancel()
		}
		child.stdout.setEncoding("utf8")
		child.stderr.setEncoding("utf8")
		child.stdout.on("data", (chunk: string) => {
			stdout = (stdout + chunk).slice(-retainedOutputLimit)
			options.onOutput?.(chunk)
		})
		child.stderr.on("data", (chunk: string) => {
			stderr = (stderr + chunk).slice(-retainedOutputLimit)
			options.onOutput?.(chunk)
		})
		// A command can exit before consuming stdin; its exit status is handled below.
		child.stdin.on("error", () => undefined)
		child.stdin.end(options.input)
		child.once("error", (error) => {
			dispose()
			reject(error)
		})
		child.once("close", (code) => {
			dispose()
			void termination.then(() => {
				if (failure) {
					reject(failure)
				} else if (code !== 0) {
					reject(
						new Error(
							`${path.basename(command)} failed (exit ${String(code)}). ${stderr.trim().slice(-2000)}`,
						),
					)
				} else {
					resolve({ stdout, stderr })
				}
			})
		})
	})
}

function installationEnvironment(
	directory: string,
	platform: typeof process.platform,
): typeof process.env {
	const env = { ...process.env }
	for (const key of Object.keys(env)) {
		const name = key.toUpperCase()
		if (
			name.startsWith("GIT_") ||
			name.startsWith("V1_FALLBACK_") ||
			[
				"VROOT",
				"VC",
				"VEXE",
				"VFLAGS",
				"VARGS",
				"VCREPO",
				"TCCREPO",
				"LEGACYREPO",
				"MAKEFLAGS",
				"MFLAGS",
				"MAKEOVERRIDES",
			].includes(name)
		) {
			delete env[key]
		}
	}
	const temporaryDirectory = path.join(directory, ".tmp")
	return {
		...env,
		GIT_TERMINAL_PROMPT: "0",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: platform === "win32" ? "NUL" : "/dev/null",
		VMODULES: path.join(directory, ".vmodules"),
		V1_FALLBACK_CACHE_DIR: path.join(directory, ".v1-cache"),
		XDG_CACHE_HOME: path.join(directory, ".cache"),
		V_C_ERROR_BUG_REPORT_DISABLED: "1",
		VTMP: temporaryDirectory,
		TMPDIR: temporaryDirectory,
		TMP: temporaryDirectory,
		TEMP: temporaryDirectory,
		VLS_LOG: "",
	}
}

function lspFrame(message: unknown): string {
	const body = JSON.stringify(message)
	return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
}

function hasInitializeResponse(output: string): boolean {
	let data = Buffer.from(output)
	while (data.length > 0) {
		const headerEnd = data.indexOf("\r\n\r\n")
		if (headerEnd === -1) {
			return false
		}
		const length = Number(
			/(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(data.subarray(0, headerEnd).toString())?.[1],
		)
		if (!Number.isSafeInteger(length) || length < 0 || data.length < headerEnd + 4 + length) {
			return false
		}
		try {
			const message: unknown = JSON.parse(
				data.subarray(headerEnd + 4, headerEnd + 4 + length).toString(),
			)
			if (
				isObject(message) &&
				message.id === 1 &&
				!message.error &&
				isObject(message.result) &&
				isObject(message.result.capabilities)
			) {
				return true
			}
		} catch {
			return false
		}
		data = data.subarray(headerEnd + 4 + length)
	}
	return false
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function executableHash(executable: string): Promise<string> {
	const hash = createHash("sha256")
	for await (const chunk of createReadStream(executable)) {
		hash.update(chunk as Buffer)
	}
	return hash.digest("hex")
}

/** Build a new, isolated installation. The caller switches settings only after success. */
export async function installTool(
	tool: ToolName,
	revision: string,
	storageRoot: string,
	compiler?: string,
	options: ToolInstallationOptions = {},
): Promise<ManagedToolInstallation> {
	if (!fullRevision.test(revision)) {
		throw new Error("Installation requires a full Git commit hash.")
	}
	if (tool === "vls" && !compiler) {
		throw new Error("Install or configure the V compiler before installing VLS.")
	}
	checkCancelled(options.signal)
	const platform = options.platform ?? process.platform
	const toolsDirectory = path.join(path.resolve(storageRoot), "tools")
	await fs.mkdir(toolsDirectory, { recursive: true })
	if ((await fs.lstat(toolsDirectory)).isSymbolicLink()) {
		throw new Error("The managed tools directory must not be a symbolic link.")
	}
	const directory = await fs.mkdtemp(path.join(toolsDirectory, `${tool}-`))
	try {
		const run = options.run ?? runToolProcess
		const env = installationEnvironment(directory, platform)
		await fs.mkdir(path.join(directory, ".tmp"))
		await fs.mkdir(path.join(directory, ".vmodules"))
		await fs.mkdir(path.join(directory, ".git-hooks"))
		const processOptions: ToolProcessOptions = {
			cwd: directory,
			env,
			signal: options.signal,
			onOutput: options.onOutput,
			timeoutMs: 5 * 60 * 1000,
		}
		const execute = async (
			command: string,
			args: string[],
			overrides: Partial<ToolProcessOptions> = {},
		): Promise<ToolProcessResult> => {
			checkCancelled(options.signal)
			const result = await run(command, args, { ...processOptions, ...overrides })
			checkCancelled(options.signal)
			return result
		}
		const git = async (args: string[]): Promise<ToolProcessResult> =>
			execute("git", [
				"-c",
				`core.hooksPath=${path.join(directory, ".git-hooks")}`,
				"-c",
				"protocol.file.allow=never",
				"-c",
				"protocol.ext.allow=never",
				...args,
			])
		options.onProgress?.(`Downloading ${tool === "v" ? "V" : "VLS"} source…`)
		await git(["init", "--template=", "."])
		await git(["fetch", "--depth=1", `https://github.com/vlang/${tool}.git`, revision])
		await git(["checkout", "--detach", "FETCH_HEAD"])
		const checkedOut = await git(["rev-parse", "HEAD"])
		if (checkedOut.stdout.trim().toLowerCase() !== revision.toLowerCase()) {
			throw new Error("Downloaded source does not match the requested revision.")
		}
		const executable = path.join(directory, tool + (platform === "win32" ? ".exe" : ""))
		options.onProgress?.(`Building ${tool === "v" ? "V" : "VLS"}…`)
		if (tool === "v") {
			const make = ["freebsd", "openbsd", "netbsd", "sunos"].includes(platform)
				? "gmake"
				: "make"
			if (platform === "win32") {
				await execute("cmd.exe", ["/d", "/s", "/c", "makev.bat"], {
					timeoutMs: 15 * 60 * 1000,
				})
			} else {
				await execute(make, [], { timeoutMs: 15 * 60 * 1000 })
			}
			// VLS uses -line-info, which recent V versions implement in a separate
			// compatibility compiler. Keep its runtime and cache in this candidate.
			const compatibilityInstaller = path.join(
				directory,
				"cmd",
				"tools",
				"install_v1_fallback.sh",
			)
			if (
				await fs.stat(compatibilityInstaller).then(
					(stat) => stat.isFile(),
					() => false,
				)
			) {
				options.onProgress?.(
					"Preparing V language server compatibility (requires GNU make and a shell)…",
				)
				await execute(make, ["v1"], { timeoutMs: 15 * 60 * 1000 })
			}
		} else {
			await execute(compiler!, ["-o", executable, "."], { timeoutMs: 15 * 60 * 1000 })
		}
		if (!(await fs.lstat(executable)).isFile()) {
			throw new Error("The build did not produce a regular executable file.")
		}
		options.onProgress?.(`Verifying ${tool === "v" ? "V" : "VLS"}…`)
		if (tool === "v") {
			const version = await execute(executable, ["version"], { timeoutMs: 15_000 })
			if (
				!/^V \d+\.\d+(?:\.\d+)?\b/m.test(version.stdout) ||
				!version.stdout.toLowerCase().includes(revision.slice(0, 7).toLowerCase())
			) {
				throw new Error("The built V compiler did not report the requested version.")
			}
		} else {
			const input = [
				{
					jsonrpc: "2.0",
					id: 1,
					method: "initialize",
					params: {
						processId: null,
						rootUri: null,
						capabilities: {},
						workspaceFolders: [],
					},
				},
				{ jsonrpc: "2.0", method: "initialized", params: {} },
				{ jsonrpc: "2.0", id: 2, method: "shutdown", params: null },
				{ jsonrpc: "2.0", method: "exit", params: null },
			]
				.map(lspFrame)
				.join("")
			const probe = await execute(executable, [], {
				input,
				timeoutMs: 15_000,
				env: { ...env, VLS_V_COMMAND: compiler },
			})
			if (!hasInitializeResponse(probe.stdout)) {
				throw new Error("The built VLS did not respond to an LSP initialize request.")
			}
		}
		const installation: ManagedToolInstallation = {
			tool,
			revision: revision.toLowerCase(),
			executable,
			directory,
			sha256: await executableHash(executable),
			installedAt: new Date().toISOString(),
		}
		checkCancelled(options.signal)
		await fs.writeFile(
			path.join(directory, manifestName),
			JSON.stringify(
				{
					...installation,
					schemaVersion: 1,
					executable: path.basename(executable),
					directory: undefined,
				},
				null,
				2,
			),
			{ flag: "wx" },
		)
		checkCancelled(options.signal)
		return installation
	} catch (error) {
		// Only this freshly-created candidate belongs to the failed operation.
		await fs.rm(directory, { recursive: true, force: true })
		throw error
	}
}

/** Trust revision metadata only for intact binaries in this extension's storage. */
export async function readManagedToolInstallation(
	executable: string,
	tool: ToolName,
	storageRoot: string,
): Promise<ManagedToolInstallation | undefined> {
	try {
		const toolsDirectory = path.join(path.resolve(storageRoot), "tools")
		const directory = path.dirname(path.resolve(executable))
		if (
			path.dirname(directory) !== toolsDirectory ||
			!path.basename(directory).startsWith(`${tool}-`)
		) {
			return undefined
		}
		for (const file of [
			toolsDirectory,
			directory,
			executable,
			path.join(directory, manifestName),
		]) {
			if ((await fs.lstat(file)).isSymbolicLink()) {
				return undefined
			}
		}
		const manifest: unknown = JSON.parse(
			await fs.readFile(path.join(directory, manifestName), "utf8"),
		)
		if (
			!isObject(manifest) ||
			manifest.schemaVersion !== 1 ||
			manifest.tool !== tool ||
			typeof manifest.revision !== "string" ||
			!fullRevision.test(manifest.revision) ||
			typeof manifest.sha256 !== "string" ||
			!/^[a-f\d]{64}$/.test(manifest.sha256) ||
			typeof manifest.installedAt !== "string" ||
			manifest.executable !== path.basename(executable)
		) {
			return undefined
		}
		if (
			!(await fs.lstat(executable)).isFile() ||
			(await executableHash(executable)) !== manifest.sha256
		) {
			return undefined
		}
		return {
			tool,
			revision: manifest.revision.toLowerCase(),
			executable,
			directory,
			sha256: manifest.sha256,
			installedAt: manifest.installedAt,
		}
	} catch {
		return undefined
	}
}
