import {
	TextDocument,
	Range,
	DiagnosticSeverity,
	Diagnostic,
	languages,
	Uri,
	workspace,
} from "vscode";
import { tmpdir } from "os";
import { trimBoth, getWorkspaceFolder, getWorkspaceConfig } from "./utils";
import { execV } from "./exec";
import { resolve, relative, dirname, join } from "path";
import { readdirSync } from "fs";

const outFile = join(tmpdir(), "vscode_vlang", "lint.c");
const collection = languages.createDiagnosticCollection("V");
const checkMainModule = (text: string) => !!text.match(/^\s*(module)+\s+main/);
const checkMainFn = (text: string) => !!text.match(/^\s*(fn)+\s+main/);
const allowGlobalsConfig = getWorkspaceConfig().get("allowGlobals");

export function lint(document: TextDocument) {
	const workspaceFolder = getWorkspaceFolder(document.uri);
	// Don't lint files that are not in the workspace
	if (!workspaceFolder) {
		return;
	}

	const cwd = workspaceFolder.uri.fsPath;
	// Get folder path of current file
	const foldername = dirname(document.fileName);
	// Get all of .v files on the folder
	const vFiles = readdirSync(foldername).filter((f) => f.endsWith(".v"));
	// Check if current file is a main module, will check if current file have a main function
	const isMainModule =
		checkMainModule(document.getText()) || checkMainFn(document.getText());
	const shared = !isMainModule ? "-shared" : "";
	let haveMultipleMainModule = vFiles.length > 1 && isMainModule;

	// If file have multiple main module
	// Recheck of each of v files on the folder, To check is a main module and have a main function
	if (haveMultipleMainModule) {
		let filesAreMainModule = false;
		vFiles.forEach(async (f) => {
			f = resolve(foldername, f);
			const fDocument = await workspace.openTextDocument(f);
			filesAreMainModule =
				checkMainModule(fDocument.getText()) || checkMainFn(fDocument.getText());
		});
		haveMultipleMainModule = filesAreMainModule;
	}

	let target = foldername === cwd ? "." : join(".", relative(cwd, foldername));
	target = haveMultipleMainModule ? relative(cwd, document.fileName) : target;
	const globals = allowGlobalsConfig ? "--enable-globals" : "";

	execV([globals, shared, "-o", outFile, target], (err, stdout, stderr) => {
		collection.clear();
		if (err || stderr.trim().length > 1) {
			const output = stderr || stdout;
			const lines: Array<string> = output.split("\n");

			for (const line of lines) {
				const cols = line.split(":");
				const isInfo = cols.length >= 5;
				const isError = isInfo && trimBoth(cols[3]) === "error";
				const isWarning = isInfo && trimBoth(cols[3]) === "warning";

				if (isError || isWarning) {
					const file = cols[0];
					const lineNum = parseInt(cols[1]);
					const colNum = parseInt(cols[2]);
					const message = cols.splice(4, cols.length - 1).join("");

					const fileURI = Uri.file(resolve(cwd, file));
					const range = new Range(lineNum - 1, colNum, lineNum - 1, colNum);
					const diagnostic = new Diagnostic(
						range,
						message,
						isWarning ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error
					);
					diagnostic.source = "V";
					collection.set(fileURI, [...collection.get(fileURI), diagnostic]);
				}
			}
		} else {
			collection.delete(document.uri);
		}
	});
}

export function clear() {
	collection.clear();
}

export function _delete(uri: Uri) {
	collection.delete(uri);
}
