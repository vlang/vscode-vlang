import * as vscode from "vscode"
import { createHash } from "crypto"
import { outputChannel } from "./logger"
import { migratedSetting } from "./settings"
import { installTool, readManagedToolInstallation, ToolName } from "./toolInstallation"
import { InstalledTool, ToolOffer, ToolProvisioner } from "./toolProvisioning"
import {
	getLatestRelease,
	getLatestRevision,
	getUpdateStatus,
	isSupportedVlsRevision,
	isSupportedVlsVersion,
	MIN_VLS_REVISION,
	readVlsIdentity,
	readVRevision,
	VLS_SUPPORT_BASELINE,
} from "./toolVersions"
import { resolvedCommand } from "./vCommand"

const day = 24 * 60 * 60 * 1000

/** VLS publishes no regular releases, so only V can follow its release tags. */
function followsRelease(tool: ToolName): boolean {
	return (
		tool === "v" &&
		vscode.workspace.getConfiguration("v.tools").get<string>("updateChannel") === "release"
	)
}

interface ToolConfiguration {
	resource?: string
	command: string
	args: string[]
	target: vscode.ConfigurationTarget
	argsTarget: vscode.ConfigurationTarget
}

function targetFor(
	section: string,
	key: string,
	legacyKey: string,
	resource?: vscode.Uri,
): vscode.ConfigurationTarget {
	const current = vscode.workspace.getConfiguration(section, resource).inspect(key)
	const hasValue =
		current &&
		[current.globalValue, current.workspaceValue, current.workspaceFolderValue].some(
			(value) => value !== undefined,
		)
	const source = hasValue
		? current
		: vscode.workspace.getConfiguration("vls", resource).inspect(legacyKey)
	if (source?.workspaceFolderValue !== undefined)
		return vscode.ConfigurationTarget.WorkspaceFolder
	if (source?.workspaceValue !== undefined) return vscode.ConfigurationTarget.Workspace
	return vscode.ConfigurationTarget.Global
}

function configurationFor(tool: ToolName, resource?: vscode.Uri): ToolConfiguration {
	const section = tool === "v" ? "v" : "v.vls"
	const key = tool === "v" ? "executablePath" : "command"
	const legacyKey = tool === "v" ? "vCommand" : "command"
	const commandTarget = targetFor(section, key, legacyKey, resource)
	const argsTarget = targetFor("v.vls", "args", "args", resource)
	// Keep an override local when either the old command or its arguments are local.
	const target = tool === "vls" ? Math.max(commandTarget, argsTarget) : commandTarget
	return {
		resource: resource?.toString(),
		command:
			migratedSetting(
				section,
				key,
				"vls",
				legacyKey,
				tool === "v" ? "v" : "vls",
				resource,
			).trim() || tool,
		args:
			tool === "vls"
				? migratedSetting("v.vls", "args", "vls", "args", [] as string[], resource)
				: [],
		target,
		argsTarget: target,
	}
}

