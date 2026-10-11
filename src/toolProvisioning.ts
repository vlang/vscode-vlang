import type { ToolName } from "./toolInstallation"
import { compareVersions } from "./toolVersions"

export interface InstalledTool {
	executable?: string
	revision?: string
	/** Compatible version-only VLS installs cannot be compared by upstream commit. */
	supportedVersion?: string
	/** Used by the editor adapter to avoid replacing settings changed during a build. */
	configuration: string
}

export interface ToolOffer {
	tool: ToolName
	reason: "missing" | "outdated" | "unknown"
	installed: InstalledTool
	latestRevision?: string
	/** Upstream's declared version, when it proves a version-only VLS is older. */
	latestVersion?: string
	/** Asked because the user accepted a tool that needs this one to build. */
	dependency?: boolean
}

export interface ProvisioningHost {
	inspect(tool: ToolName): Promise<InstalledTool>
	latest(tool: ToolName): Promise<string>
	latestVersion(tool: ToolName, revision: string): Promise<string | undefined>
	status(
		tool: ToolName,
		revision: string | undefined,
		latest: string,
	): Promise<"current" | "outdated" | "unknown">
	choose(offer: ToolOffer): Promise<boolean>
	install(tool: ToolName, revision: string, compiler?: string): Promise<string>
	use(tool: ToolName, executable: string, previous: InstalledTool): Promise<void>
}

export type ProvisioningResult =
	"current" | "supported" | "latestVersion" | "unchecked" | "declined" | "installed"

/** Product decisions are independent of VS Code, network access and process execution. */
export class ToolProvisioner {
	constructor(private readonly host: ProvisioningHost) {}

	async check(
		tool: ToolName,
		checkUpdates: boolean,
		manual = false,
		dependency = false,
	): Promise<ProvisioningResult> {
		const installed = await this.host.inspect(tool)
		let latestRevision: string | undefined
		let latestVersion: string | undefined
		let reason: ToolOffer["reason"] = "missing"
		if (installed.executable) {
			if (!checkUpdates) return "unchecked"
			if (tool === "vls" && installed.supportedVersion && !installed.revision) {
				// A version-only build cannot be compared by commit. Only a manual
				// request asks upstream whether it now declares a newer version.
				if (!manual) return "supported"
				latestRevision = await this.host.latest(tool)
				latestVersion = await this.host.latestVersion(tool, latestRevision)
				if (latestVersion === undefined) return "supported"
				if ((compareVersions(latestVersion, installed.supportedVersion) ?? 0) <= 0)
					return "latestVersion"
				reason = "outdated"
			} else {
				latestRevision = await this.host.latest(tool)
				const status = await this.host.status(tool, installed.revision, latestRevision)
				if (status === "current") return "current"
				if (tool === "vls" && installed.supportedVersion && status === "unknown")
					return "supported"
				reason = status
			}
		}
		if (
			!(await this.host.choose({
				tool,
				reason,
				installed,
				latestRevision,
				latestVersion,
				...(dependency ? { dependency } : {}),
			}))
		)
			return "declined"
		latestRevision ??= await this.host.latest(tool)
		// An installed V speeds up building V; the installer falls back without it.
		let compiler = tool === "v" ? installed.executable : undefined
		if (tool === "vls") {
			compiler = (await this.host.inspect("v")).executable
			if (!compiler) {
				await this.check("v", false, manual, true)
				compiler = (await this.host.inspect("v")).executable
				if (!compiler)
					throw new Error(
						"VLS needs V to build. Install V first, then run V: Install or Update VLS.",
					)
			}
		}
		const executable = await this.host.install(tool, latestRevision, compiler)
		await this.host.use(tool, executable, installed)
		return "installed"
	}
}
