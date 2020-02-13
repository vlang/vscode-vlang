import {
	TextDocument,
	Position,
	Range,
	DiagnosticSeverity,
	Diagnostic,
	languages,
	Uri
} from "vscode";
import { tmpdir } from "os";
import { sep } from "path";
import { trimBoth, getWorkspaceFolder } from "./utils";
import { execV } from "./exec";
import { resolve, relative, dirname } from "path";
import { writeFileSync, unlinkSync } from "fs";

const outDir = `${tmpdir()}${sep}vscode_vlang${sep}`;
const SEV_ERR = DiagnosticSeverity.Error;
const SEV_WRN = DiagnosticSeverity.Warning;
let cwd = "";

export interface ErrorInfo {
	file: string;
	line: number;
	column: number;
	message: string;
	type: DiagnosticSeverity;
}

export const diagnosticCollection = languages.createDiagnosticCollection("V");

export function lint(document: TextDocument): boolean {
	const workspaceFolder = getWorkspaceFolder(document.uri);
	// Don't lint files that are not in the workspace
	if (!workspaceFolder) return true;

	cwd = workspaceFolder.uri.fsPath;
	const foldername = dirname(document.fileName);
	const relativeFilename = relative(cwd, document.fileName);
	const isOnCwd = foldername === cwd;

	let target = isOnCwd ? relativeFilename : "vscode_vlang_linter_file.v";

	if (!isOnCwd) {
		if (isMainModule(document.getText())) {
			target = relativeFilename;
		} else {
			writeFileSync(
				resolve(cwd, "vscode_vlang_linter_file.v"),
				createVFileContent(relative(cwd, foldername))
			);
		}
	}

	let status = true;

	execV(["-o", `${outDir}lint.c`, target], (err, stdout, stderr) => {
		diagnosticCollection.clear();
		const output = stderr || stdout;

		if (err || output !== "") {
			const errorWarnings = parseAll(output);

			for (const errorWarning of errorWarnings) {
				const { file } = errorWarning;
				const fileUri = Uri.file(resolve(cwd, file));
				const diagnostic = createDiagnostic(errorWarning, errorWarning.type);
				if (file === "vscode_vlang_linter_file.v") continue;
				diagnosticCollection.set(fileUri, [
					...diagnosticCollection.get(fileUri),
					diagnostic
				]);
			}
			return (status = false);
		} else {
			diagnosticCollection.delete(document.uri);
			deleteVLinterFile();
		}
	});
	return status;
}

function parseAll(stderr: string): Array<ErrorInfo> {
	stderr = trimBoth(stderr);
	const errorsAndWarnings: Map<string, ErrorInfo> = new Map();

	for (let ln of stderr.split("\n")) {
		ln = trimBoth(ln);
		const cols = ln.split(":");
		const isValidWrn = cols.length >= 5;
		const isValidErr = cols.length >= 4;
		const isWarning = isValidWrn && ln.startsWith("warning");
		const isError = isValidErr && cols[0].endsWith(".v");

		// Skip unecessary error info
		if (ln.startsWith("^") || !ln.search(/[0-9]+[|]/)) {
			continue;
		}

		cols.forEach(() => {
			if (isWarning) {
				const file = trimBoth(cols[1]);
				const line = +cols[2];
				const column = +cols[3];
				const message = trimBoth(cols[4]);
				const info = { file, line, column, message, type: SEV_WRN };
				const key = `${file}:${line}:${column}`;
				if (!errorsAndWarnings.has(key)) {
					errorsAndWarnings.set(key, info);
				}
			} else if (isError) {
				const file = trimBoth(cols[0]);
				const line = +cols[1];
				const column = +cols[2];
				let message = trimBoth(cols[3]);
				if (cols[4] && cols[4] !== "") {
					message += ":" + cols[4];
				}
				const info = { file, line, column, message, type: SEV_ERR };
				const key = `${file}:${line}:${column}`;
				if (!errorsAndWarnings.has(key)) {
					errorsAndWarnings.set(key, info);
				}
			} else {
				const key = Array.from(errorsAndWarnings)[errorsAndWarnings.size - 1][0];
				const value = errorsAndWarnings.get(key);
				if (value.message.endsWith("used")) {
					value.message += ":";
				}
				value.message += `\n${ln}`;
				errorsAndWarnings.set(key, value);
			}
		});
	}
	// console.log(JSON.stringify(Array.from(errorsAndWarnings.values())))
	return Array.from(errorsAndWarnings.values());
}

function createDiagnostic(errorWarning: ErrorInfo, type: DiagnosticSeverity): Diagnostic {
	const { line, column, message } = errorWarning;
	const start = new Position(line - 1, column);
	const end = new Position(line - 1, column + 1);
	const range = new Range(start, end);
	const diagnostic = new Diagnostic(range, message, type);
	diagnostic.source = "V";
	return diagnostic;
}

function createVFileContent(relativeFolderName: string): string {
	if ((relativeFolderName.split(sep) || [""])[0] === "modules") {
		relativeFolderName.replace(sep + "modules", "");
	}
	return "module vscode_vlang_linter\nimport " + relativeFolderName.replace(sep, ".");
}

function isMainModule(text: string): boolean {
	return text
		.replace(/(\/\*)(\s)(.)*/, "")
		.replace(/\s*\/\/.*/, "")
		.includes("module main");
}

export function deleteVLinterFile() {
	unlinkSync(resolve(cwd, "vscode_vlang_linter_file.v"));
}
