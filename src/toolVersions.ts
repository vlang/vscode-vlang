import { execFile, spawn } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { promisify } from "util"
import { processLaunchCommand, processTreeKillCommand } from "./processExecution"
import type { ToolName } from "./toolInstallation"

export type UpdateStatus = "current" | "outdated" | "unknown"

export const MIN_VLS_REVISION = "4f668aa04e2568eb7ffdc6a02198ef14cec3e12a"
export const MIN_VLS_VERSION = "0.0.3"
export const VLS_SUPPORT_BASELINE = MIN_VLS_REVISION

export interface VlsIdentity {
	version?: string
	revision?: string
}

export type GitHubFetch = (
	url: string,
	options: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>

const executeFile = promisify(execFile)
const abbreviatedRevision = /^[a-f0-9]{7,40}$/i
const fullRevision = /^[a-f0-9]{40}$/i

class GitHubHttpError extends Error {
	constructor(
		readonly status: number,
		tool: ToolName,
	) {
		super(`GitHub returned HTTP ${status} while checking ${tool}.`)
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function githubJson(
	tool: ToolName,
	endpoint: string,
	signal: AbortSignal | undefined,
	fetcher: GitHubFetch,
): Promise<unknown> {
	const timeout = AbortSignal.timeout(10_000)
	const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
	requestSignal.throwIfAborted()
	const response = await fetcher(`https://api.github.com/repos/vlang/${tool}/${endpoint}`, {
		headers: {
			Accept: "application/vnd.github+json",
			"User-Agent": "vscode-vlang",
			"X-GitHub-Api-Version": "2022-11-28",
		},
		signal: requestSignal,
	})
	if (!response.ok) {
		throw new GitHubHttpError(response.status, tool)
	}
	return response.json()
}

export async function getLatestRevision(
	tool: ToolName,
	signal?: AbortSignal,
	fetcher: GitHubFetch = fetch,
): Promise<string> {
	const result = await githubJson(tool, "commits/master", signal, fetcher)
	if (!isRecord(result) || typeof result.sha !== "string" || !fullRevision.test(result.sha)) {
		throw new Error(`GitHub returned an invalid revision for ${tool}.`)
	}
	return result.sha.toLowerCase()
}

export interface ToolRelease {
	tag: string
	revision: string
}

const releaseTag = /^[\w][\w.+-]{0,99}$/

/** The latest published release, resolved to the commit its tag names. */
export async function getLatestRelease(
	tool: ToolName,
	signal?: AbortSignal,
	fetcher: GitHubFetch = fetch,
): Promise<ToolRelease> {
	const release = await githubJson(tool, "releases/latest", signal, fetcher)
	const tag = isRecord(release) ? release.tag_name : undefined
	if (typeof tag !== "string" || !releaseTag.test(tag)) {
		throw new Error(`GitHub returned an invalid release for ${tool}.`)
	}
	// The commits endpoint also peels annotated tags.
	const commit = await githubJson(tool, `commits/${encodeURIComponent(tag)}`, signal, fetcher)
	if (!isRecord(commit) || typeof commit.sha !== "string" || !fullRevision.test(commit.sha)) {
		throw new Error(`GitHub returned an invalid revision for ${tool} ${tag}.`)
	}
	return { tag, revision: commit.sha.toLowerCase() }
}

/** Only an upstream descendant proves that an installed build is outdated. */
export function classifyCompareResponse(value: unknown): UpdateStatus {
	if (!isRecord(value)) return "unknown"
	const ahead = value.ahead_by
	const behind = value.behind_by
	if (
		typeof ahead !== "number" ||
		typeof behind !== "number" ||
		!Number.isSafeInteger(ahead) ||
		!Number.isSafeInteger(behind) ||
		ahead < 0 ||
		behind < 0
	) {
		return "unknown"
	}
	if (value.status === "ahead" && ahead > 0 && behind === 0) return "outdated"
	if (value.status === "identical" && ahead === 0 && behind === 0) return "current"
	// A local development build can be newer than the upstream revision we checked.
	if (value.status === "behind" && ahead === 0 && behind > 0) return "current"
	return "unknown"
}

export async function getUpdateStatus(
	tool: ToolName,
	localRevision: string | undefined,
	latestRevision: string,
	signal?: AbortSignal,
	fetcher: GitHubFetch = fetch,
): Promise<UpdateStatus> {
	if (
		signal?.aborted ||
		!localRevision ||
		!abbreviatedRevision.test(localRevision) ||
		!fullRevision.test(latestRevision)
	) {
		return "unknown"
	}
	const local = localRevision.toLowerCase()
	const latest = latestRevision.toLowerCase()
	if (latest.startsWith(local)) return "current"
	try {
		const result = await githubJson(tool, `compare/${local}...${latest}`, signal, fetcher)
		return classifyCompareResponse(result)
	} catch (error) {
		// A private/custom revision may be unknown to the public repository. Other
		// failures mean the check was unavailable, not that the installation needs
		// adoption: let the caller report or quietly log those failures.
		if (error instanceof GitHubHttpError && [404, 422].includes(error.status)) {
			return "unknown"
		}
		throw error
	}
}

export function parseVRevision(output: string): string | undefined {
	const match =
		/^V[ \t]+\d+\.\d+\.\d+(?:[-+][\w.-]+)?[ \t]+([a-f0-9]{7,40})(?:\.([a-f0-9]{7,40}))?$/i.exec(
			output.trim(),
		)
	return (match?.[2] ?? match?.[1])?.toLowerCase()
}

/** Read the compiler's build identity without compiling a source fixture. */
export async function readVRevision(
	executable: string,
	signal?: AbortSignal,
): Promise<string | undefined> {
	if (signal?.aborted) return undefined
	let revision: string | undefined
	try {
		const launch = processLaunchCommand(executable, ["version"])
		const result = await executeFile(launch.command, launch.args, {
			windowsVerbatimArguments: launch.windowsVerbatimArguments,
			windowsHide: true,
			timeout: 5_000,
			killSignal: "SIGKILL",
			maxBuffer: 64 * 1024,
			signal,
		})
		revision = parseVRevision(result.stdout)
	} catch {
		return undefined
	}
	if (!revision || fullRevision.test(revision)) return revision
	return (await expandGitRevision(executable, revision, signal)) ?? revision
}

/**
 * `v version` prints an abbreviated hash, which GitHub cannot compare: across the
 * vlang/v fork network seven characters are ambiguous. A V built from a clone can
 * expand it locally.
 */
async function expandGitRevision(
	executable: string,
	revision: string,
	signal?: AbortSignal,
): Promise<string | undefined> {
	try {
		const root = path.dirname(await fs.promises.realpath(executable))
		const result = await executeFile(
			"git",
			["-C", root, "rev-parse", "--verify", "--quiet", `${revision}^{commit}`],
			{
				windowsHide: true,
				timeout: 5_000,
				killSignal: "SIGKILL",
				maxBuffer: 4 * 1024,
				signal,
			},
		)
		const full = result.stdout.trim().toLowerCase()
		return fullRevision.test(full) && full.startsWith(revision) ? full : undefined
	} catch {
		return undefined
	}
}

const semanticVersion =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-z-]+(?:\.[\da-z-]+)*))?(?:\+([\da-z-]+(?:\.[\da-z-]+)*))?$/i

