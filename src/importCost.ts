import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { vCommandFor } from "./vExecutable"

const section = "v.importCost"

export interface ImportCostConfig {
	enabled: boolean
	includeTests: boolean
	cacheTtlMs: number
}

export function readConfig(): ImportCostConfig {
	const cfg = vscode.workspace.getConfiguration(section)
	return {
		enabled: cfg.get<boolean>("enabled", true),
		includeTests: cfg.get<boolean>("includeTests", false),
		cacheTtlMs: cfg.get<number>("cacheTtlMs", 60_000),
	}
}

/** An import line without its trailing `//` comment.
 *
 * Import statements carry no strings, so the first `//` always starts a
 * comment rather than a URL or a literal.
 */
function withoutLineComment(line: string): string {
	const comment = line.indexOf("//")
	return (comment < 0 ? line : line.slice(0, comment)).trimEnd()
}

export function parseImports(text: string): { line: number; module: string }[] {
	const result: { line: number; module: string }[] = []
	const lines = text.split(/\r?\n/)
	let inGroup = false
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? ""
		const trimmed = line.trim()
		if (!inGroup) {
			// A trailing comment does not change the statement: `import ( //
			// comment` still opens a group.
			const code = withoutLineComment(trimmed)
			if (code === "import (") {
				inGroup = true
				continue
			}
			if (!trimmed.startsWith("import ")) continue
			// import foo, import foo as bar, import foo { ... }
			const match = /^import\s+([A-Za-z0-9_.]+)/.exec(trimmed)
			if (match?.[1]) {
				result.push({ line: i, module: match[1] })
			}
			continue
		}
		if (trimmed === ")") {
			inGroup = false
			continue
		}
		const match = /^([A-Za-z0-9_.]+)/.exec(trimmed)
		if (match?.[1]) {
			result.push({ line: i, module: match[1] })
		}
	}
	return result
}

function moduleToRelative(moduleName: string): string {
	return moduleName.split(".").join(path.sep)
}

function directoryExists(dir: string): boolean {
	try {
		return fs.statSync(dir).isDirectory()
	} catch {
		return false
	}
}

export function resolveModuleDirectory(
	moduleName: string,
	documentDir: string,
	workspaceRoot: string,
	vExecutable: string,
): string | null {
	if (moduleName.startsWith(".") || moduleName.startsWith("/")) {
		const direct = path.resolve(documentDir, moduleName)
		if (directoryExists(direct)) return direct
		return null
	}
	const relative = moduleToRelative(moduleName)
	const vlib = path.join(path.dirname(vExecutable), "vlib")
	const vmodules = process.env.VMODULES || path.join(os.homedir(), ".vmodules")
	const candidates = [
		path.join(workspaceRoot, relative),
		path.join(workspaceRoot, "src", relative),
		path.join(vlib, relative),
		path.join(vmodules, relative),
	]
	for (const candidate of candidates) {
		if (directoryExists(candidate)) return candidate
	}
	return null
}

export function measureModule(
	dir: string,
	includeTests: boolean,
): { bytes: number; lines: number; files: number } {
	let bytes = 0
	let lines = 0
	let files = 0
	let entries: fs.Dirent[] = []
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true })
	} catch {
		return { bytes, lines, files }
	}
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".v")) continue
		if (!includeTests && entry.name.endsWith("_test.v")) continue
		const fullPath = path.join(dir, entry.name)
		try {
			const stat = fs.statSync(fullPath)
			const content = fs.readFileSync(fullPath, "utf8")
			bytes += stat.size
			lines += content.split(/\r?\n/).length
			files++
		} catch {
			// Ignore unreadable files.
		}
	}
	return { bytes, lines, files }
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	return `${(bytes / 1024).toFixed(1)} KB`
}

interface CacheEntry {
	text: string
	at: number
}

/** Bound the measurement cache: one project can import hundreds of modules,
 * and the entries are per project, so an unbounded map grows with every
 * workspace folder opened in the session.
 */
const cacheLimit = 512

export class ImportCostController implements vscode.Disposable {
	private readonly cache = new Map<string, CacheEntry>()
	private readonly decoration = vscode.window.createTextEditorDecorationType({})
	private disposables: vscode.Disposable[] = []

	constructor() {
		this.disposables.push(
			vscode.window.onDidChangeActiveTextEditor(() => this.updateAll()),
			vscode.workspace.onDidSaveTextDocument(() => this.updateAll()),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration(section)) this.updateAll()
			}),
		)
		this.updateAll()
	}

	dispose(): void {
		this.decoration.dispose()
		for (const disposable of this.disposables) disposable.dispose()
		this.disposables = []
	}

	private updateAll(): void {
		const config = readConfig()
		for (const editor of vscode.window.visibleTextEditors) {
			this.updateEditor(editor, config)
		}
	}

	private updateEditor(editor: vscode.TextEditor, config: ImportCostConfig): void {
		editor.setDecorations(this.decoration, [])
		if (!config.enabled || editor.document.languageId !== "v") return

		const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri)
		const vExecutable = folder ? vCommandFor(folder) : "v"
		const workspaceRoot = folder?.uri.fsPath ?? path.dirname(editor.document.uri.fsPath)
		const documentDir = path.dirname(editor.document.uri.fsPath)
		const imports = parseImports(editor.document.getText())
		const now = Date.now()
		const options: vscode.DecorationOptions[] = []

		for (const imp of imports) {
			// The same module name resolves differently per project, per file
			// location and per compiler: sharing an entry across any of those
			// would decorate one project with another's sizes.
			const cacheKey = `${folder?.uri.fsPath ?? documentDir}\n${vExecutable}\n${imp.module}:${config.includeTests}`
			let entry = this.cache.get(cacheKey)
			if (!entry || now - entry.at > config.cacheTtlMs) {
				const dir = resolveModuleDirectory(
					imp.module,
					documentDir,
					workspaceRoot,
					vExecutable,
				)
				const measured = dir ? measureModule(dir, config.includeTests) : null
				const text = measured
					? `// ${formatSize(measured.bytes)} (${measured.lines} lines, ${measured.files} files)`
					: "// (unresolved)"
				entry = { text, at: now }
				if (this.cache.size >= cacheLimit) {
					this.cache.clear()
				}
				this.cache.set(cacheKey, entry)
			}
			const lineEnd = editor.document.lineAt(imp.line).range.end
			options.push({
				range: new vscode.Range(lineEnd, lineEnd),
				renderOptions: {
					after: {
						contentText: "  " + entry.text,
						margin: "1em",
					},
				},
			})
		}

		editor.setDecorations(this.decoration, options)
	}
}
