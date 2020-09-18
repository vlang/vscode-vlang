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
import { trimBoth, getWorkspaceFolder, getVConfig, makeTempFolder } from "./utils";
import { execV } from "./exec";
import { resolve, relative, dirname, join } from "path";
import { readdirSync } from "fs";

const outFile = join(tmpdir(), "vscode_vlang", "lint.c");
const collection = languages.createDiagnosticCollection("V");
const checkMainModule = (text: string) => !!text.match(/^\s*(module)+\s+main/m);
const checkMainFn = (text: string) => !!text.match(/^\s*(fn)+\s+main/m);
const checkIsModule = (text: string) => !!text.match(/^\s*(module).*\w$/m);
const allowGlobalsConfig = getVConfig().get("allowGlobals");

export function lint(document: TextDocument): boolean {
	const workspaceFolder = getWorkspaceFolder(document.uri);
	// Don't lint files that are not in the workspace
	if (!workspaceFolder) return true;

	const cwd = workspaceFolder.uri.fsPath;
	const foldername = dirname(document.fileName);
	const vFiles = readdirSync(foldername).filter((f) => f.endsWith(".v"));
	const fileCount = vFiles.length;
	const isMainModule =
		checkMainModule(document.getText()) || checkMainFn(document.getText());
	const isModule = checkIsModule(document.getText());
	const shared = !isMainModule ? "-shared" : "";
	let haveMultipleMainFn = fileCount > 1 && isMainModule;

	if (haveMultipleMainFn) {
		let filesAreMainModule = false;
		vFiles.forEach(async (f) => {
			f = resolve(foldername, f);
			const fDocument = await workspace.openTextDocument(f);
			filesAreMainModule =
				checkMainModule(fDocument.getText()) || checkMainFn(fDocument.getText());
		});
		haveMultipleMainFn = filesAreMainModule;
	}

	let target = foldername === cwd ? "." : join(".", relative(cwd, foldername));
	target = haveMultipleMainFn ? relative(cwd, document.fileName) : target;
	target = !isModule ? document.fileName : target;
	let status = true;
	const globals = allowGlobalsConfig ? "--enable-globals" : "";

	makeTempFolder();

	execV(
		[globals, shared, "-o", outFile, target],
		(err, stdout, stderr) => {
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
							isWarning
								? DiagnosticSeverity.Warning
								: DiagnosticSeverity.Error
						);
						diagnostic.source = "V";
						collection.set(fileURI, [...collection.get(fileURI), diagnostic]);
					}
				}
				status = false;
			} else {
				collection.delete(document.uri);
			}
		}
	);
	return status;
}

export function clear() {
	collection.clear();
}

export function _delete(uri: Uri) {
	collection.delete(uri);
}