/** Compare semantic versions numerically; a prerelease of the minimum is older. */
export function isSupportedVlsVersion(version: string | undefined): boolean {
	if (!version) return false
	const match = semanticVersion.exec(version)
	if (!match) return false
	const numbers = match.slice(1, 4).map(Number)
	if (!numbers.every(Number.isSafeInteger)) return false
	const prerelease = match[4]
	if (prerelease?.split(".").some((part) => /^0\d+$/.test(part))) return false
	const minimum = MIN_VLS_VERSION.split(".").map(Number)
	for (let index = 0; index < numbers.length; index++) {
		if (numbers[index]! > minimum[index]!) return true
		if (numbers[index]! < minimum[index]!) return false
	}
	return !prerelease
}

/** Only explicitly labelled VLS output can identify the server executable. */
export function parseVlsIdentity(output: string): VlsIdentity | undefined {
	const revisionOnly = /^VLS[ \t]+(?:commit|revision)[ \t]+([a-f\d]{7,40})$/i.exec(output.trim())
	if (revisionOnly) return { revision: revisionOnly[1]!.toLowerCase() }
	const match =
		/^VLS[ \t]+(\S+?)(?:[ \t]+(?:([a-f\d]{7,40})|\((?:commit|revision)[ \t]+([a-f\d]{7,40})\)))?$/i.exec(
			output.trim(),
		)
	if (!match || !semanticVersion.test(match[1]!)) return undefined
	const version = match[1]!
	const prerelease = semanticVersion.exec(version)?.[4]
	if (prerelease?.split(".").some((part) => /^0\d+$/.test(part))) return undefined
	const revision = (match[2] ?? match[3])?.toLowerCase()
	return { version, ...(revision ? { revision } : {}) }
}

