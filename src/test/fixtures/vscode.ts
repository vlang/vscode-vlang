type Scope = "global" | "workspace" | "workspaceFolder"
type Entry = { value: unknown; scope: Scope }
type FoldingProvider = {
	provideFoldingRanges(document: {
		uri: { toString(): string }
		version: number
		getText(): string
	}): unknown
}

export const state = {
	settings: new Map<string, Entry>(),
	commands: new Map<string, (...args: unknown[]) => unknown>(),
	information: [] as string[],
	errors: [] as string[],
	logs: [] as string[],
	foldingRanges: [] as FoldingProvider[],
	promptResponse: "Later" as string | undefined,
	prompts: 0,
	updates: [] as string[],
}

export function resetVscode(): void {
	state.settings.clear()
	state.commands.clear()
	state.information.length = 0
	state.errors.length = 0
	state.logs.length = 0
	state.foldingRanges.length = 0
	state.promptResponse = "Later"
	state.prompts = 0
	state.updates.length = 0
	workspace.isTrusted = true
	window.activeTextEditor = undefined
	workspace.workspaceFolders = undefined
}

export function setSetting(key: string, value: unknown, scope: Scope = "global"): void {
	state.settings.set(key, { value, scope })
}

export const ConfigurationTarget = {
	Global: 1,
	Workspace: 2,
	WorkspaceFolder: 3,
}

export const ProgressLocation = { Notification: 15 }

export const Uri = {
	file(fsPath: string) {
		return { fsPath, toString: () => `file://${fsPath}` }
	},
	parse(value: string) {
		return Uri.file(value.replace(/^file:\/\//, ""))
	},
}

export const commands = {
	registerCommand(name: string, callback: (...args: unknown[]) => unknown) {
		state.commands.set(name, callback)
		return { dispose: () => state.commands.delete(name) }
	},
	async executeCommand(name: string, ...args: unknown[]) {
		return state.commands.get(name)?.(...args)
	},
}

export const workspace = {
	isTrusted: true,
	workspaceFolders: undefined as { uri: ReturnType<typeof Uri.file> }[] | undefined,
	getWorkspaceFolder(_uri: unknown) {
		return undefined
	},
	onDidGrantWorkspaceTrust(_callback: () => void) {
		return { dispose() {} }
	},
	getConfiguration(section: string) {
		return {
			get<T>(key: string, fallback?: T): T {
				return (
					(state.settings.get(`${section}.${key}`)?.value as T | undefined) ??
					(fallback as T)
				)
			},
			inspect<T>(key: string) {
				const entry = state.settings.get(`${section}.${key}`)
				if (!entry) return undefined
				return {
					globalValue: entry.scope === "global" ? (entry.value as T) : undefined,
					workspaceValue: entry.scope === "workspace" ? (entry.value as T) : undefined,
					workspaceFolderValue:
						entry.scope === "workspaceFolder" ? (entry.value as T) : undefined,
				}
			},
			async update(key: string, value: unknown, target: number) {
				state.updates.push(`${section}.${key}`)
				setSetting(
					`${section}.${key}`,
					value,
					target === ConfigurationTarget.WorkspaceFolder
						? "workspaceFolder"
						: target === ConfigurationTarget.Workspace
							? "workspace"
							: "global",
				)
			},
		}
	},
}

export const FoldingRange = class {
	start: number
	end: number
	kind: number | undefined

	constructor(start: number, end: number, kind?: number) {
		this.start = start
		this.end = end
		this.kind = kind
	}
}

export const FoldingRangeKind = { Comment: 1, Imports: 2 }

export const languages = {
	registerFoldingRangeProvider(_selector: unknown, provider: FoldingProvider) {
		state.foldingRanges.push(provider)
		return { dispose: () => undefined }
	},
}

export const window = {
	activeTextEditor: undefined as { document: { uri: ReturnType<typeof Uri.file> } } | undefined,
	createOutputChannel(_name: string) {
		return {
			info(message: string) {
				state.logs.push(message)
			},
			warn(message: string) {
				state.logs.push(message)
			},
			error(message: string) {
				state.logs.push(message)
			},
			append(message: string) {
				state.logs.push(message)
			},
			show() {},
			dispose() {},
		}
	},
	async showInformationMessage(message: string, ..._actions: string[]) {
		state.information.push(message)
		state.prompts++
		return state.promptResponse
	},
	async showErrorMessage(message: string, ..._actions: string[]) {
		state.errors.push(message)
		return undefined
	},
	async withProgress<T>(
		_options: unknown,
		task: (
			progress: { report(value: unknown): void },
			token: {
				isCancellationRequested: boolean
				onCancellationRequested(listener: () => void): { dispose(): void }
			},
		) => Promise<T>,
	): Promise<T> {
		return task(
			{ report() {} },
			{
				isCancellationRequested: false,
				onCancellationRequested(_listener) {
					return { dispose() {} }
				},
			},
		)
	},
}
