import * as fs from "fs"
import * as os from "os"
import * as path from "path"

function isExecutable(filePath: string): boolean {
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

export function findInPath(bin: string): string | undefined {
	const envPath = process.env.PATH || ""
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
	return pathCommand(command, workspaceFolder) || findInPath(command) || command
}
