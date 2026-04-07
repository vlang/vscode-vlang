import { exec as childExec, ExecOptions } from "child_process"
import { getVExecCommand } from "exec"
import extract from "extract-zip"
import * as fs from "fs"
import { log } from "logger"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { ReadableStream as NodeReadableStream } from "node:stream/web"
import * as os from "os"
import * as path from "path"
import * as tar from "tar"
import { inspect } from "util"
import { config } from "utils"
import * as vscode from "vscode"
import { ProgressLocation, window } from "vscode"
import { USER_BIN_PATH } from "./langserver"

interface ExecResult {
	stdout: string
	stderr: string
}

async function execAsync(command: string, options?: ExecOptions): Promise<ExecResult> {
	return new Promise((resolve, reject) => {
		childExec(command, options ?? {}, (error, stdout, stderr) => {
			if (error) {
				reject(error)
				return
			}
			const stdoutText = typeof stdout === "string" ? stdout : stdout.toString()
			const stderrText = typeof stderr === "string" ? stderr : stderr.toString()
			resolve({ stdout: stdoutText, stderr: stderrText })
		})
	})
}

// simple util to normalize unknown errors
function toError(e: unknown): Error {
	if (e instanceof Error) {
		return e
	}
	if (typeof e === "string") {
		return new Error(e)
	}
	return new Error(inspect(e))
}

interface GitHubAsset {
	name: string
	browser_download_url: string
}

interface GitHubRelease {
	draft: boolean
	prerelease: boolean
	tag_name: string
	assets: GitHubAsset[]
}

interface ReleaseAssetInfo {
	url: string
	version: string
}

function isGitHubAsset(value: unknown): value is GitHubAsset {
	if (typeof value !== "object" || value === null) return false
	const record = value as Record<string, unknown>
	return typeof record.name === "string" && typeof record.browser_download_url === "string"
}

function isGitHubRelease(value: unknown): value is GitHubRelease {
	if (typeof value !== "object" || value === null) return false
	const record = value as Record<string, unknown>
	return (
		typeof record.draft === "boolean" &&
		typeof record.prerelease === "boolean" &&
		typeof record.tag_name === "string" &&
		Array.isArray(record.assets) &&
		record.assets.every(isGitHubAsset)
	)
}

function selectAssetForPlatform(assets: GitHubAsset[]): GitHubAsset | undefined {
	const platform = process.platform
	const arch = process.arch
	const matchAsset = (needles: string[], bans: string[] = []): GitHubAsset | undefined => {
		const wanted = needles.map((value) => value.toLowerCase())
		const blocked = bans.map((value) => value.toLowerCase())
		return assets.find((asset) => {
			const name = asset.name.toLowerCase()
			return (
				wanted.every((fragment) => name.includes(fragment)) &&
				!blocked.some((fragment) => name.includes(fragment))
			)
		})
	}

	if (platform === "win32") {
		return matchAsset(["v_windows"]) ?? matchAsset(["windows"]) ?? matchAsset(["win"], ["arm"])
	}

	if (platform === "linux") {
		if (arch === "arm64") {
			return (
				matchAsset(["v_linux_arm64"]) ??
				matchAsset(["linux", "arm64"]) ??
				matchAsset(["linux", "aarch64"])
			)
		}
		return (
			matchAsset(["v_linux"], ["arm64", "aarch64"]) ??
			matchAsset(["linux"], ["arm64", "aarch64"])
		)
	}

	if (platform === "darwin") {
		if (arch === "arm64") {
			return (
				matchAsset(["v_macos_arm64"]) ??
				matchAsset(["macos", "arm64"]) ??
				matchAsset(["darwin", "arm64"])
			)
		}
		return (
			matchAsset(["v_macos_x86_64"]) ??
			matchAsset(["macos", "x86_64"]) ??
			matchAsset(["macos", "x64"]) ??
			matchAsset(["darwin", "x64"]) ??
			matchAsset(["macos"])
		)
	}

	return undefined
}
export interface VInstalledStatus {
	installed: boolean
	version?: string
}

/**
 * Checks if the 'v' command is available in the system's PATH.
 * @returns A promise that resolves to the installation status and detected version (if any).
 */