export interface VlsVersionOptions {
	args?: readonly string[]
	timeoutMs?: number
}

/** Version requests never open a project and are bounded even for older VLS builds. */
async function readVlsVersionOutput(
	executable: string,
	signal: AbortSignal | undefined,
	options: VlsVersionOptions,
): Promise<string | undefined> {
	if (signal?.aborted) return undefined
	const launch = processLaunchCommand(executable, [...(options.args ?? []), "--version"])
	return new Promise((resolve) => {
		let output = ""
		let settled = false
		const child = spawn(launch.command, launch.args, {
			shell: false,
			windowsVerbatimArguments: launch.windowsVerbatimArguments,
			windowsHide: true,
			detached: process.platform !== "win32",
			stdio: ["ignore", "pipe", "pipe"],
		})
		const stop = () => {
			if (child.pid) {
				const treeKill = processTreeKillCommand(child.pid)
				if (treeKill) {
					const killer = spawn(treeKill.command, treeKill.args, {
						windowsHide: true,
						stdio: "ignore",
					})
					killer.once("error", () => child.kill("SIGKILL"))
				} else {
					try {
						process.kill(-child.pid, "SIGKILL")
					} catch {
						child.kill("SIGKILL")
					}
				}
			}
		}
		const finish = (result: string | undefined, terminate = false) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			signal?.removeEventListener("abort", cancelled)
			if (terminate) stop()
			resolve(result)
		}
		const cancelled = () => finish(undefined, true)
		const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? 5_000, 5_000))
		const timer = setTimeout(() => finish(undefined, true), timeoutMs)
		signal?.addEventListener("abort", cancelled, { once: true })
		if (signal?.aborted) cancelled()
		child.stdout.setEncoding("utf8")
		child.stdout.on("data", (chunk: string) => {
			output += chunk
			if (output.length > 16 * 1024) finish(undefined, true)
		})
		// Drain stderr so an unsupported flag cannot fill its pipe and stall exit.
		child.stderr.resume()
		child.once("error", () => finish(undefined))
		child.once("close", (code) => finish(code === 0 ? output : undefined))
	})
}

export async function readVlsIdentity(
	executable: string,
	signal?: AbortSignal,
	options: VlsVersionOptions = {},
): Promise<VlsIdentity | undefined> {
	const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? 5_000, 5_000))
	const deadline = performance.now() + timeoutMs
	const output = await readVlsVersionOutput(executable, signal, { timeoutMs })
	let identity = output === undefined ? undefined : parseVlsIdentity(output)
	const remaining = deadline - performance.now()
	// Server flags must not interfere with VLS's standalone --version command.
	// Launcher prefixes (for example node path/to/vls.js) need their configured args.
	if (!identity && options.args?.length && !signal?.aborted && remaining > 0) {
		const launcherOutput = await readVlsVersionOutput(executable, signal, {
			args: options.args,
			timeoutMs: remaining,
		})
		identity = launcherOutput === undefined ? undefined : parseVlsIdentity(launcherOutput)
	}
	if (!identity?.revision || fullRevision.test(identity.revision)) return identity
	const full = await expandGitRevision(executable, identity.revision, signal)
	return full ? { ...identity, revision: full } : identity
}

/** A reported source revision is supported only if it includes the minimum commit. */
export async function isSupportedVlsRevision(
	executable: string,
	revision: string | undefined,
	signal?: AbortSignal,
	fetcher: GitHubFetch = fetch,
): Promise<boolean> {
	if (signal?.aborted || !revision || !abbreviatedRevision.test(revision)) return false
	const candidate = revision.toLowerCase()
	if (MIN_VLS_REVISION.startsWith(candidate)) return true
	const full = fullRevision.test(candidate)
		? candidate
		: await expandGitRevision(executable, candidate, signal)
	if (!full) return false
	try {
		const root = path.dirname(await fs.promises.realpath(executable))
		await executeFile(
			"git",
			["-C", root, "merge-base", "--is-ancestor", MIN_VLS_REVISION, full],
			{
				windowsHide: true,
				timeout: 5_000,
				killSignal: "SIGKILL",
				maxBuffer: 4 * 1024,
				signal,
			},
		)
		return true
	} catch {
		if (signal?.aborted) return false
	}
	try {
		// compare minimum...candidate reports "outdated" only for a strict descendant.
		return (
			(await getUpdateStatus("vls", MIN_VLS_REVISION, full, signal, fetcher)) === "outdated"
		)
	} catch {
		return false
	}
}
