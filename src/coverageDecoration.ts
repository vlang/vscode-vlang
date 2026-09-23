import { execFile } from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import {
	canonicalFilePath,
	CoverageProfile,
	fileModificationStateMatches,
	FileModificationState,
	parseLcovProfileFile,
	pruneStaleCoverageFiles,
	readFileModificationState,
	recordFileChange,
	seedDirtyFileInvalidations,
	visibleCoverageLines,
} from "./coverageProfile"
import { processLaunchCommand } from "./processExecution"
import { migratedSetting } from "./settings"

export interface CoverageRun {
	command: string
	directory: string
	root: string
}

const coverageTempRoot = path.join(os.tmpdir(), "vls-coverage")
const maximumDecorationsPerStyle = 1000

function isPathInside(filePath: string, root: string): boolean {
	const relativePath = path.relative(canonicalFilePath(root), canonicalFilePath(filePath))
	return (
		relativePath === "" ||
		(relativePath !== ".." &&
			!relativePath.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relativePath))
	)
}

function hasCounterFile(directory: string): boolean {
	let entries: fs.Dirent[]
	try {
		entries = fs.readdirSync(directory, { withFileTypes: true })
	} catch {
		return false
	}
	for (const entry of entries) {
		const entryPath = path.join(directory, entry.name)
		if (entry.isDirectory() && hasCounterFile(entryPath)) {
			return true
		}
		if (entry.isFile() && entry.name.startsWith("vcounters_") && entry.name.endsWith(".csv")) {
			return true
		}
	}
	return false
}

function runCoverageConverter(
	command: string,
	coverageDirectory: string,
	reportPath: string,
	workingDirectory: string,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const launch = processLaunchCommand(command, [
			"cover",
			coverageDirectory,
			"--lcov",
			reportPath,
			"-P",
			"false",
		])
		execFile(
			launch.command,
			launch.args,
			{
				cwd: workingDirectory,
				maxBuffer: 4 * 1024 * 1024,
				windowsVerbatimArguments: launch.windowsVerbatimArguments,
			},
			(error) => (error ? reject(new Error(error.message, { cause: error })) : resolve()),
		)
	})
}