export async function isVInstalled(): Promise<VInstalledStatus> {
	const vexec = getVExecCommand()
	try {
		// A simple command to check if V is installed and in the PATH.
		const version = await execAsync(`${vexec} --version`)
		const versionText = version.stdout.trim()
		log(`V is already installed${versionText ? `, version: ${versionText}` : ""}`)
		return { installed: true, version: versionText || undefined }
	} catch (error: unknown) {
		const err = toError(error)
		log(`V is not detected in PATH: ${err.message}`)
		return { installed: false }
	}
}
/**
 * Clone and build the `v` compiler
 *
 * Returns: absolute path to the `v` binary (string)
 * Error: rejects if any git/make step fails
 */
export async function installV(): Promise<void> {
	const releaseChannel = config().get<string>("releaseChannel")
	switch (releaseChannel) {
		case "stable": {
			const { url, version } = await getLatestStableAssetUrl()
			await installVFromAsset(url, version)
			return
		}
		case "nightly": {
			const { url, version } = await getLatestAssetUrl()
			await installVFromAsset(url, version)
			return
		}
		case "custom":
			await buildVfromPath()
			return
		default:
			await buildVfromPath()
	}
}

export async function buildVfromPath(): Promise<string> {
	const vRepoPath = config().get<string>("buildPath")

	if (!vRepoPath || !fs.existsSync(vRepoPath)) {
		void window.showErrorMessage(
			`Custom V path "${vRepoPath}" does not exist. Please check your settings.`,
		)
		throw new Error("Custom V path does not exist.")
	}

	const binaryPath = path.join(vRepoPath, os.platform() === "win32" ? "v.exe" : "v")

	await window.withProgress(
		{
			location: ProgressLocation.Notification,
			title: "Installing V Language",
			cancellable: false,
		},
		async (progress) => {
			try {
				progress.report({
					message: "Building V from source (this may take a moment)...",
				})
				await execAsync("make", { cwd: vRepoPath })

				progress.report({ message: "Attempting to create symlink..." })

				try {
					const symlinkCommand =
						os.platform() === "win32" ? "v.exe symlink" : "./v symlink"
					await execAsync(symlinkCommand, { cwd: vRepoPath })

					window.showInformationMessage(
						"V language installed and linked successfully! Please restart VS Code to use the `v` command.",
					)
				} catch (symlinkError: unknown) {
					console.error(symlinkError)
					window.showWarningMessage(
						`V was built successfully, but the automatic symlink failed (likely due to permissions). Please run '${path.join(vRepoPath, "v")} symlink' manually with administrator/sudo rights.`,
						"OK",
					)
				}
			} catch (error: unknown) {
				console.error(error)
				window.showErrorMessage(
					`Failed to install V. Please check the logs for details. Error: ${toError(error).message}`,
				)
				throw toError(error)
			}
		},
	)

	return binaryPath
}

/**
 * Try to locate the V binary on the system.
 */
async function findVBinary(): Promise<string | null> {
	try {
		const cmd = process.platform === "win32" ? "where v" : "which v"
		const { stdout } = await execAsync(cmd)
		return stdout.split("\n")[0].trim() || null
	} catch {
		return null
	}
}

export async function removeV(): Promise<void> {
	const vPath = await findVBinary()

	if (!vPath || !fs.existsSync(vPath)) {
		log("No V binary found on this system.")
		return
	}

	try {
		await fs.promises.unlink(vPath)
		window.showInformationMessage(`Removed V binary at ${vPath}.`)
	} catch (err: unknown) {
		const error = toError(err)
		window.showErrorMessage(`Failed to remove V binary: ${error.message}`)
		throw error
	}
}

