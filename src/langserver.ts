import * as os from "os"
import * as path from "path"
import { window } from "vscode"
import { log } from "./logger"
import { vlsConfig } from "./utils"

import { exec as _exec } from "child_process"
import { promises as fs } from "fs"
import { promisify } from "util"
import { execVInTerminalOnBG } from "./exec"
import { isVInstalled } from "./vUtils"

const exec = promisify(_exec)

export const BINARY_NAME = process.platform === "win32" ? "vls.exe" : "vls"

export const USER_BIN_PATH = path.join(os.homedir(), ".local", "bin")

export const VLS_PATH = path.join(USER_BIN_PATH, BINARY_NAME) // ~/.local/bin/vls

export async function getVls(): Promise<string> {
	if (vlsConfig().get<boolean>("forceCleanInstall")) {
		await fs.rm(VLS_PATH, { force: true })
		log("forceCleanInstall is enabled, removed existing VLS.")
	} else if (await isVlsInstalled()) {
		// dont check if installed if forceCleanInstall is true
		return VLS_PATH
	}
	const selected = await window.showInformationMessage(
		"VLS is not installed. Do you want to install it now?",
		"Yes",
		"No",
	)
	if (selected === "No") {
		throw new Error("VLS is required but not installed.")
	}

	if (!vlsConfig().get<boolean>("build")) {
		return await installVls()
	}
	return await buildVls()
}

export function isVlsEnabled(): boolean {
	return vlsConfig().get<boolean>("enable")
}

export async function isVlsInstalled(): Promise<boolean> {
	try {
		// Check if file exists
		await fs.access(VLS_PATH)
		log(`Using existing VLS at ${VLS_PATH}`)
		return true
	} catch {
		// File doesn't exist — ignore and proceed to build/install
		return false
	}
}

export function installVls(): Promise<string> {
	// TODO: Install latest vls from github once there are releases
	return Promise.reject(
		new Error("VLS builds not yet available. Please enable vls.build in settings."),
	)
}

export async function buildVls(): Promise<string> {
	const { installed: isInstalled, version } = await isVInstalled()
	if (!isInstalled) {
		throw new Error("V must be installed to build VLS.")
	}
	if (version) {
		log(`Detected V version ${version}.`)
	}
	let buildPath: string
	try {
		log("Building VLS...")
		window.showInformationMessage("Building VLS...")
		const configuredPath = vlsConfig().get<string>("buildPath")?.trim() ?? ""
		if (configuredPath !== "") {
			buildPath = path.resolve(configuredPath)
			try {
				await fs.access(buildPath)
			} catch {
				throw new Error(`Configured VLS build path not found: ${buildPath}`)
			}
		} else {
			// Use temporary directory for cross-platform compatibility
			buildPath = path.join(os.tmpdir(), "vls")
			// Remove any existing directory at buildPath
			await fs.rm(buildPath, { recursive: true, force: true })
			// Clone the repo into buildPath
			await exec(`git clone --depth 1 https://github.com/vlang/vls.git "${buildPath}"`)
		}
		await execVInTerminalOnBG(["."], buildPath) // build

		// Ensure target dir exists
		await fs.mkdir(path.dirname(VLS_PATH), { recursive: true })

		// Copy binary using Node fs to support Windows
		await fs.copyFile(path.join(buildPath, BINARY_NAME), VLS_PATH)

		log(`VLS built and installed at ${VLS_PATH}`)
		return VLS_PATH
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		log(`Failed to build or install VLS: ${message}`)
		throw new Error(`Failed to build or install VLS: ${message}`)
	}
}
