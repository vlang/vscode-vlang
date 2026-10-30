type Scope = "global" | "workspace" | "workspaceFolder"
type Entry = { value: unknown; scope: Scope }
type FoldingProvider = {
	provideFoldingRanges(document: {
		uri: { toString(): string }
		version: number
		getText(): string
	}): unknown
}

type CodeLensProvider = {
	provideCodeLenses(document: {
		uri: ReturnType<typeof Uri.file>
		version: number
		getText(): string
	}): unknown
}
type FormattingProvider = {
	provideDocumentFormattingEdits(document: {
		getText(): string
		positionAt(offset: number): unknown
	}): unknown
}
type StatusBarItem = {
	text: string
	tooltip: string | undefined
	command: string | undefined
	name: string | undefined
	show(): void
	hide(): void
	dispose(): void
}

// The shape a test hands to a register* function: the subscriptions array it
// pushes disposables into is all any of them read from a real context here.

export const state = {
	settings: new Map<string, Entry>(),
	commands: new Map<string, (...args: unknown[]) => unknown>(),
	information: [] as string[],
	errors: [] as string[],
	logs: [] as string[],
	foldingRanges: [] as FoldingProvider[],
	codeLenses: [] as CodeLensProvider[],
	formattingProviders: [] as FormattingProvider[],
	statusBarItems: [] as StatusBarItem[],
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
	state.codeLenses.length = 0
	state.formattingProviders.length = 0
	state.statusBarItems.length = 0
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
	getConfiguration(section: string, _resource?: unknown) {
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
	registerCodeLensProvider(_selector: unknown, provider: CodeLensProvider) {
		state.codeLenses.push(provider)
		return { dispose: () => undefined }
	},
	registerDocumentFormattingEditProvider(_selector: unknown, provider: FormattingProvider) {
		state.formattingProviders.push(provider)
		return { dispose: () => undefined }
	},
}

export const CodeLens = class {
	constructor(
		readonly range: unknown,
		readonly command: { title: string; command: string; arguments: unknown[] } | undefined,
	) {}
}

export const Range = class {
	constructor(
		readonly startLine: number,
		readonly startCharacter: number,
		readonly endLine: number,
		readonly endCharacter: number,
	) {}
}

export const StatusBarAlignment = { Left: 1, Right: 2 }

export const window = {
	activeTextEditor: undefined as
		| {
				document: {
					uri: ReturnType<typeof Uri.file>
					languageId: string
					getText(): string
				}
				selection: { active: { line: number } }
		  }
		| undefined,
	createStatusBarItem(_alignment?: number, _priority?: number) {
		const item: StatusBarItem = {
			text: "",
			tooltip: undefined,
			command: undefined,
			name: undefined,
			show() {},
			hide() {},
			dispose() {},
		}
		state.statusBarItems.push(item)
		return item
	},
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
