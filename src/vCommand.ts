import * as fs from "fs"
import * as os from "os"
import * as path from "path"

export function isExecutable(filePath: string): boolean {
	try {
		if (!fs.statSync(filePath).isFile()) {
			return false
		}
		if (process.platform !== "win32") {
			fs.accessSync(filePath, fs.constants.X_OK)
		}
		return true
	} catch {
		return false
	}
}

function executableNames(bin: string): string[] {
	if (process.platform !== "win32" || path.extname(bin) !== "") {
		return [bin]
	}
	const extensions = (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
	return [bin, ...extensions.map((extension) => `${bin}${extension.toLowerCase()}`)]
}

/** A PATH hit, memoised by the PATH it was found in.
 *
 * The lookup stats every PATH directory against every extension, and the same
 * binaries are resolved again for every task-list refresh and every server
 * start. Keying on PATH itself means a changed PATH cannot return a stale hit.
 *
 * Only hits are kept. A miss is cached nowhere on purpose: it is the case where
 * the answer changes — a tool the user installs while the session is running has
 * to be found on the next call, not after a restart — and a miss is exactly what
 * the next call would otherwise have to pay for again.
 */
const pathLookupCache = new Map<string, string>()
const pathLookupCacheLimit = 512

export function findInPath(bin: string): string | undefined {
	const envPath = process.env.PATH || ""
	const cacheKey = `${envPath}\n${bin}`
	const cached = pathLookupCache.get(cacheKey)
	if (cached !== undefined) {
		return cached
	}
	const found = findInPathUncached(bin, envPath)
	if (found !== undefined) {
		if (pathLookupCache.size >= pathLookupCacheLimit) {
			pathLookupCache.clear()
		}
		pathLookupCache.set(cacheKey, found)
	}
	return found
}

function findInPathUncached(bin: string, envPath: string): string | undefined {
	for (const rawDirectory of envPath.split(path.delimiter)) {
		const directory = rawDirectory.replace(/^"|"$/g, "")
		if (!directory) {
			continue
		}
		for (const name of executableNames(bin)) {
			const fullPath = path.join(directory, name)
			if (isExecutable(fullPath)) {
				return fullPath
			}
		}
	}
	return undefined
}

/** Drop the PATH memo, so the next lookup goes back to the filesystem. */
export function resetPathLookupCache(): void {
	pathLookupCache.clear()
}

export function expandConfiguredPath(value: string, workspaceFolder?: string): string {
	let expanded = value.replace(/^~(?=$|[\\/])/, os.homedir())
	expanded = expanded.replace(/\$\{env:([^}]+)\}/g, (_match, name: string) => {
		return process.env[name] || ""
	})
	if (workspaceFolder) {
		expanded = expanded.replace(/\$\{workspaceFolder\}/g, workspaceFolder)
	}
	return expanded
}

function pathCommand(command: string, workspaceFolder?: string): string | undefined {
	const isPath = path.isAbsolute(command) || command.includes("/") || command.includes("\\")
	if (!isPath) {
		return undefined
	}
	return path.isAbsolute(command)
		? command
		: path.resolve(workspaceFolder || process.cwd(), command)
}

export function configuredCommand(configured: string, workspaceFolder?: string): string {
	const value = configured.trim()
	if (!value) {
		return findInPath("v") || "v"
	}
	return expandConfiguredPath(value, workspaceFolder)
}

export function resolvedCommand(configured: string, workspaceFolder?: string): string | undefined {
	const command = configuredCommand(configured, workspaceFolder)
	const fullPath = pathCommand(command, workspaceFolder)
	if (fullPath) {
		return isExecutable(fullPath) ? fullPath : undefined
	}
	return findInPath(command)
}

export function serverCommand(configured: string, workspaceFolder?: string): string | undefined {
	const value = configured.trim()
	if (!value) {
		return findInPath("v")
	}
	const command = expandConfiguredPath(value, workspaceFolder)
	const resolved = pathCommand(command, workspaceFolder) || findInPath(command) || command
	// A configured path can mix separators; the spawned command must be native.
	return path.normalize(resolved)
}
