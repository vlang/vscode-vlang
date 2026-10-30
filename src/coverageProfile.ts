import * as fs from "fs"
import * as path from "path"
import * as readline from "readline"

export interface LineCoverage {
	covered: number[]
	uncovered: number[]
}

export type CoverageProfile = Map<string, LineCoverage>

export interface CoverageDocumentState {
	filePath: string
	isDirty: boolean
}

export interface FileModificationState {
	ctimeMs: number
	device: number
	inode: number
	mtimeMs: number
	size: number
}

export interface CoverageLineRange {
	end: number
	start: number
}

type CoverageFileFilter = (filePath: string) => boolean

/** One function of a source file, as `v cover --json` reports it. */
export interface CoverageFunction {
	name: string
	/** 1-based line of the declaration, as the source spells it. */
	line: number
	covered: boolean
	hits: number
}

/** One file of a `v cover --json` report. */
export interface CoverageJsonFile {
	file: string
	points: number
	covered: number
	percent: number
	functions: CoverageFunction[]
	function_points: number
	function_covered: number
}

/** The whole `v cover --json` report. */
export interface CoverageJsonReport {
	files: CoverageJsonFile[]
	totals: CoverageJsonFile
}

/** A function no test run entered, addressed the way an editor addresses a line. */
export interface UncoveredFunction {
	name: string
	/** 0-based line of the declaration. */
	line: number
}

function isCoverageJsonFile(value: unknown): value is CoverageJsonFile {
	if (typeof value !== "object" || value === null) {
		return false
	}
	const file = value as Partial<CoverageJsonFile>
	return typeof file.file === "string" && Array.isArray(file.functions)
}

function emptyCoverageJsonFile(file: string): CoverageJsonFile {
	return {
		file,
		points: 0,
		covered: 0,
		percent: 0,
		functions: [],
		function_points: 0,
		function_covered: 0,
	}
}

/** Read a `v cover --json` report, keeping only the files the caller wants.
 *
 * A report is written by another process, so it is treated as untrusted input:
 * a file entry without a path or a functions list is dropped rather than
 * reaching an editor as an empty record.
 */
export function parseCoverageJsonReport(
	content: string,
	includeFile?: CoverageFileFilter,
): CoverageJsonReport {
	let parsed: unknown
	try {
		parsed = JSON.parse(content)
	} catch {
		return { files: [], totals: emptyCoverageJsonFile("") }
	}
	const report = parsed as Partial<CoverageJsonReport>
	const files = Array.isArray(report.files) ? report.files : []
	return {
		files: files
			.filter(isCoverageJsonFile)
			.filter((file) => !includeFile || includeFile(file.file))
			.map((file) => ({ ...file, functions: file.functions.filter((fn) => !!fn?.name) })),
		totals: isCoverageJsonFile(report.totals) ? report.totals : emptyCoverageJsonFile(""),
	}
}

/** The functions of `filePath` that no run entered, in source order. */
export function uncoveredFunctionsFor(
	report: CoverageJsonReport,
	filePath: string,
): UncoveredFunction[] {
	const file = report.files.find((entry) => entry.file === filePath)
	if (!file) {
		return []
	}
	return file.functions
		.filter((fn) => !fn.covered)
		.map((fn) => ({ name: fn.name, line: fn.line - 1 }))
		.sort((left, right) => left.line - right.line)
}

class LcovProfileParser {
	private readonly hitsByFile = new Map<string, Map<number, number>>()
	private currentFile: string | undefined

	constructor(
		private readonly baseDirectory: string,
		private readonly includeFile?: CoverageFileFilter,
	) {}

	addLine(rawLine: string): void {
		if (rawLine.startsWith("SF:")) {
			const filePath = rawLine.slice(3).trim()
			const canonicalPath = filePath
				? canonicalFilePath(filePath, this.baseDirectory)
				: undefined
			this.currentFile =
				canonicalPath && (!this.includeFile || this.includeFile(canonicalPath))
					? canonicalPath
					: undefined
			if (this.currentFile && !this.hitsByFile.has(this.currentFile)) {
				this.hitsByFile.set(this.currentFile, new Map())
			}
			return
		}
		if (!this.currentFile || !rawLine.startsWith("DA:")) {
			return
		}

		const fields = rawLine.slice(3).split(",")
		const line = Number.parseInt(fields[0] || "", 10)
		const hits = Number.parseInt(fields[1] || "", 10)
		if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(hits) || hits < 0) {
			return
		}
		const fileHits = this.hitsByFile.get(this.currentFile)
		if (!fileHits) return
		fileHits.set(line, (fileHits.get(line) || 0) + hits)
	}

	profile(): CoverageProfile {
		const profile: CoverageProfile = new Map()
		for (const [filePath, lineHits] of this.hitsByFile) {
			const covered: number[] = []
			const uncovered: number[] = []
			for (const [line, hits] of lineHits) {
				;(hits > 0 ? covered : uncovered).push(line)
			}
			covered.sort((left, right) => left - right)
			uncovered.sort((left, right) => left - right)
			profile.set(filePath, { covered, uncovered })
		}
		return profile
	}
}

/** Resolving the real path of a file is a syscall walk up the tree, and this runs on
 * every keystroke through the coverage decoration listener. A path keeps its canonical
 * form until the filesystem is restructured, so the answer is memoised. `baseDirectory`
 * is part of the key because it decides what a relative path resolves against. The cache
 * is dropped wholesale once it grows past the limit rather than evicting, which keeps a
 * long editing session bounded.
 */
const canonicalPathCache = new Map<string, string>()
const canonicalPathCacheLimit = 4096

