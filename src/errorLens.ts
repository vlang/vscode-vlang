import * as vscode from "vscode"

const section = "v.errorLens"

interface ErrorLensConfig {
	enabled: boolean
	levels: Set<string>
	messageEnabled: boolean
	messageMaxChars: number
	messageTemplate: string
	delay: number
}

function severityName(severity: vscode.DiagnosticSeverity): string {
	switch (severity) {
		case vscode.DiagnosticSeverity.Error:
			return "error"
		case vscode.DiagnosticSeverity.Warning:
			return "warning"
		case vscode.DiagnosticSeverity.Information:
			return "info"
		case vscode.DiagnosticSeverity.Hint:
			return "hint"
		default:
			return "info"
	}
}

function severityPrefix(name: string): string {
	switch (name) {
		case "error":
			return "⛔"
		case "warning":
			return "⚠"
		case "info":
			return "ℹ"
		case "hint":
			return "🍏"
		default:
			return ""
	}
}

export function readConfig(): ErrorLensConfig {
	const cfg = vscode.workspace.getConfiguration(section)
	return {
		enabled: cfg.get<boolean>("enabled", true),
		levels: new Set(cfg.get<string[]>("enabledDiagnosticLevels", ["error", "warning", "info"])),
		messageEnabled: cfg.get<boolean>("messageEnabled", true),
		messageMaxChars: cfg.get<number>("messageMaxChars", 500),
		messageTemplate: cfg.get<string>("messageTemplate", "$message"),
		delay: cfg.get<number>("delay", 0),
	}
}

export function formatMessage(diagnostic: vscode.Diagnostic, template: string, maxChars: number): string {
	const severity = severityName(diagnostic.severity)
	const code = diagnostic.code === undefined ? "" : String(diagnostic.code)
	const source = diagnostic.source ?? ""
	let message = diagnostic.message.replace(/\s+/g, " ").trim()
	if (message.length > maxChars && maxChars > 0) {
		message = message.slice(0, maxChars) + "…"
	}
	return template
		.replace(/\$message/g, message)
		.replace(/\$severity/g, severityPrefix(severity))
		.replace(/\$source/g, source)
		.replace(/\$code/g, code)
		.trim()
}

const lineBackgroundColors: Record<string, string> = {
	error: "#e4545420",
	warning: "#ff942f20",
	info: "#00b7e420",
	hint: "#17a2a220",
}

const rangeBackgroundColors: Record<string, string> = {
	error: "#e4545419",
	warning: "#ff942f19",
	info: "#00b7e419",
	hint: "#17a2a219",
}

const foregroundColors: Record<string, string> = {
	error: "#e45454",
	warning: "#ff942f",
	info: "#00b7e4",
	hint: "#2faf64",
}

function makeLineDecoration(severity: string): vscode.TextEditorDecorationType {
	return vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor: lineBackgroundColors[severity],
	})
}

function makeRangeDecoration(severity: string): vscode.TextEditorDecorationType {
	return vscode.window.createTextEditorDecorationType({
		backgroundColor: rangeBackgroundColors[severity],
	})
}

const inlineDecorationType = vscode.window.createTextEditorDecorationType({})

export class ErrorLensController implements vscode.Disposable {
	private readonly decorations = new Map<string, vscode.TextEditorDecorationType>()
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
	private disposables: vscode.Disposable[] = []

