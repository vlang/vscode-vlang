import * as vscode from "vscode"
import { createHash } from "crypto"
import * as path from "path"
import { outputChannel } from "./logger"
import {
	automaticCommand,
	effectiveToolSetting,
	initializeManagedTools,
	isAutomaticCommand,
	managedToolKey,
} from "./managedTools"
import { migratedSetting } from "./settings"
import {
	installTool,
	removeInterruptedInstallations,
	removeManagedInstallation,
	readManagedToolInstallation,
	ToolName,
} from "./toolInstallation"
import { InstalledTool, ToolOffer, ToolProvisioner } from "./toolProvisioning"
import {
	getLatestRelease,
	getLatestRevision,
	getUpstreamVlsVersion,
	getUpdateStatus,
	isSupportedVlsVersion,
	MIN_VLS_VERSION,
	readVlsIdentity,
	readVRevision,
} from "./toolVersions"
import { resolvedCommand } from "./vCommand"

const day = 24 * 60 * 60 * 1000
const lastChecksKey = "tools.lastUpdateChecks"
const dismissalsKey = "tools.dismissedOffers"
// Replaced managed installations not yet deleted.
const retiredKey = "tools.retired"
const retainedDismissals = 50

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
	/** What a pending check waits for, so a manual request can explain its delay. */
	private waiting: "prompt" | "install" | undefined
	private cleaning: Promise<void> = Promise.resolve()
	private readonly revisions = new Map<ToolName, Promise<string>>()
	private readonly releaseTags = new Map<ToolName, string>()

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly configure: (update: () => Promise<void>) => Promise<void>,
		/** Whether the language server already reported the configured VLS as unsupported. */
		private readonly vlsRejected: () => Promise<boolean> = () => Promise.resolve(false),
	) {
		initializeManagedTools(context.globalState)
		this.provisioner = new ToolProvisioner({
			inspect: (tool) => this.inspect(tool),
			latest: (tool) => this.latest(tool),
			latestVersion: (tool, revision) =>
				tool === "vls"
					? getUpstreamVlsVersion(revision, this.abort.signal)
					: Promise.resolve(undefined),
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
		void this.cleanUp()
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
		if (this.pending) {
			if (!manual) return this.pending
			if (this.waiting)
				void vscode.window.showInformationMessage(
					this.waiting === "prompt"
						? "Another V tools notification is waiting for your answer; it may be in the Notifications Center. This request runs after you respond to it."
						: "A V tool installation is in progress. This request runs when it finishes.",
				)
			return this.pending.then(() => this.check(manual, only))
		}
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
			const identity = `${tool}.${createHash("sha256")
				.update(JSON.stringify(configuration))
				.update(followsRelease(tool) ? "release" : "master")
				.update(this.executableFor(tool, configuration) ?? "missing")
				.digest("hex")}`
			const checkUpdates =
				manual ||
				(vscode.workspace
					.getConfiguration("v.tools")
					.get<boolean>("checkForUpdates", true) &&
					Date.now() - (this.lastChecks()[identity] ?? 0) >= day)
			// An unavailable check (offline, rate limited) is retried on the next activation.
			let completed = false
			try {
				// Missing-tool prompts are independent of update checks and network availability.
				const result = await this.provisioner.check(tool, checkUpdates, manual)
				completed = true
				results.push(`${tool.toUpperCase()}: ${result}`)
			} catch (error) {
				if (
					this.abort.signal.aborted ||
					(error instanceof Error && error.name === "AbortError")
				) {
					completed = true
					continue
				}
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
				if (checkUpdates && completed) await this.recordCheck(identity)
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
		if (manual && results.includes("VLS: latestVersion")) {
			void vscode.window.showInformationMessage(
				"The installed VLS reports the latest upstream version. It does not report its build commit, so newer commits with the same version cannot be detected.",
			)
		}
		if (manual && results.some((result) => result === "VLS: supported")) {
			void vscode.window.showInformationMessage(
				"The installed VLS version is supported. Its build revision is unavailable for comparison with upstream.",
			)
		}
	}

	private lastChecks(): Record<string, number> {
		return this.context.globalState.get<Record<string, number>>(lastChecksKey, {})
	}

	/** Entries older than a day no longer suppress a check, so they are dropped. */
	private async recordCheck(identity: string): Promise<void> {
		const now = Date.now()
		const checks = Object.fromEntries(
			Object.entries(this.lastChecks()).filter(([, time]) => now - time < day),
		)
		checks[identity] = now
		await this.context.globalState.update(lastChecksKey, checks)
	}

	private dismissals(): Record<string, number> {
		return this.context.globalState.get<Record<string, number>>(dismissalsKey, {})
	}

	private async dismiss(identity: string): Promise<void> {
		const entries = Object.entries({ ...this.dismissals(), [identity]: Date.now() })
			.sort(([, first], [, second]) => second - first)
			.slice(0, retainedDismissals)
		await this.context.globalState.update(dismissalsKey, Object.fromEntries(entries))
	}

	private executableFor(tool: ToolName, configuration: ToolConfiguration): string | undefined {
		return resolvedCommand(
			effectiveToolSetting(tool, configuration.command),
			this.resource?.fsPath,
		)
	}

	private async inspect(tool: ToolName): Promise<InstalledTool> {
		const configuration = configurationFor(tool, this.resource)
		const executable = this.executableFor(tool, configuration)
		const managed = executable
			? await readManagedToolInstallation(
					executable,
					tool,
					this.context.globalStorageUri.fsPath,
				)
			: undefined
		// Support is the reported version; intact managed metadata adds the built
		// commit, which update checks compare with upstream.
		const managedRevision = managed?.revision
		const vlsIdentity =
			tool === "vls" && executable
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
		const identity = `${offer.tool}.${offer.reason}.${createHash("sha256")
			.update(
				`${offer.installed.configuration}:${offer.installed.executable ?? ""}:${offer.installed.revision ?? ""}`,
			)
			.digest("hex")}`
		// Updates are offered again daily; the other offers stay dismissed for this
		// configuration until it changes or the user runs a command.
		// A dependency of a tool the user just accepted is always asked for.
		const dismissible = offer.reason !== "outdated" && !offer.dependency
		if (dismissible && !this.manualCheck && this.dismissals()[identity] !== undefined)
			return false
		// The server's startup error already offers this installation; one notification
		// is enough. Manual requests, and the button in that error, still prompt.
		if (
			!this.manualCheck &&
			offer.tool === "vls" &&
			offer.reason !== "missing" &&
			(await this.vlsRejected())
		)
			return false
		if (this.abort.signal.aborted) return false
		const name = offer.tool.toUpperCase()
		const label = offer.reason === "outdated" ? "Update and Use" : "Install and Use"
		const release = followsRelease(offer.tool)
		const tag = this.releaseTags.get(offer.tool)
		const reason =
			offer.reason === "missing"
				? offer.dependency
					? `${name} was not found, and VLS needs it to build.`
					: `${name} was not found.`
				: offer.reason === "outdated"
					? release && tag
						? `${name} ${tag} is available.`
						: offer.latestVersion
							? `${name} ${offer.latestVersion} is available (installed: ${offer.installed.supportedVersion}).`
							: `A newer ${name} revision is available (${offer.latestRevision?.slice(0, 8)}).`
					: offer.tool === "vls" &&
						  !offer.installed.supportedVersion &&
						  !offer.installed.revision
						? `The installed VLS is older than ${MIN_VLS_VERSION} or does not report its version.`
						: `The installed ${name} revision cannot be verified.`
		const target = release
			? tag
				? `${name} ${tag}`
				: `the latest ${name} release`
			: `the latest upstream ${name}`
		this.waiting = "prompt"
		let action: string | undefined
		try {
			action = await vscode.window.showInformationMessage(
				`${reason} Build ${target} in extension storage and use it? Requires Git, GNU make, a shell and a C compiler${offer.tool === "vls" ? " plus V; VLS arguments will be reset" : ""}. The previous managed installation is kept.`,
				label,
				"Open Settings",
				"Later",
			)
		} finally {
			this.waiting = undefined
		}
		if (action === "Open Settings") {
			void vscode.commands.executeCommand(
				"workbench.action.openSettings",
				offer.tool === "v" ? "v.executablePath" : "@ext:vlanguage.vscode-vlang",
			)
		}
		if (dismissible && action !== label) await this.dismiss(identity)
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
				this.waiting = "install"
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
					this.waiting = undefined
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
		const ensureUnchanged = (): void => {
			if (JSON.stringify(configurationFor(tool, resource)) !== previous.configuration) {
				throw new Error(
					`Settings changed during installation. The new executable is at ${executable}; select it in settings when ready.`,
				)
			}
		}
		ensureUnchanged()
		const configuration = vscode.workspace.getConfiguration(
			tool === "v" ? "v" : "v.vls",
			resource,
		)
		// All updates target the effective scope, including legacy workspace settings.
		await this.configure(async () => {
			if (this.abort.signal.aborted) return
			ensureUnchanged()
			const restores: (() => Thenable<void>)[] = []
			const update = async (key: string, value: unknown): Promise<void> => {
				const inspection = configuration.inspect(key)
				const previousValue =
					selected.target === vscode.ConfigurationTarget.WorkspaceFolder
						? inspection?.workspaceFolderValue
						: selected.target === vscode.ConfigurationTarget.Workspace
							? inspection?.workspaceValue
							: inspection?.globalValue
				await configuration.update(key, value, selected.target)
				restores.unshift(() => configuration.update(key, previousValue, selected.target))
			}
			try {
				if (tool === "vls" && selected.args.length > 0) await update("args", [])
				// An explicit path would shadow the managed executable. The automatic
				// value stays valid on machines that receive it through Settings Sync.
				if (!isAutomaticCommand(tool, selected.command))
					await update(
						tool === "v" ? "executablePath" : "command",
						automaticCommand(tool),
					)
				this.abort.signal.throwIfAborted()
				const replaced = this.context.globalState.get<unknown>(managedToolKey(tool))
				await this.context.globalState.update(managedToolKey(tool), executable)
				// The replaced build is deleted below, or later if it is still in use.
				if (typeof replaced === "string" && replaced !== executable)
					await this.context.globalState.update(retiredKey, [
						...this.retired(),
						path.dirname(replaced),
					])
			} catch (error) {
				for (const restore of restores) await restore()
				throw error
			}
		})
		if (this.abort.signal.aborted) return
		outputChannel.info(`Using ${tool.toUpperCase()} at ${executable}`)
		void vscode.window.showInformationMessage(`${tool.toUpperCase()} installed and configured.`)
		void this.cleanUp()
	}

	private retired(): string[] {
		const value = this.context.globalState.get<unknown>(retiredKey, [])
		return Array.isArray(value)
			? value.filter((entry): entry is string => typeof entry === "string")
			: []
	}

	/** One cleanup at a time; a request during a running one runs after it. */
	private cleanUp(): Promise<void> {
		this.cleaning = this.cleaning.then(() => this.cleanUpOnce())
		return this.cleaning
	}

	/**
	 * Delete replaced managed builds. One that another process still runs, which
	 * Windows does not allow to delete, stays marked and is retried on the next
	 * activation or installation.
	 */
	private async cleanUpOnce(): Promise<void> {
		try {
			await this.removeReplacedInstallations()
		} catch (error) {
			outputChannel.warn(`Could not remove replaced installations: ${String(error)}`)
		}
	}

	private async removeReplacedInstallations(): Promise<void> {
		const storage = this.context.globalStorageUri.fsPath
		const selected = new Set(
			(["v", "vls"] as const).flatMap((tool) => {
				const value = this.context.globalState.get<unknown>(managedToolKey(tool))
				return typeof value === "string" ? [path.dirname(value)] : []
			}),
		)
		const initial = new Set(this.retired())
		const remaining: string[] = []
		for (const directory of initial) {
			if (selected.has(directory)) continue
			if (await removeManagedInstallation(storage, directory))
				outputChannel.info(`Removed replaced installation ${directory}`)
			else remaining.push(directory)
		}
		// Installations retired while this cleanup ran stay marked for the next one.
		const retiredMeanwhile = this.retired().filter((directory) => !initial.has(directory))
		await this.context.globalState.update(retiredKey, [...remaining, ...retiredMeanwhile])
		for (const directory of await removeInterruptedInstallations(storage))
			outputChannel.info(`Removed interrupted installation ${directory}`)
	}

	dispose(): void {
		this.abort.abort()
		for (const subscription of this.subscriptions) subscription.dispose()
	}
}
