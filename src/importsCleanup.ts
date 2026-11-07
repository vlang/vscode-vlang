/** Cleanup helpers for V import statements.
 *
 * Everything here is pure so it can be tested without an editor. The editor
 * wiring (commands plus code actions) lives elsewhere.
 *
 * All matching is textual: `v fmt` (V 0.5.2, measured 2026-10-08) preserves
 * import order verbatim, so sorting is done here. Usage detection is
 * deliberately conservative — a name that appears anywhere outside import
 * lines counts as used, and files with selective (`import x {`) or aliased
 * (`import x as y`) imports are left alone because usage cannot be
 * established textually.
 */

const importLinePattern = /^\s*import\b/
const commentLinePattern = /^\s*\/\//
const importPathPattern = /^import\s+(\S+)/
const aliasPattern = /\bas\b/

interface ImportItem {
	comments: string[]
	line: string
	path: string
}

function splitLines(source: string): string[] {
	return source.split("\n")
}

function isImportLine(line: string): boolean {
	return importLinePattern.test(line)
}

function isCommentLine(line: string): boolean {
	return commentLinePattern.test(line)
}

/** The module path of an import line (`net.http` for `import net.http`). */
function importPathOf(line: string): string {
	const code = line.replace(/\s*\/\/.*$/, "").trim()
	const match = importPathPattern.exec(code)
	const path = match?.[1]
	return path ?? code
}

/** Byte-order string comparison. `<`/`>` compare UTF-16 code units, which
 * matches byte order for ASCII module paths. `localeCompare` is avoided
 * because it is locale-dependent.
 */
function compareByteOrder(a: string, b: string): number {
	if (a < b) {
		return -1
	}
	if (a > b) {
		return 1
	}
	return 0
}

/** Sort one blank-line-free run, keeping each import's attached comments. */
function sortRun(group: string[]): string[] {
	const items: ImportItem[] = []
	let pending: string[] = []
	for (const line of group) {
		if (isImportLine(line)) {
			items.push({ comments: pending, line, path: importPathOf(line) })
			pending = []
		} else {
			pending.push(line)
		}
	}
	const trailing = pending
	if (items.length < 2) {
		return group
	}
	const sorted = [...items].sort((a, b) => {
		const byPath = compareByteOrder(a.path, b.path)
		if (byPath !== 0) {
			return byPath
		}
		return compareByteOrder(a.line.trim(), b.line.trim())
	})
	const out: string[] = []
	for (const item of sorted) {
		out.push(...item.comments, item.line)
	}
	out.push(...trailing)
	return out
}

/** Sort contiguous `import` runs alphabetically (case-sensitive byte order).
 *
 * A run is a maximal block of import and `//` comment lines with no blank
 * line inside it, so blank lines split runs and survive untouched. Each
 * import carries the `//` comment lines directly above it along; a comment
 * block after the last import of a run stays in place.
 */
export function sortImports(source: string): string {
	const lines = splitLines(source)
	const out: string[] = []
	let index = 0
	while (index < lines.length) {
		const line = lines[index]
		if (line === undefined) {
			break
		}
		if (!isImportLine(line) && !isCommentLine(line)) {
			out.push(line)
			index += 1
			continue
		}
		const group: string[] = []
		while (index < lines.length) {
			const next = lines[index]
			if (next === undefined || (!isImportLine(next) && !isCommentLine(next))) {
				break
			}
			group.push(next)
			index += 1
		}
		if (group.some(isImportLine)) {
			out.push(...sortRun(group))
		} else {
			out.push(...group)
		}
	}
	return out.join("\n")
}

/** Drop exact-duplicate import lines, keeping the first occurrence. */
export function removeDuplicateImports(source: string): string {
	const seen = new Set<string>()
	const out: string[] = []
	for (const line of splitLines(source)) {
		if (isImportLine(line)) {
			const key = line.trim()
			if (seen.has(key)) {
				continue
			}
			seen.add(key)
		}
		out.push(line)
	}
	return out.join("\n")
}

/** The last dotted segment of an import path (`http` for `net.http`). */
function importNameOf(line: string): string | undefined {
	const code = line.replace(/\s*\/\/.*$/, "").trim()
	const match = importPathPattern.exec(code)
	const path = match?.[1]
	if (path === undefined) {
		return undefined
	}
	const segments = path.split(".")
	return segments[segments.length - 1]
}

/** True for selective (`import x {`) and aliased (`import x as y`) lines. */
function isBailoutLine(line: string): boolean {
	const code = line.replace(/\s*\/\/.*$/, "")
	return code.includes("{") || aliasPattern.test(code)
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Imported module names provably unused in `source`.
 *
 * A name counts as used when a word-boundary match occurs anywhere outside
 * import lines. Returns [] when the file holds selective or aliased imports,
 * since usage cannot be established textually then.
 */
export function unusedImports(source: string): string[] {
	const lines = splitLines(source)
	const imports: string[] = []
	for (const line of lines) {
		if (!isImportLine(line)) {
			continue
		}
		if (isBailoutLine(line)) {
			return []
		}
		imports.push(line)
	}
	const haystack = lines.filter((line) => !isImportLine(line)).join("\n")
	const unused: string[] = []
	const reported = new Set<string>()
	for (const line of imports) {
		const name = importNameOf(line)
		if (name === undefined || name === "" || reported.has(name)) {
			continue
		}
		const usage = new RegExp(`\\b${escapeRegExp(name)}\\b`)
		if (!usage.test(haystack)) {
			reported.add(name)
			unused.push(name)
		}
	}
	return unused
}

/** Remove imports whose module name is provably unused.
 *
 * No-op when nothing is unused, and no-op when `unusedImports` bails out on
 * selective or aliased imports.
 */
export function removeUnusedImports(source: string): string {
	const unused = new Set(unusedImports(source))
	if (unused.size === 0) {
		return source
	}
	const out: string[] = []
	for (const line of splitLines(source)) {
		if (isImportLine(line)) {
			const name = importNameOf(line)
			if (name !== undefined && unused.has(name)) {
				continue
			}
		}
		out.push(line)
	}
	return out.join("\n")
}