export async function getLatestStableAssetUrl(): Promise<ReleaseAssetInfo> {
	const res = await fetch("https://api.github.com/repos/vlang/v/releases", {
		headers: { "User-Agent": "vscode-vlang-extension" },
		redirect: "follow",
	})

	if (!res.ok) {
		throw new Error(`Failed to fetch releases: ${res.status} ${res.statusText}`)
	}

	const parsed = (await res.json()) as unknown

	if (!Array.isArray(parsed)) {
		throw new Error("Unexpected release payload format")
	}

	const releases = parsed.filter(isGitHubRelease)

	// Find first non-weekly, non-draft, non-prerelease release
	const stable = releases.find(
		(release) =>
			!release.draft && !release.prerelease && !release.tag_name.startsWith("weekly."),
	)

	if (!stable) {
		throw new Error("No stable release found")
	}

	const asset = selectAssetForPlatform(stable.assets)
	if (!asset) {
		throw new Error("No matching binary for this OS")
	}

	return {
		url: asset.browser_download_url,
		version: stable.tag_name,
	}
}

export async function getLatestAssetUrl(): Promise<ReleaseAssetInfo> {
	const res = await fetch("https://api.github.com/repos/vlang/v/releases/latest", {
		headers: { "User-Agent": "vscode-vlang-extension" },
		redirect: "follow",
	})

	if (!res.ok) {
		throw new Error(`Failed to fetch latest release: ${res.status} ${res.statusText}`)
	}

	const parsed = (await res.json()) as unknown

	if (!isGitHubRelease(parsed)) {
		throw new Error("Unexpected release payload format")
	}

	const asset = selectAssetForPlatform(parsed.assets)
	if (!asset) {
		throw new Error("No matching binary for this OS")
	}

	return {
		url: asset.browser_download_url,
		version: parsed.tag_name,
	}
}

export async function installVFromAsset(
	assetUrl: string,
	tagName: string,
	isUpdate: boolean = false,
): Promise<string> {
	return await window.withProgress(
		{
			location: ProgressLocation.Notification,
			title: isUpdate ? "Updating V Language" : "Installing V Language",
			cancellable: false,
		},
		async (progress) => {
			progress.report({
				message: "Downloading V...",
			})
			const storageDir = USER_BIN_PATH
			const vDir = path.join(storageDir, "v")
			const vExecPath = path.join(storageDir, process.platform === "win32" ? "v.exe" : "v")

			// Remove remnants of a previous download so we do not mix files from different releases.
			try {
				if (fs.existsSync(vDir)) {
					progress.report({ message: "Cleaning previous V installation..." })
					await fs.promises.rm(vDir, { recursive: true, force: true })
				}
				if (fs.existsSync(vExecPath)) {
					await fs.promises.rm(vExecPath, { force: true })
				}
			} catch (cleanupError) {
				console.warn("Failed to fully clean previous V installation:", cleanupError)
			}

			fs.mkdirSync(storageDir, { recursive: true })
			const tmpFile = path.join(storageDir, path.basename(assetUrl))
			if (fs.existsSync(tmpFile)) {
				await fs.promises.rm(tmpFile, { force: true })
			}

			await downloadFile(assetUrl, tmpFile)

			progress.report({
				message: "Extracting V...",
			})
			const lowerUrl = assetUrl.toLowerCase()
			if (lowerUrl.endsWith(".zip")) {
				await extract(tmpFile, { dir: storageDir })
			} else if (lowerUrl.endsWith(".tar.gz")) {
				await tar.x({ file: tmpFile, cwd: storageDir })
			} else {
				throw new Error(`Unknown archive format: ${assetUrl}`)
			}
			progress.report({
				message: "Finishing",
			})
			fs.unlinkSync(tmpFile)
			// On Windows, the build script handles the path. On Linux/macOS, symlink is used.
			const symlinkCommand = os.platform() === "win32" ? "v.exe symlink" : "./v symlink"
			try {
				await execAsync(symlinkCommand, { cwd: vDir })

				window.showInformationMessage(
					"V language installed and linked successfully! Please restart VS Code to use the `v` command.",
				)
			} catch (symlinkError) {
				console.error(symlinkError)
				window.showWarningMessage(
					`V was built successfully, but the automatic symlink failed (likely due to permissions). Please run 'cd ${vDir} && ${symlinkCommand}' manually with administrator/sudo rights.`,
					"OK",
				)
			}

			if (fs.existsSync(vExecPath)) {
				fs.chmodSync(vExecPath, 0o755)
			}

			try {
				const { installed, version } = await isVInstalled()
				if (installed) {
					const suffix = version ? ` (${version})` : ` (${tagName})`
					window.showInformationMessage(
						`V ${isUpdate ? "updated" : "installed"} successfully${suffix}.`,
					)
				}
			} catch (err: unknown) {
				const error = toError(err)
				window.showErrorMessage(`Failed to run V after install: ${error.message}`)
				throw error
			}

			return vExecPath
		},
	)
}

