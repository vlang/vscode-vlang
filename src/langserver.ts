import * as fs from "fs"
import * as path from "path"
import { log } from "./logger"
import { vlsConfig } from "./utils"

export const BINARY_NAME = process.platform === "win32" ? "vls.exe" : "vls"

function isExecutable(filePath: string): boolean {
	try {
		const mode = process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK
		fs.accessSync(filePath, mode)
		return fs.statSync(filePath).isFile()
	} catch {
		return false
	}
}

function executableNames(command: string): string[] {
	if (process.platform !== "win32" || path.extname(command) !== "") {
		return [command]
	}

	const pathExt = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD"
	return [command, ...pathExt.split(";").map((extension) => `${command}${extension}`)]
}

function findInPath(command: string): string | undefined {
	const pathValue = process.env.PATH ?? ""
	for (const directory of pathValue.split(path.delimiter)) {
		for (const name of executableNames(command)) {
			const candidate = path.resolve(directory || ".", name)
			if (isExecutable(candidate)) {
				return candidate
			}
		}
	}
	return undefined
}

export function getVls(): string {
	const configuredCommand = vlsConfig().get<string>("command", "").trim()
	const command = configuredCommand || BINARY_NAME
	const hasPath = path.isAbsolute(command) || command.includes("/") || command.includes("\\")
	const vlsPath = hasPath ? path.resolve(command) : findInPath(command)

	if (!vlsPath || !isExecutable(vlsPath)) {
		if (configuredCommand) {
			throw new Error(
				`VLS binary not found or not executable: ${configuredCommand}. ` +
					"Check the \"v.vls.command\" setting.",
			)
		}
		throw new Error(
			"VLS binary not found. Install VLS, add \"vls\" to PATH, or set \"v.vls.command\".",
		)
	}

	log(`Using VLS at ${vlsPath}`)
	return vlsPath
}

export function isVlsEnabled(): boolean {
	return vlsConfig().get<boolean>("enable", true)
}
