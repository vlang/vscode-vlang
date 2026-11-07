import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"

const section = "v.pathIntellisense"

export interface PathIntellisenseConfig {
	enabled: boolean
	showHiddenFiles: boolean
	autoSlashAfterDirectory: boolean
	autoTriggerNextSuggestion: boolean
	absolutePathToWorkspace: boolean
	mappings: Record<string, string>
}

export function readConfig(): PathIntellisenseConfig {
	const cfg = vscode.workspace.getConfiguration(section)
	return {
		enabled: cfg.get<boolean>("enabled", true),
		showHiddenFiles: cfg.get<boolean>("showHiddenFiles", false),
		autoSlashAfterDirectory: cfg.get<boolean>("autoSlashAfterDirectory", true),
		autoTriggerNextSuggestion: cfg.get<boolean>("autoTriggerNextSuggestion", false),
		absolutePathToWorkspace: cfg.get<boolean>("absolutePathToWorkspace", true),
		mappings: cfg.get<Record<string, string>>("mappings", {}),
	}
}

export function extractStringPrefix(line: string, character: number): string | null {
	const before = line.slice(0, character)
	const quoteIndex = Math.max(
		before.lastIndexOf('"'),
		before.lastIndexOf("'"),
		before.lastIndexOf("`"),
	)
	if (quoteIndex < 0) return null
	const afterQuote = before.slice(quoteIndex + 1)
	if (afterQuote.includes("\n")) return null
	// A closing quote before the cursor means we are not inside a string.
	const closingQuote = afterQuote.search(/["'`]/)
	if (closingQuote >= 0) return null
	return afterQuote
}

export function applyMappings(
	prefix: string,
	mappings: Record<string, string>,
	workspaceRoot: string,
): string {
	let result = prefix
	for (const [key, value] of Object.entries(mappings)) {
		const normalizedKey = key.endsWith("/") || key.endsWith("\\") ? key : key + "/"
		if (result === key || result.startsWith(normalizedKey)) {
			const mapped = value
				.replace(/\$\{workspaceFolder\}/g, workspaceRoot)
				.replace(/\$\{workspaceRoot\}/g, workspaceRoot)
			result = mapped + result.slice(key.length)
			break
		}
	}
	return result
}

export function resolveDirectory(
	prefix: string,
	documentDir: string,
	workspaceRoot: string,
	mappings: Record<string, string>,
	absolutePathToWorkspace: boolean,
): string {
	const mapped = applyMappings(prefix, mappings, workspaceRoot)
	if (mapped.startsWith("/") || mapped.startsWith("\\")) {
		if (absolutePathToWorkspace && workspaceRoot) {
			return path.resolve(workspaceRoot, mapped.replace(/^[/\\]/, ""))
		}
		return path.resolve(mapped)
	}
	const directoryPart =
		mapped.endsWith("/") || mapped.endsWith("\\") ? mapped : path.dirname(mapped)
	if (directoryPart === "." || directoryPart === "") {
		return documentDir
	}
	return path.resolve(documentDir, directoryPart)
}

export function partialName(prefix: string): string {
	const mapped = prefix
	const lastSlash = Math.max(mapped.lastIndexOf("/"), mapped.lastIndexOf("\\"))
	if (lastSlash < 0) return mapped
	return mapped.slice(lastSlash + 1)
}

export function listEntries(dir: string, showHiddenFiles: boolean): string[] {
	try {
		return fs
			.readdirSync(dir, { withFileTypes: true })
			.filter((entry) => showHiddenFiles || !entry.name.startsWith("."))
			.map((entry) => (entry.isDirectory() ? entry.name + "/" : entry.name))
	} catch {
		return []
	}
}

export class PathIntellisenseProvider implements vscode.CompletionItemProvider {
	provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
	): vscode.CompletionItem[] | undefined {
		const config = readConfig()
		if (!config.enabled) return undefined

		const line = document.lineAt(position.line).text
		const prefix = extractStringPrefix(line, position.character)
		if (prefix === null) return undefined

		const documentDir = path.dirname(document.uri.fsPath)
		const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ?? ""
		const resolvedPrefix = applyMappings(prefix, config.mappings, workspaceRoot)
		const dir = resolveDirectory(
			prefix,
			documentDir,
			workspaceRoot,
			config.mappings,
			config.absolutePathToWorkspace,
		)
		const partial = partialName(resolvedPrefix).toLowerCase()

		const entries = listEntries(dir, config.showHiddenFiles).filter((entry) =>
			entry.toLowerCase().startsWith(partial),
		)

		const range = new vscode.Range(
			position.line,
			position.character - partialName(resolvedPrefix).length,
			position.line,
			position.character,
		)

		return entries.map((entry) => {
			const isDirectory = entry.endsWith("/") || entry.endsWith("\\")
			const name = isDirectory ? entry.slice(0, -1) : entry
			const item = new vscode.CompletionItem(
				name,
				isDirectory ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File,
			)
			item.insertText = isDirectory && config.autoSlashAfterDirectory ? name + "/" : name
			item.range = range
			if (isDirectory && config.autoTriggerNextSuggestion) {
				item.command = { command: "editor.action.triggerSuggest", title: "Trigger suggest" }
			}
			return item
		})
	}
}