async function downloadFile(url: string, dest: string): Promise<void> {
	const res = await fetch(url, {
		redirect: "follow",
		headers: { "User-Agent": "vscode-vlang-extension" },
	})

	if (!res.ok || !res.body) {
		throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`)
	}

	const nodeStream = Readable.fromWeb(res.body as unknown as NodeReadableStream)
	await pipeline(nodeStream, fs.createWriteStream(dest))
}

async function updateNightlyBuild(): Promise<void> {
	const vexec = getVExecCommand()
	await window.withProgress(
		{
			location: ProgressLocation.Notification,
			title: "Updating V Nightly",
			cancellable: false,
		},
		async () => {
			try {
				const { stdout, stderr } = await execAsync(`${vexec} up`)
				const combined = `${stdout}${stderr}`.trim()
				const lines =
					combined === ""
						? []
						: combined.split(/\r?\n/).filter((line) => line.trim() !== "")
				const tail = lines.slice(-2).join("\n")
				window.showInformationMessage(
					tail !== "" ? tail : "V nightly build updated successfully.",
				)
			} catch (error: unknown) {
				const err = toError(error)
				log(`Failed to update nightly build: ${err.message}`)
				window.showWarningMessage(`Failed to update V nightly build: ${err.message}`)
			}
		},
	)
}

export async function handleVinstallation(): Promise<void> {
	if (config().get<boolean>("forceCleanInstall")) {
		log("forceCleanInstall is enabled, removing V if exists.")
		vscode.window.showInformationMessage("forceCleanInstall is enabled, removing V if exists.")
		await removeV()
	}

	// Check for V only if it's not installed
	const releaseChannel = config().get<string>("releaseChannel")
	const { installed } = await isVInstalled()
	if (!installed) {
		const selection = await vscode.window.showInformationMessage(
			"The V programming language is not detected on this system. Would you like to install it?",
			{ modal: true }, // Modal makes the user have to choose before continuing
			"Yes",
			"No",
		)

		if (selection === "Yes") {
			await installV()
		}
	} else {
		log("V is already installed, checking for updates.")
		await checkUpdates(releaseChannel)
	}
}

function extractVersionIdentifier(value: string | undefined): string | undefined {
	if (!value) return undefined
	const normalized = value.trim().toLowerCase()
	if (normalized === "") return undefined
	const weeklyMatch = normalized.match(/weekly\.\d{4}\.\d+/)
	if (weeklyMatch) return weeklyMatch[0]
	const semverMatch = normalized.match(/(\d+\.\d+\.\d+)/)
	if (semverMatch) return semverMatch[1]
	return normalized.replace(/^v[\s-]?/, "")
}

function isUpToDate(currentVersion: string | undefined, targetVersion: string): boolean {
	const current = extractVersionIdentifier(currentVersion)
	const target = extractVersionIdentifier(targetVersion)
	if (!target) return false
	if (!current) return false
	return current === target
}

async function checkUpdates(releaseChannel: string | undefined): Promise<void> {
	const channel = releaseChannel ?? "stable"
	if (channel === "custom") {
		log("Skipping auto-update for custom release channel.")
		return
	}

	try {
		if (channel === "nightly") {
			await updateNightlyBuild()
			return
		}

		const latest = await getLatestStableAssetUrl()
		const { version: installedVersion } = await isVInstalled()
		if (isUpToDate(installedVersion, latest.version)) {
			log(`V is up to date (${latest.version}).`)
			return
		}
		log(`Updating V to ${latest.version}.`)
		await installVFromAsset(latest.url, latest.version, true)
	} catch (error: unknown) {
		log(`Failed to check or update V: ${toError(error).message}`)
	}
}