export function canonicalFilePath(filePath: string, baseDirectory = process.cwd()): string {
	const cacheKey = `${baseDirectory}\n${filePath}`
	const cached = canonicalPathCache.get(cacheKey)
	if (cached !== undefined) {
		return cached
	}
	let absolutePath = path.isAbsolute(filePath)
		? path.normalize(filePath)
		: path.resolve(baseDirectory, filePath)
	let existingPath = absolutePath
	while (true) {
		try {
			const realExistingPath = fs.realpathSync.native(existingPath)
			absolutePath = path.resolve(realExistingPath, path.relative(existingPath, absolutePath))
			break
		} catch {
			const parent = path.dirname(existingPath)
			if (parent === existingPath) {
				break
			}
			existingPath = parent
		}
	}
	const canonical = process.platform === "win32" ? absolutePath.toLowerCase() : absolutePath
	if (canonicalPathCache.size >= canonicalPathCacheLimit) {
		canonicalPathCache.clear()
	}
	canonicalPathCache.set(cacheKey, canonical)
	return canonical
}

/** Drop the path memo.
 *
 * Called when a coverage run finishes or is cleared: a run is the moment the user may
 * have restructured the workspace, so any canonical path recorded before it cannot be
 * relied on afterwards.
 */
export function resetCanonicalPaths(): void {
	canonicalPathCache.clear()
}

export function instrumentCoverageArgs(args: string[], coverageDirectory: string): string[] {
	return ["-no-skip-unused", "-coverage", coverageDirectory, ...args]
}

export function coverageArgsForRun(args: string[], coverageDirectory?: string): string[] {
	return coverageDirectory ? instrumentCoverageArgs(args, coverageDirectory) : [...args]
}

export function recordFileChange(changedFiles: Set<string>, filePath: string): void {
	changedFiles.add(canonicalFilePath(filePath))
}

export function readFileModificationState(filePath: string): FileModificationState | undefined {
	try {
		const stat = fs.statSync(filePath)
		if (!stat.isFile()) {
			return undefined
		}
		return {
			ctimeMs: stat.ctimeMs,
			device: stat.dev,
			inode: stat.ino,
			mtimeMs: stat.mtimeMs,
			size: stat.size,
		}
	} catch {
		return undefined
	}
}

export function fileModificationStateMatches(
	filePath: string,
	expected: FileModificationState,
): boolean {
	const current = readFileModificationState(filePath)
	return (
		current !== undefined &&
		current.ctimeMs === expected.ctimeMs &&
		current.device === expected.device &&
		current.inode === expected.inode &&
		current.mtimeMs === expected.mtimeMs &&
		current.size === expected.size
	)
}

export function pruneStaleCoverageFiles(
	profile: CoverageProfile,
	fileStates: Map<string, FileModificationState>,
): boolean {
	let removedFile = false
	for (const filePath of profile.keys()) {
		const state = fileStates.get(filePath)
		if (!state || !fileModificationStateMatches(filePath, state)) {
			profile.delete(filePath)
			fileStates.delete(filePath)
			removedFile = true
		}
	}
	return removedFile
}

export function seedDirtyFileInvalidations(
	changedFiles: Map<string, number>,
	documents: readonly CoverageDocumentState[],
	generation: number,
): void {
	changedFiles.clear()
	for (const document of documents) {
		if (document.isDirty) {
			changedFiles.set(canonicalFilePath(document.filePath), generation)
		}
	}
}

export function parseLcovProfile(
	content: string,
	baseDirectory: string,
	includeFile?: CoverageFileFilter,
): CoverageProfile {
	const parser = new LcovProfileParser(baseDirectory, includeFile)
	let lineStart = 0
	while (lineStart <= content.length) {
		const newline = content.indexOf("\n", lineStart)
		let lineEnd = newline === -1 ? content.length : newline
		if (lineEnd > lineStart && content.charCodeAt(lineEnd - 1) === 13) {
			lineEnd--
		}
		parser.addLine(content.slice(lineStart, lineEnd))
		if (newline === -1) {
			break
		}
		lineStart = newline + 1
	}
	return parser.profile()
}

export async function parseLcovProfileFile(
	filePath: string,
	baseDirectory: string,
	includeFile?: CoverageFileFilter,
): Promise<CoverageProfile> {
	const parser = new LcovProfileParser(baseDirectory, includeFile)
	const input = fs.createReadStream(filePath, { encoding: "utf8" })
	const lines = readline.createInterface({ input, crlfDelay: Infinity })
	for await (const rawLine of lines) {
		parser.addLine(rawLine)
	}
	return parser.profile()
}

export function visibleCoverageLines(
	oneBasedLines: readonly number[],
	visibleRanges: readonly CoverageLineRange[],
	lineCount: number,
	limit: number,
): number[] {
	if (lineCount < 1 || limit < 1) {
		return []
	}
	const selected: number[] = []
	for (const range of visibleRanges) {
		const firstLine = Math.max(1, range.start + 1)
		const lastLine = Math.min(lineCount, range.end + 1)
		let left = 0
		let right = oneBasedLines.length
		while (left < right) {
			const middle = Math.floor((left + right) / 2)
			if (oneBasedLines[middle]! < firstLine) {
				left = middle + 1
			} else {
				right = middle
			}
		}
		for (let index = left; index < oneBasedLines.length; index++) {
			const line = oneBasedLines[index]!
			if (line > lastLine) {
				break
			}
			if (selected[selected.length - 1] !== line) {
				selected.push(line)
				if (selected.length === limit) {
					return selected
				}
			}
		}
	}
	return selected
}
