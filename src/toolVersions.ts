import { execFile } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { promisify } from "util"
import { processLaunchCommand } from "./processExecution"
import type { ToolName } from "./toolInstallation"

export type UpdateStatus = "current" | "outdated" | "unknown"

type GitHubFetch = (
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

/** V supports `version`; VLS does not, so never use this probe for VLS. */
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