export class CoverageDecorationController implements vscode.Disposable {
	private readonly coveredDecoration = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor: "rgba(46, 160, 67, 0.20)",
	})
	private readonly uncoveredDecoration = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor: "rgba(248, 81, 73, 0.20)",
	})
	private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10)
	private readonly allocatedDirectories = new Set<string>()
	private readonly runGenerations = new Map<CoverageRun, number>()
	private readonly runChangedFiles = new Map<CoverageRun, Set<string>>()
	private readonly runWatchers = new Map<CoverageRun, vscode.Disposable>()
	private readonly changedFiles = new Map<string, number>()
	private readonly profileFileStates = new Map<string, FileModificationState>()
	private readonly disposables: vscode.Disposable[]
	private profileWatcher: vscode.Disposable | undefined
	private profile: CoverageProfile = new Map()
	private nextGeneration = 0
	private currentGeneration = 0

	constructor() {
		this.status.name = "V Test Coverage"
		this.status.command = "vls.coverage.clear"
		this.disposables = [
			vscode.window.onDidChangeVisibleTextEditors(() => this.refreshVisibleEditors()),
			vscode.window.onDidChangeActiveTextEditor((editor) => {
				if (editor) {
					this.decorateEditor(editor)
				}
			}),
			vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
				this.decorateEditor(event.textEditor)
			}),
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.document.uri.scheme !== "file") {
					return
				}
				const filePath = canonicalFilePath(event.document.uri.fsPath)
				this.changedFiles.set(filePath, this.currentGeneration)
				if (this.profile.delete(filePath)) {
					this.profileFileStates.delete(filePath)
					this.refreshVisibleEditors()
					this.updateStatus()
				}
			}),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (
					event.affectsConfiguration("v.vls.coverage.enabled") ||
					event.affectsConfiguration("vls.coverage.enabled")
				) {
					this.clear()
				}
			}),
		]
	}

	isEnabled(resource?: vscode.Uri): boolean {
		return migratedSetting(
			"v.vls",
			"coverage.enabled",
			"vls",
			"coverage.enabled",
			true,
			resource,
		)
	}

	createRun(command: string, root: string): CoverageRun {
		const directory = path.join(
			coverageTempRoot,
			`${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
		)
		this.allocatedDirectories.add(directory)
		return { command, directory, root }
	}

	beginRun(run: CoverageRun): void {
		const generation = ++this.nextGeneration
		this.currentGeneration = generation
		this.runGenerations.set(run, generation)
		this.watchRunSourceFiles(run)
		seedDirtyFileInvalidations(
			this.changedFiles,
			vscode.workspace.textDocuments
				.filter((document) => document.uri.scheme === "file")
				.map((document) => ({ filePath: document.uri.fsPath, isDirty: document.isDirty })),
			generation,
		)
		this.clearDecorations()
		try {
			fs.mkdirSync(run.directory, { recursive: true })
		} catch (error) {
			vscode.window.showWarningMessage(
				`VLS could not prepare test coverage: ${String(error)}`,
			)
		}
	}

	async endRun(run: CoverageRun): Promise<void> {
		const generation = this.runGenerations.get(run)
		const changedDuringRun = this.runChangedFiles.get(run)
		this.runGenerations.delete(run)
		if (generation === undefined || !changedDuringRun) {
			this.disposeRunWatcher(run)
			this.removeRunDirectory(run)
			return
		}

		try {
			if (!hasCounterFile(run.directory)) {
				return
			}
			const reportPath = path.join(run.directory, "coverage.lcov")
			await runCoverageConverter(run.command, run.directory, reportPath, run.root)
			const parsed = await parseLcovProfileFile(
				reportPath,
				run.root,
				(filePath) => filePath.endsWith(".v") && isPathInside(filePath, run.root),
			)
			if (generation !== this.currentGeneration) {
				return
			}
			for (const filePath of parsed.keys()) {
				if (
					this.changedFiles.get(filePath) === generation ||
					changedDuringRun.has(filePath)
				) {
					parsed.delete(filePath)
				}
			}
			this.profile = parsed
			this.profileFileStates.clear()
			for (const filePath of [...this.profile.keys()]) {
				const state = readFileModificationState(filePath)
				if (state && !changedDuringRun.has(filePath)) {
					this.profileFileStates.set(filePath, state)
				} else {
					this.profile.delete(filePath)
				}
			}
			this.watchProfileSourceFiles(run.root)
			this.refreshVisibleEditors()
			this.updateStatus()
		} catch (error) {
			if (generation === this.currentGeneration) {
				vscode.window.showWarningMessage(
					`VLS could not load test coverage: ${String(error)}`,
				)
			}
		} finally {
			this.disposeRunWatcher(run)
			this.removeRunDirectory(run)
		}
	}

	clear(): void {
		this.currentGeneration = ++this.nextGeneration
		this.changedFiles.clear()
		this.clearDecorations()
	}

	dispose(): void {
		this.currentGeneration = ++this.nextGeneration
		for (const run of this.runWatchers.keys()) {
			this.disposeRunWatcher(run)
		}
		this.disposeProfileWatcher()
		this.runChangedFiles.clear()
		for (const disposable of this.disposables) {
			disposable.dispose()
		}
		this.coveredDecoration.dispose()
		this.uncoveredDecoration.dispose()
		this.status.dispose()
		for (const directory of this.allocatedDirectories) {
			try {
				fs.rmSync(directory, { recursive: true, force: true })
			} catch {
				// The system can clean up an abandoned temporary coverage directory.
			}
		}
	}

	private watchRunSourceFiles(run: CoverageRun): void {
		const changedFiles = new Set<string>()
		this.runChangedFiles.set(run, changedFiles)
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(vscode.Uri.file(run.root), "**/*.v"),
		)
		const recordChange = (uri: vscode.Uri) => recordFileChange(changedFiles, uri.fsPath)
		this.runWatchers.set(
			run,
			vscode.Disposable.from(
				watcher.onDidChange(recordChange),
				watcher.onDidCreate(recordChange),
				watcher.onDidDelete(recordChange),
				watcher,
			),
		)
	}

	private disposeRunWatcher(run: CoverageRun): void {
		this.runWatchers.get(run)?.dispose()
		this.runWatchers.delete(run)
		this.runChangedFiles.delete(run)
	}

	private removeRunDirectory(run: CoverageRun): void {
		this.allocatedDirectories.delete(run.directory)
		try {
			fs.rmSync(run.directory, { recursive: true, force: true })
		} catch {
			// The system can clean up an abandoned temporary coverage directory.
		}
	}

	private watchProfileSourceFiles(root: string): void {
		this.disposeProfileWatcher()
		if (this.profile.size === 0) {
			return
		}
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(vscode.Uri.file(root), "**/*.v"),
		)
		const invalidate = (uri: vscode.Uri) => {
			const filePath = canonicalFilePath(uri.fsPath)
			if (this.profile.delete(filePath)) {
				this.profileFileStates.delete(filePath)
				this.refreshVisibleEditors()
				this.updateStatus()
			}
		}
		this.profileWatcher = vscode.Disposable.from(
			watcher.onDidChange(invalidate),
			watcher.onDidCreate(invalidate),
			watcher.onDidDelete(invalidate),
			watcher,
		)
	}

	private disposeProfileWatcher(): void {
		this.profileWatcher?.dispose()
		this.profileWatcher = undefined
	}

	private clearDecorations(): void {
		this.disposeProfileWatcher()
		this.profile.clear()
		this.profileFileStates.clear()
		this.status.hide()
		this.refreshVisibleEditors()
	}

	private refreshVisibleEditors(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			this.decorateEditor(editor)
		}
	}

	private decorateEditor(editor: vscode.TextEditor): void {
		if (editor.document.uri.scheme !== "file" || editor.document.languageId !== "v") {
			editor.setDecorations(this.coveredDecoration, [])
			editor.setDecorations(this.uncoveredDecoration, [])
			return
		}
		const filePath = canonicalFilePath(editor.document.uri.fsPath)
		let coverage = this.profile.get(filePath)
		const fileState = this.profileFileStates.get(filePath)
		if (coverage && (!fileState || !fileModificationStateMatches(filePath, fileState))) {
			this.profile.delete(filePath)
			this.profileFileStates.delete(filePath)
			this.updateStatus()
			coverage = undefined
		}
		editor.setDecorations(
			this.coveredDecoration,
			this.lineRanges(editor, coverage?.covered || []),
		)
		editor.setDecorations(
			this.uncoveredDecoration,
			this.lineRanges(editor, coverage?.uncovered || []),
		)
	}

	private lineRanges(editor: vscode.TextEditor, oneBasedLines: number[]): vscode.Range[] {
		return visibleCoverageLines(
			oneBasedLines,
			editor.visibleRanges.map((range) => ({ start: range.start.line, end: range.end.line })),
			editor.document.lineCount,
			maximumDecorationsPerStyle,
		).map((line) => new vscode.Range(line - 1, 0, line - 1, 0))
	}

	private updateStatus(): void {
		if (pruneStaleCoverageFiles(this.profile, this.profileFileStates)) {
			this.refreshVisibleEditors()
		}
		let covered = 0
		let uncovered = 0
		for (const fileCoverage of this.profile.values()) {
			covered += fileCoverage.covered.length
			uncovered += fileCoverage.uncovered.length
		}
		const total = covered + uncovered
		if (total === 0) {
			this.disposeProfileWatcher()
			this.status.hide()
			return
		}
		const percent = Math.round((100 * covered) / total)
		this.status.text = `$(beaker) Coverage ${percent}%`
		this.status.tooltip = `${covered} covered and ${uncovered} uncovered executable lines. Click to clear.`
		this.status.show()
	}
}
