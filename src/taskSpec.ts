import * as fs from "fs"
import * as path from "path"

export type VTaskAction = "build" | "run" | "test" | "prod"

export interface VTaskSpec {
	action: VTaskAction
	args: string[]
	name: string
}

export interface TaskDocumentSpec {
	filePath: string
	languageId: string
	isDirty: boolean
}

/** A document that can be flushed to disk before a task runs.
 *
 * This is the narrow part of `vscode.TextDocument` the task path uses. Declaring it
 * structurally keeps the saving logic testable without a VS Code host, which is why
 * the helper lives beside `shouldSaveTaskDocument` rather than in the task provider.
 */
export interface SaveableDocument {
	save(): Thenable<boolean>
}

/** Save the documents a task needs, reporting whether all of them made it.
 *
 * Saving is independent per document — each writes its own buffer — so the saves are
 * issued together. The serial form this replaces stopped at the first failure, leaving
 * the remaining dirty documents unsaved and the task reading stale sources.
 */
export async function saveDocuments(documents: readonly SaveableDocument[]): Promise<boolean> {
	const saved = await Promise.all(documents.map((document) => document.save()))
	return saved.every((savedOne) => savedOne)
}

export function standaloneTaskScope(
	targetFilePath: string,
	exists: (filePath: string) => boolean = fs.existsSync,
): string {
	const targetDirectory = path.dirname(path.resolve(targetFilePath))
	let directory = targetDirectory
	while (true) {
		if (exists(path.join(directory, "v.mod"))) {
			return directory
		}
		const parent = path.dirname(directory)
		if (parent === directory) {
			return targetDirectory
		}
		directory = parent
	}
}

export function shouldSaveTaskDocument(
	targetFilePath: string,
	workspaceFolderPath: string | undefined,
	document: TaskDocumentSpec,
): boolean {
	if (!document.isDirty) {
		return false
	}
	const extension = path.extname(document.filePath).toLowerCase()
	if (document.languageId !== "v" && extension !== ".v" && extension !== ".vsh") {
		return false
	}
	const scopeRoot = path.resolve(workspaceFolderPath || path.dirname(targetFilePath))
	const relativePath = path.relative(scopeRoot, path.resolve(document.filePath))
	return (
		relativePath === "" ||
		(relativePath !== ".." &&
			!relativePath.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relativePath))
	)
}

export function taskActionTitle(action: VTaskAction): string {
	if (action === "prod") return "Build Optimized"
	return action.charAt(0).toUpperCase() + action.slice(1)
}

export function workspaceTaskSpec(action: VTaskAction): VTaskSpec {
	const args = (() => {
		switch (action) {
			case "build":
				return ["-nocolor", "."]
			case "prod":
				return ["-nocolor", "-prod", "."]
			case "run":
				return ["-nocolor", "run", "."]
			case "test":
				return ["-nocolor", "test", "."]
		}
	})()
	return { action, args, name: taskActionTitle(action) }
}

export function taskWorkingDirectory(filePath: string, workspaceFolder?: string): string {
	return workspaceFolder || path.dirname(filePath)
}

export function taskCoverageRoot(
	filePath: string,
	workspaceFolder?: string,
	exists: (filePath: string) => boolean = fs.existsSync,
): string {
	return workspaceFolder || standaloneTaskScope(filePath, exists)
}

function taskPath(targetPath: string, workingDirectory: string): string {
	const relativePath = path.relative(workingDirectory, targetPath)
	if (relativePath === "") {
		return "."
	}
	if (
		relativePath === ".." ||
		relativePath.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relativePath)
	) {
		return targetPath
	}
	return relativePath.startsWith("-") ? `.${path.sep}${relativePath}` : relativePath
}

export function activeBuildTaskSpec(filePath: string, workingDirectory: string): VTaskSpec {
	return {
		action: "prod",
		args: ["-nocolor", "-prod", taskPath(path.dirname(filePath), workingDirectory)],
		name: "Build Optimized Active Module",
	}
}

export function activeRunTaskSpec(filePath: string, workingDirectory: string): VTaskSpec {
	const isScript = filePath.endsWith(".vsh")
	const targetPath = isScript ? filePath : path.dirname(filePath)
	return {
		action: "run",
		args: ["-nocolor", "run", taskPath(targetPath, workingDirectory)],
		name: isScript ? "Run Active Script" : "Run Active Module",
	}
}

export function codeLensTaskSpec(
	command: string,
	filePath: string,
	testName: string,
	workingDirectory = path.dirname(filePath),
): VTaskSpec {
	if (command === "vls.runFile") {
		return {
			action: "run",
			args: ["-nocolor", "run", taskPath(path.dirname(filePath), workingDirectory)],
			name: "Run Main",
		}
	}
	const args = ["-nocolor", "test", filePath]
	if (testName) {
		args.push("-run-only", testName)
	}
	return {
		action: "test",
		args,
		name: testName ? `Run Test: ${testName}` : "Run Test File",
	}
}
