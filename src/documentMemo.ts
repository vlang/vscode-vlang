import * as vscode from "vscode"

/** CodeLens and code-action providers are asked about the same document over and over
 * while the user types: VS Code re-queries them on every edit and keeps asking while a
 * lightbulb is open. Re-reading and re-splitting the whole document for each query shows
 * up as typing latency, so the parse is memoised per document version — the version
 * advances on every edit, which is what keeps the cache correct.
 */
const parseCache = new Map<string, { value: unknown }>()
const parseCacheLimit = 256

/** Six call sites memoise six different parses of the same document at the same version, so the
 * cache key has to name the parse as well as the version — otherwise whichever provider is asked
 * first decides what the others read back. `parse.name` is not usable here: the production bundle
 * minifies function names, so each parse is identified by a per-process identity instead.
 */
const parseIds = new WeakMap<(source: string) => unknown, number>()
let nextParseId = 0

function parseId(parse: (source: string) => unknown): number {
	const existing = parseIds.get(parse)
	if (existing !== undefined) return existing
	nextParseId += 1
	parseIds.set(parse, nextParseId)
	return nextParseId
}

export function parseByVersion<T>(document: vscode.TextDocument, parse: (source: string) => T): T {
	const cacheKey = `${parseId(parse)}#${document.uri.toString()}#${document.version}`
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
