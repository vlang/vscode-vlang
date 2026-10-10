/** VPM (V package manager) output parsing and argv building.
 *
 * Everything here is pure so it can be tested without an editor. The shapes
 * below were captured from a real toolchain (`C:/Users/MR/v/.bin/v.bat`):
 *
 * - `v search vls` prints a server line, a `Search results for ...` header,
 *   numbered `name [qualified]` / `name by author [qualified]` rows and a
 *   `Use v install ...` hint line.
 * - `v list` prints one installed module name per line, with no header.
 * - `v show <module>` prints best-effort `Key: value` lines (installed
 *   modules report `Version`/`Location`, remote ones `Downloads`/`Installed`)
 *   followed by a `--------` separator line.
 *
 * Parsers never throw on unrecognized input: they skip what they cannot
 * parse and return what they could.
 */

export interface VpmSearchEntry {
	name: string
	description: string
}

export interface VpmModuleInfo {
	name: string
	details: Record<string, string>
}

export type VpmCommand = "search" | "list" | "show" | "install"

const searchRow = /^\d+\.\s+(.+)$/
const qualifiedRow = /^(.*?)\s*(?:by\s+\S+)?\s*\[([^\]]+)\]\s*(?:[-:–—]\s*(.+))?$/
const trailingDescription = /^(.*?)\s+[-:–—]\s+(.+)$/
const trailingAuthor = /\s+by\s+\S+\s*$/
const plainModuleName = /^[A-Za-z0-9_][\w.\-]*$/
const separatorLine = /^[-=─*]+$/

/** Entries of a real `v search` output, in listed order.
 *
 * Skips the server/header/hint lines and blank lines. `name` is the
 * qualified `[author.module]` identifier when present, else the display
 * name. Real output carries no descriptions, so `description` is usually
 * `""`; a trailing ` - text` suffix is kept when present.
 */
export function parseSearchList(output: string): VpmSearchEntry[] {
	const entries: VpmSearchEntry[] = []
	for (const line of output.split("\n")) {
		const trimmed = line.trim()
		const row = searchRow.exec(trimmed)
		if (row === null || row[1] === undefined) {
			continue
		}
		const rest = row[1].trim()
		if (rest === "") {
			continue
		}
		const qualified = qualifiedRow.exec(rest)
		const bracketed = qualified?.[2]?.trim()
		if (qualified !== null && bracketed !== undefined && bracketed !== "") {
			const trailing = qualified[3]
			entries.push({
				name: bracketed,
				description: trailing === undefined ? "" : trailing.trim(),
			})
			continue
		}
		const withoutAuthor = rest.replace(trailingAuthor, "").trim()
		const described = trailingDescription.exec(withoutAuthor)
		if (described !== null && described[1] !== undefined && described[2] !== undefined) {
			const fallbackName = described[1].trim().split(/\s+/)[0]
			if (fallbackName !== undefined && fallbackName !== "") {
				entries.push({ name: fallbackName, description: described[2].trim() })
			}
			continue
		}
		const firstToken = withoutAuthor.split(/\s+/)[0]
		if (firstToken !== undefined && plainModuleName.test(firstToken)) {
			entries.push({ name: firstToken, description: "" })
		}
	}
	return entries
}

/** Module names of a real `v list` output, in listed order.
 *
 * Real output is one bare name per line. Lines that are blank or that
 * cannot be a module name (headers, errors, anything with whitespace)
 * are skipped.
 */
export function parseInstalledList(output: string): string[] {
	const names: string[] = []
	for (const line of output.split("\n")) {
		const trimmed = line.trim()
		if (trimmed === "" || separatorLine.test(trimmed)) {
			continue
		}
		if (/\s/.test(trimmed) || !plainModuleName.test(trimmed)) {
			continue
		}
		names.push(trimmed)
	}
	return names
}

/** Best-effort `Key: value` fields of a real `v show` output.
 *
 * `name` is the `Name` field, or `""` when absent. Separator lines,
 * blank lines and lines without a `Key: value` shape are skipped and
 * never throw. Only the first `:` splits key from value, so values
 * such as Windows paths (`C:\...`) survive intact.
 */
export function parseModuleInfo(output: string): VpmModuleInfo {
	const details: Record<string, string> = {}
	for (const line of output.split("\n")) {
		const trimmed = line.trim()
		if (trimmed === "" || separatorLine.test(trimmed)) {
			continue
		}
		const separator = trimmed.indexOf(":")
		if (separator <= 0) {
			continue
		}
		const key = trimmed.slice(0, separator).trim()
		if (key === "" || /\s/.test(key)) {
			continue
		}
		details[key] = trimmed.slice(separator + 1).trim()
	}
	return { name: details["Name"] ?? "", details }
}

/** argv for a VPM command, without any shell interpolation.
 *
 * `module` is passed as a single argument, never split or quoted, so
 * names with unusual characters cannot escape into the shell. Commands
 * that need a module but get none (`search`, `show`, `install`) return
 * the bare command; `list` never takes one.
 */
export function vpmArgs(command: VpmCommand, module?: string): string[] {
	if (command === "list") {
		return [command]
	}
	const target = module === undefined ? "" : module.trim()
	if (target === "") {
		return [command]
	}
	return [command, target]
}
