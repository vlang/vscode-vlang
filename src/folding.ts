import * as vscode from "vscode"
import { parseByVersion } from "./documentMemo"

/** Folding ranges for V documents.
 *
 * `foldRanges` decides what folds without touching an editor, so the decision
 * is testable as text; `registerFolding` is the only part that needs a host.
 *
 * Registering a provider is not additive. As soon as one provider returns a
 * range, VS Code uses that range set *instead of* the indentation folding it
 * computes and the `folding.markers` it reads from the language configuration,
 * falling back to both only when every provider answered with nothing. The
 * ranges below therefore cover what the editor was already folding — every
 * brace block, which is what its indentation folding produced — plus the runs
 * and regions issue #403 names.
 *
 * Two things that look foldable are not V, and are left alone. `#region` is not
 * a V directive: a line starting with `#` is one directive token with no region
 * meaning (`vlib/v/parser/parser.v:3807`), so folding it would invent syntax;
 * the region marker is the comment form this extension has folded since 0.1.2.
 * And there is no `import ( ... )` group: `import_stmt`
 * (`vlib/v/parser/parser.v:3719`) takes one module name, an optional `as`
 * alias, and an optional `{ ... }` symbol list, which is what the multi-line
 * import here is.
 */

export type FoldKind = "comment" | "imports"

/** A fold as zero-based line numbers, with the fold kind the editor should
 * show it as. */
export interface FoldRange {
	start: number
	end: number
	kind?: FoldKind
}

const importStatementPattern = /^import\b/
const selectiveImportPattern = /^import\s+[\w.]+\s*\{/
const commentLinePattern = /^\s*\/\//
const closingBracePattern = /^\s*\}/
const regionStartPattern = /^\s*\/\/\s*#?region\b/
const regionEndPattern = /^\s*\/\/\s*#?endregion\b/

/** The line after the `import mod { ... }` group opening at `start`.
 *
 * A group with no closing `}` is one import line rather than a fold running to
 * the end of the file.
 */
function selectiveImportEnd(lines: readonly string[], start: number): number {
	if (!selectiveImportPattern.test(lines[start] ?? "")) {
		return start + 1
	}
	let closing = start + 1
	while (closing < lines.length && !closingBracePattern.test(lines[closing] ?? "")) {
		closing += 1
	}
	return closing === lines.length ? start + 1 : closing + 1
}

/** Runs of top-level `import` statements worth collapsing.
 *
 * A run needs two statements, so a lone import stays in view. A comment
 * between two imports belongs to the run, while comments above the first
 * import do not: the imports of a file are one block that `v fmt` leaves
 * verbatim (`importsCleanup.ts` measured it on V 0.5.2), and the largest block
 * in vlib holds ten modules (`vlib/os/process_test.v`).
 */
function importRuns(lines: readonly string[]): FoldRange[] {
	const runs: FoldRange[] = []
	let index = 0
	while (index < lines.length) {
		if (!importStatementPattern.test(lines[index] ?? "")) {
			index += 1
			continue
		}
		const start = index
		let statements = 0
		while (index < lines.length) {
			const line = lines[index] ?? ""
			if (importStatementPattern.test(line)) {
				index = selectiveImportEnd(lines, index)
				statements += 1
				continue
			}
			const next = lines[index + 1] ?? ""
			const commentBetweenImports =
				statements > 0 && commentLinePattern.test(line) && importStatementPattern.test(next)
			if (!commentBetweenImports) {
				break
			}
			index += 1
		}
		if (statements > 1) {
			runs.push({ start, end: index - 1, kind: "imports" })
		}
	}
	return runs
}

/** Region markers, in the comment form `language-configuration.json` declares.
 *
 * An opening marker with no closing one folds nothing: a fold that runs to the
 * end of the file hides whatever follows the missing `//#endregion`, which is
 * the opposite of what a region marker is for.
 */
function regionFolds(lines: readonly string[]): FoldRange[] {
	const folds: FoldRange[] = []
	const openLines: number[] = []
	for (let line = 0; line < lines.length; line += 1) {
		const text = lines[line] ?? ""
		if (regionEndPattern.test(text)) {
			const start = openLines.pop()
			if (start !== undefined) {
				folds.push({ start, end: line, kind: "comment" })
			}
			continue
		}
		if (regionStartPattern.test(text)) {
			openLines.push(line)
		}
	}
	return folds
}