/** Offers installations without delaying activation or modifying external tool directories. */
export class ToolManager implements vscode.Disposable {
	private readonly abort = new AbortController()
	private readonly subscriptions: vscode.Disposable[]
	private readonly provisioner: ToolProvisioner
	private pending: Promise<void> | undefined
	private resource: vscode.Uri | undefined
	private manualCheck = false
	private userChoseInstall = false
	private readonly revisions = new Map<ToolName, Promise<string>>()
	private readonly releaseTags = new Map<ToolName, string>()

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly configure: (update: () => Promise<void>) => Promise<void>,
	) {
		this.provisioner = new ToolProvisioner({
			inspect: (tool) => this.inspect(tool),
			latest: (tool) => this.latest(tool),
			status: (tool, revision, latest) =>
				getUpdateStatus(tool, revision, latest, this.abort.signal),
			choose: (offer) => this.choose(offer),
			install: (tool, revision, compiler) => this.install(tool, revision, compiler),
			use: (tool, executable, previous) => this.use(tool, executable, previous),
		})
		this.subscriptions = [
			vscode.commands.registerCommand("v.tools.checkForUpdates", () => this.check(true)),
			vscode.commands.registerCommand("v.install", () => this.check(true, "v")),
			vscode.commands.registerCommand("v.vls.update", () => this.check(true, "vls")),
			vscode.workspace.onDidGrantWorkspaceTrust(() => {
				void this.check()
			}),
		]
	}

	check(manual = false, only?: ToolName): Promise<void> {
		if (this.abort.signal.aborted) return Promise.resolve()
		if (!vscode.workspace.isTrusted) {
			if (manual)
				void vscode.window.showInformationMessage(
					"Trust this workspace before installing or checking V tools.",
				)
			return Promise.resolve()
		}
		if (this.pending)
			return manual ? this.pending.then(() => this.check(manual, only)) : this.pending
		this.manualCheck = manual
		this.resource =
			(vscode.window.activeTextEditor
				? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
				: undefined
			)?.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri
		this.revisions.clear()
		this.releaseTags.clear()
		this.pending = this.checkTools(manual, only).finally(() => {
			this.pending = undefined
		})
		return this.pending
	}

	private async checkTools(manual: boolean, only?: ToolName): Promise<void> {
		const tools: ToolName[] = only
			? [only]
			: vscode.workspace.getConfiguration("v.vls").get<boolean>("enable", true)
				? ["v", "vls"]
				: ["v"]
		const results: string[] = []
		for (const tool of tools) {
			if (this.abort.signal.aborted) return
			this.userChoseInstall = false
			const configuration = configurationFor(tool, this.resource)
			const identity = createHash("sha256")
				.update(JSON.stringify(configuration))
				.update(followsRelease(tool) ? "release" : "master")
				.update(resolvedCommand(configuration.command, this.resource?.fsPath) ?? "missing")
				.digest("hex")
			const key = `tools.lastUpdateCheck.${tool}.${identity}`
			const checkUpdates =
				manual ||
				(vscode.workspace
					.getConfiguration("v.tools")
					.get<boolean>("checkForUpdates", true) &&
					Date.now() - this.context.globalState.get<number>(key, 0) >= day)
			try {
				// Missing-tool prompts are independent of update checks and network availability.
				const result = await this.provisioner.check(tool, checkUpdates)
				results.push(`${tool.toUpperCase()}: ${result}`)
			} catch (error) {
				if (
					this.abort.signal.aborted ||
					(error instanceof Error && error.name === "AbortError")
				)
					continue
				outputChannel.error(`${tool.toUpperCase()}: ${String(error)}`)
				if (manual || this.userChoseInstall)
					void vscode.window
						.showErrorMessage(
							`${tool.toUpperCase()}: ${error instanceof Error ? error.message : String(error)}`,
							"Show Output",
						)
						.then((action) => {
							if (action) outputChannel.show()
						})
			} finally {
				if (checkUpdates) await this.context.globalState.update(key, Date.now())
			}
		}
		if (
			manual &&
			results.length === tools.length &&
			results.every((result) => result.endsWith(": current"))
		) {
			void vscode.window.showInformationMessage(
				followsRelease("v") && tools.includes("v")
					? tools.length === 1
						? "V is up to date with the latest release."
						: "V is up to date with the latest release and VLS with upstream."
					: `${tools.map((tool) => tool.toUpperCase()).join(" and ")} are up to date with upstream.`,
			)
		}
		if (manual && results.some((result) => result === "VLS: supported")) {
			void vscode.window.showInformationMessage(
				"The installed VLS version is supported. Its build revision is unavailable for comparison with upstream.",
			)
		}
	}

	private async inspect(tool: ToolName): Promise<InstalledTool> {
		const configuration = configurationFor(tool, this.resource)
		const executable = resolvedCommand(configuration.command, this.resource?.fsPath)
		const managed = executable
			? await readManagedToolInstallation(
					executable,
					tool,
					this.context.globalStorageUri.fsPath,
				)
			: undefined
		const supportedManagedRevision =
			managed &&
			(tool !== "vls" ||
				managed.vlsBaseline === VLS_SUPPORT_BASELINE ||
				managed.revision === MIN_VLS_REVISION ||
				(await isSupportedVlsRevision(
					managed.executable,
					managed.revision,
					this.abort.signal,
				)))
		const managedRevision = supportedManagedRevision ? managed?.revision : undefined
		const vlsIdentity =
			tool === "vls" && executable && !managedRevision
				? await readVlsIdentity(executable, this.abort.signal, { args: configuration.args })
				: undefined
		const revision =
			managedRevision ??
			vlsIdentity?.revision ??
			(tool === "v" && executable
				? await readVRevision(executable, this.abort.signal)
				: undefined)
		return {
			executable,
			revision,
			supportedVersion: isSupportedVlsVersion(vlsIdentity?.version)
				? vlsIdentity?.version
				: undefined,
			configuration: JSON.stringify(configuration),
		}
	}

	private latest(tool: ToolName): Promise<string> {
		let revision = this.revisions.get(tool)
		if (!revision) {
			revision = followsRelease(tool)
				? getLatestRelease(tool, this.abort.signal).then((release) => {
						this.releaseTags.set(tool, release.tag)
						return release.revision
					})
				: getLatestRevision(tool, this.abort.signal)
			this.revisions.set(tool, revision)
		}
		return revision
	}

	private async choose(offer: ToolOffer): Promise<boolean> {
		if (this.abort.signal.aborted) return false
		const identity = `${offer.installed.configuration}:${offer.installed.executable ?? ""}:${offer.installed.revision ?? ""}`
		const dismissalKey = `tools.dismissedUnknown.${offer.tool}.${createHash("sha256").update(identity).digest("hex")}`
		if (
			offer.reason === "unknown" &&
			!this.manualCheck &&
			this.context.globalState.get<boolean>(dismissalKey, false)
		)
			return false
		const name = offer.tool.toUpperCase()
		const label = offer.reason === "outdated" ? "Update and Use" : "Install and Use"
		const release = followsRelease(offer.tool)
		const tag = this.releaseTags.get(offer.tool)
		const reason =
			offer.reason === "missing"
				? `${name} was not found.`
				: offer.reason === "outdated"
					? release && tag
						? `${name} ${tag} is available.`
						: `A newer ${name} revision is available (${offer.latestRevision?.slice(0, 8)}).`
					: `The installed ${name} revision cannot be verified.`
		const target = release
			? tag
				? `${name} ${tag}`
				: `the latest ${name} release`
			: `the latest upstream ${name}`
		const action = await vscode.window.showInformationMessage(
			`${reason} Build ${target} in extension storage and use it here? Requires Git, GNU make, a shell and a C compiler${offer.tool === "vls" ? " plus V; VLS arguments will be reset" : ""}. Existing installations are kept.`,
			label,
			"Open Settings",
			"Later",
		)
		if (action === "Open Settings") {
			void vscode.commands.executeCommand(
				"workbench.action.openSettings",
				offer.tool === "v" ? "v.executablePath" : "@ext:vlanguage.vscode-vlang",
			)
		}
		if (offer.reason === "unknown" && action !== label)
			await this.context.globalState.update(dismissalKey, true)
		const accepted = action === label && !this.abort.signal.aborted
		if (accepted) this.userChoseInstall = true
		return accepted
	}

	private async install(tool: ToolName, revision: string, compiler?: string): Promise<string> {
		return vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Installing ${tool.toUpperCase()}`,
				cancellable: true,
			},
			async (progress, token) => {
				const controller = new AbortController()
				const cancel = () => controller.abort()
				this.abort.signal.addEventListener("abort", cancel, { once: true })
				const subscription = token.onCancellationRequested(cancel)
				try {
					if (this.abort.signal.aborted || token.isCancellationRequested)
						controller.abort()
					const installation = await installTool(
						tool,
						revision,
						this.context.globalStorageUri.fsPath,
						compiler,
						{
							signal: controller.signal,
							onOutput: (text) => outputChannel.append(text),
							onProgress: (message) => progress.report({ message }),
						},
					)
					return installation.executable
				} finally {
					subscription.dispose()
					this.abort.signal.removeEventListener("abort", cancel)
				}
			},
		)
	}

	private async use(tool: ToolName, executable: string, previous: InstalledTool): Promise<void> {
		if (this.abort.signal.aborted) return
		const selected = JSON.parse(previous.configuration) as ToolConfiguration
		const resource = selected.resource ? vscode.Uri.parse(selected.resource) : undefined
		if (JSON.stringify(configurationFor(tool, resource)) !== previous.configuration) {
			throw new Error(
				`Settings changed during installation. The new executable is at ${executable}; select it in settings when ready.`,
			)
		}
		const configuration = vscode.workspace.getConfiguration(
			tool === "v" ? "v" : "v.vls",
			resource,
		)
		// Both updates target the effective scope, including legacy workspace settings.
		await this.configure(async () => {
			if (this.abort.signal.aborted) return
			if (JSON.stringify(configurationFor(tool, resource)) !== previous.configuration) {
				throw new Error(
					`Settings changed during installation. The new executable is at ${executable}; select it in settings when ready.`,
				)
			}
			const argsInspection = configuration.inspect<string[]>("args")
			const previousArgs =
				selected.argsTarget === vscode.ConfigurationTarget.WorkspaceFolder
					? argsInspection?.workspaceFolderValue
					: selected.argsTarget === vscode.ConfigurationTarget.Workspace
						? argsInspection?.workspaceValue
						: argsInspection?.globalValue
			const resetArgs = tool === "vls" && selected.args.length > 0
			if (resetArgs) await configuration.update("args", [], selected.argsTarget)
			try {
				this.abort.signal.throwIfAborted()
				await configuration.update(
					tool === "v" ? "executablePath" : "command",
					executable,
					selected.target,
				)
			} catch (error) {
				if (resetArgs) await configuration.update("args", previousArgs, selected.argsTarget)
				throw error
			}
		})
		if (this.abort.signal.aborted) return
		outputChannel.info(`Using ${tool.toUpperCase()} at ${executable}`)
		void vscode.window.showInformationMessage(`${tool.toUpperCase()} installed and configured.`)
	}

	dispose(): void {
		this.abort.abort()
		for (const subscription of this.subscriptions) subscription.dispose()
	}
}
