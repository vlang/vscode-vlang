import type { ToolName } from "./toolInstallation"

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
}

export interface ProvisioningHost {
	inspect(tool: ToolName): Promise<InstalledTool>
	latest(tool: ToolName): Promise<string>
	status(
		tool: ToolName,
		revision: string | undefined,
		latest: string,
	): Promise<"current" | "outdated" | "unknown">
	choose(offer: ToolOffer): Promise<boolean>
	install(tool: ToolName, revision: string, compiler?: string): Promise<string>
	use(tool: ToolName, executable: string, previous: InstalledTool): Promise<void>
}

export type ProvisioningResult = "current" | "supported" | "unchecked" | "declined" | "installed"

/** Product decisions are independent of VS Code, network access and process execution. */
export class ToolProvisioner {
	constructor(private readonly host: ProvisioningHost) {}

	async check(tool: ToolName, checkUpdates: boolean): Promise<ProvisioningResult> {
		const installed = await this.host.inspect(tool)
		let latestRevision: string | undefined
		let reason: ToolOffer["reason"] = "missing"
		if (installed.executable) {
			if (!checkUpdates) return "unchecked"
			if (tool === "vls" && installed.supportedVersion && !installed.revision)
				return "supported"
			latestRevision = await this.host.latest(tool)
			const status = await this.host.status(tool, installed.revision, latestRevision)
			if (status === "current") return "current"
			if (tool === "vls" && installed.supportedVersion && status === "unknown")
				return "supported"
			reason = status
		}
		if (!(await this.host.choose({ tool, reason, installed, latestRevision })))
			return "declined"
		latestRevision ??= await this.host.latest(tool)
		// An installed V speeds up building V; the installer falls back without it.
		let compiler = tool === "v" ? installed.executable : undefined
		if (tool === "vls") {
			compiler = (await this.host.inspect("v")).executable
			if (!compiler) {
				await this.check("v", false)
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
