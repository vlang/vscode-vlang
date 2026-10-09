import * as vscode from "vscode"

/** CodeLens and code-action providers are asked about the same document over and over
 * while the user types: VS Code re-queries them on every edit and keeps asking while a
 * lightbulb is open. Re-reading and re-splitting the whole document for each query shows
 * up as typing latency, so the parse is memoised per document version — the version
 * advances on every edit, which is what keeps the cache correct.
 */
const parseCache = new Map<string, { value: unknown }>()
const parseCacheLimit = 256

export function parseByVersion<T>(document: vscode.TextDocument, parse: (source: string) => T): T {
	const cacheKey = `${document.uri.toString()}#${document.version}`
	const cached = parseCache.get(cacheKey)
	if (cached) {
		return cached.value as T
	}
	const entry = { value: parse(document.getText()) }
	if (parseCache.size >= parseCacheLimit) {
		parseCache.clear()
	}
	parseCache.set(cacheKey, entry)
	return entry.value as T
}

/** Drop every memoised parse. Used by tests, which need a clean start. */
export function resetParseCache(): void {
	parseCache.clear()
}
