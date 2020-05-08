import {
	TextDocument,
	Position,
	Range,
	DiagnosticSeverity,
	Diagnostic,
	languages,
	Uri,
} from "vscode";
import { tmpdir } from "os";
import { sep } from "path";
import { trimBoth, getWorkspaceFolder } from "./utils";
import { execV } from "./exec";
import { resolve, relative, dirname } from "path";
import { readdirSync } from "fs";

const outDir = `${tmpdir()}${sep}vscode_vlang${sep}`;
export const collection = languages.createDiagnosticCollection("V");

export function lint(document: TextDocument): boolean {
	const workspaceFolder = getWorkspaceFolder(document.uri);
	// Don't lint files that are not in the workspace
	if (!workspaceFolder) return true;

	const cwd = workspaceFolder.uri.fsPath;
	const foldername = dirname(document.fileName);
	const relativeFoldername = relative(cwd, foldername);
	const relativeFilename = relative(cwd, document.fileName);
	const fileCount = readdirSync(foldername).filter((f) => f.endsWith(".v")).length;
	const isMainModule = !!document.getText().match(/^\s*(module)+\s+main/);
	const shared = !isMainModule ? "-shared" : "";
	const haveMultipleMainFn = fileCount > 1 && isMainModule;

	let target = foldername === cwd ? "." : relativeFoldername;
	target = haveMultipleMainFn ? relativeFilename : target;
	let status = true;

	execV([shared, "-o", `${outDir}lint.c`, target], (err, stdout, stderr) => {
		collection.clear();
		if (err || stderr.trim().length > 1) {
			const output = stderr || stdout;
			const lines: Array<string> = output.split("\n");

			lines.forEach((line) => {
				const cols = line.split(":");
				const isInfo = cols.length >= 5;
				const isError = isInfo && trimBoth(cols[3]) === "error";
				const isWarning = isInfo && trimBoth(cols[3]) === "warning";

				if (isInfo && (isError || isWarning)) {
					const file = cols[0];
					const lineNum = parseInt(cols[1]);
					const colNum = parseInt(cols[2]);
					const message = cols.splice(4, cols.length - 1).join("");

					const fileURI = Uri.file(resolve(cwd, file));
					const start = new Position(lineNum - 1, colNum);
					const end = new Position(lineNum - 1, colNum);
					const range = new Range(start, end);
					const diagnostic = new Diagnostic(
						range,
						message,
						isWarning ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error
					);
					diagnostic.source = "V";
					collection.set(fileURI, [...collection.get(fileURI), diagnostic]);
				}
			});
			status = false;
		} else {
			collection.delete(document.uri);
		}
	});
	return status;
}