	constructor() {
		for (const severity of ["error", "warning", "info", "hint"]) {
			this.decorations.set(`line:${severity}`, makeLineDecoration(severity))
			this.decorations.set(`range:${severity}`, makeRangeDecoration(severity))
		}
		this.disposables.push(
			vscode.languages.onDidChangeDiagnostics((event) => {
				for (const uri of event.uris) {
					this.scheduleUpdateForUri(uri)
				}
			}),
			vscode.window.onDidChangeActiveTextEditor(() => this.updateAllVisible()),
			vscode.window.onDidChangeVisibleTextEditors(() => this.updateAllVisible()),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration(section)) {
					this.updateAllVisible()
				}
			}),
		)
		this.updateAllVisible()
	}

	dispose(): void {
		for (const timer of this.timers.values()) clearTimeout(timer)
		this.timers.clear()
		for (const decoration of this.decorations.values()) decoration.dispose()
		this.decorations.clear()
		inlineDecorationType.dispose()
		for (const disposable of this.disposables) disposable.dispose()
		this.disposables = []
	}

	private scheduleUpdateForUri(uri: vscode.Uri): void {
		const key = uri.toString()
		const existing = this.timers.get(key)
		if (existing) clearTimeout(existing)
		const config = readConfig()
		const delay = config.enabled ? Math.max(config.delay, 0) : 0
		const timer = setTimeout(() => {
			this.timers.delete(key)
			this.updateEditorsForUri(uri)
		}, delay)
		this.timers.set(key, timer)
	}

	private updateEditorsForUri(uri: vscode.Uri): void {
		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document.uri.toString() === uri.toString()) {
				this.updateEditor(editor)
			}
		}
	}

	private updateAllVisible(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			this.updateEditor(editor)
		}
	}

	private updateEditor(editor: vscode.TextEditor): void {
		const config = readConfig()
		for (const decoration of this.decorations.values()) {
			editor.setDecorations(decoration, [])
		}
		editor.setDecorations(inlineDecorationType, [])

		if (!config.enabled || editor.document.languageId !== "v") {
			return
		}

		const diagnostics = vscode.languages
			.getDiagnostics(editor.document.uri)
			.filter((diagnostic) => config.levels.has(severityName(diagnostic.severity)))

		const lineRanges: Record<string, vscode.Range[]> = {
			error: [],
			warning: [],
			info: [],
			hint: [],
		}
		const rangeDecorations: Record<string, vscode.Range[]> = {
			error: [],
			warning: [],
			info: [],
			hint: [],
		}
		const messagesByLine = new Map<number, { severity: string; messages: string[] }>()

		for (const diagnostic of diagnostics) {
			const severity = severityName(diagnostic.severity)
			const line = diagnostic.range.start.line
			const lineEnd = editor.document.lineAt(line).range.end
			const wholeLine = new vscode.Range(line, 0, line, lineEnd.character)
			if (!lineRanges[severity]!.some((range) => range.start.line === line)) {
				lineRanges[severity]!.push(wholeLine)
			}
			rangeDecorations[severity]!.push(diagnostic.range)
			if (config.messageEnabled) {
				const entry = messagesByLine.get(line) ?? { severity, messages: [] }
				if (severityRank(severity) < severityRank(entry.severity)) {
					entry.severity = severity
				}
				entry.messages.push(formatMessage(diagnostic, config.messageTemplate, config.messageMaxChars))
				messagesByLine.set(line, entry)
			}
		}

		for (const severity of ["error", "warning", "info", "hint"]) {
			const lineDecoration = this.decorations.get(`line:${severity}`)
			const rangeDecoration = this.decorations.get(`range:${severity}`)
			if (lineDecoration) editor.setDecorations(lineDecoration, lineRanges[severity] ?? [])
			if (rangeDecoration) editor.setDecorations(rangeDecoration, rangeDecorations[severity] ?? [])
		}

		if (config.messageEnabled) {
			const inlineOptions: vscode.DecorationOptions[] = []
			for (const [line, entry] of messagesByLine) {
				const lineEnd = editor.document.lineAt(line).range.end
				inlineOptions.push({
					range: new vscode.Range(lineEnd, lineEnd),
					renderOptions: {
						after: {
							contentText: entry.messages.join("  "),
							color: foregroundColors[entry.severity],
							margin: "1em",
						},
					},
				})
			}
			editor.setDecorations(inlineDecorationType, inlineOptions)
		}
	}
}

function severityRank(severity: string): number {
	switch (severity) {
		case "error":
			return 0
		case "warning":
			return 1
		case "info":
			return 2
		case "hint":
			return 3
		default:
			return 4
	}
}