/** Offset of the quote closing the literal opened at `start`, or -1 when the
 * line ends first.
 *
 * A backslash escapes the next character, so `'\''` closes at its last quote.
 * An escape on a newline means the literal is not one this scanner reads,
 * which is what keeps the line count honest.
 */
function literalEnd(source: string, start: number): number {
	const quote = source[start] ?? ""
	let position = start + 1
	while (position < source.length) {
		const char = source[position] ?? ""
		if (char === "\\") {
			const escaped = source[position + 1] ?? ""
			if (escaped === "" || escaped === "\n") {
				return -1
			}
			position += 2
			continue
		}
		if (char === "\n") {
			return -1
		}
		if (char === quote) {
			return position
		}
		position += 1
	}
	return -1
}

/** Every matched `{`...`}` pair, as zero-based lines.
 *
 * Comments and string bodies are skipped, so a brace in a comment, in `'}'` or
 * in `"{"` neither opens nor closes a fold. A double- or single-quoted literal
 * that is not closed on its own line is read as ordinary text, because a stray
 * quote must not swallow the rest of the file; a backtick raw string does cross
 * lines, that being V's multi-line literal (`vlib/v/scanner/scanner.v:838`).
 */
function braceFolds(source: string): FoldRange[] {
	const folds: FoldRange[] = []
	const openLines: number[] = []
	let line = 0
	let position = 0
	let insideBlockComment = false
	let insideRawString = false
	while (position < source.length) {
		const char = source[position] ?? ""
		const following = source[position + 1] ?? ""
		if (char === "\n") {
			line += 1
			position += 1
			continue
		}
		if (insideBlockComment) {
			if (char === "*" && following === "/") {
				insideBlockComment = false
				position += 2
				continue
			}
			position += 1
			continue
		}
		if (insideRawString) {
			if (char === "`") {
				insideRawString = false
			}
			position += 1
			continue
		}
		if (char === "/" && following === "/") {
			const newline = source.indexOf("\n", position)
			if (newline === -1) {
				break
			}
			position = newline
			continue
		}
		if (char === "/" && following === "*") {
			insideBlockComment = true
			position += 2
			continue
		}
		if (char === "`") {
			insideRawString = true
			position += 1
			continue
		}
		if (char === '"' || char === "'") {
			const closing = literalEnd(source, position)
			position = closing === -1 ? position + 1 : closing + 1
			continue
		}
		if (char === "{") {
			openLines.push(line)
			position += 1
			continue
		}
		if (char === "}") {
			const start = openLines.pop()
			if (start !== undefined && start !== line) {
				folds.push({ start, end: line })
			}
			position += 1
			continue
		}
		position += 1
	}
	return folds
}

/** Every fold a V document offers, ordered by the line it starts on. */
export function foldRanges(source: string): FoldRange[] {
	const lines = source.split("\n")
	const ranges = [...braceFolds(source), ...importRuns(lines), ...regionFolds(lines)]
	ranges.sort((first, second) => first.start - second.start || first.end - second.end)
	return ranges
}

/** What the provider answers, or nothing when there is nothing to answer.
 *
 * `undefined` is not the same as an empty list: a range set replaces the
 * editor's own folding for the document, while answering nothing leaves its
 * indentation and marker folding in place. A V document with no fold in it is
 * one this scanner could not read a brace pair in, so handing it back unanswered
 * is the safer of the two answers.
 */
export function editorFoldRanges(source: string): FoldRange[] | undefined {
	const ranges = foldRanges(source)
	return ranges.length === 0 ? undefined : ranges
}

/** A fold in the form the editor asks for.
 *
 * Only the kinds VS Code names get one: a plain brace block is left unset,
 * which shows it as an ordinary indentation fold.
 */
function editorFoldRange(range: FoldRange): vscode.FoldingRange {
	const kind =
		range.kind === "imports"
			? vscode.FoldingRangeKind.Imports
			: range.kind === "comment"
				? vscode.FoldingRangeKind.Comment
				: undefined
	return new vscode.FoldingRange(range.start, range.end, kind)
}

/** Register the folding range provider for V documents.
 *
 * Folding is asked for while the user types and on every scroll, so the parse
 * is memoised per document version rather than re-run for each request.
 */
export function registerFolding(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.languages.registerFoldingRangeProvider([{ language: "v" }, { language: "v.mod" }], {
			provideFoldingRanges: (document) => {
				const ranges = parseByVersion(document, editorFoldRanges)
				return ranges?.map(editorFoldRange)
			},
		}),
	)
}
