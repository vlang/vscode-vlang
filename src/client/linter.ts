import {
	TextDocument,
	Position,
	Range,
	DiagnosticSeverity,
	Diagnostic,
	languages,
	workspace,
	Uri
} from "vscode";
import { createHash } from "crypto";
import { tmpdir } from "os";
import { sep } from "path";
import { arrayInclude, trimBoth, getCwd } from "./utils";
import { execV } from "./exec";
import { relative, resolve } from "path";

const outDir = `${tmpdir()}${sep}vscode_vlang${sep}`;

export interface ErrorInfo {
	file: string;
	line: number;
	column: number;
	message: string;
	stderr: string;
}

export const collection = languages.createDiagnosticCollection("V");

export function lint(document: TextDocument): boolean {
	// Don't lint files that are not in the workspace
	if (!workspace.getWorkspaceFolder(document.uri)) {
		return false;
	}
	const cwd = getCwd();
	const filename = relative(cwd, document.uri.fsPath);
	const cFileName = createMd5Hash(filename) + ".c";

	const cmd = `-o ${outDir}${cFileName} .`;

	let status = true;
	let fileuri = document.uri;

	execV(cmd, (err, stdout, stderr) => {
		if (err) {
			collection.delete(fileuri);
			const isWarning = stderr.substring(0, 7) === "warning";
			if (isWarning) stderr = removeWarning(stderr);
			const { file, line, column, message } = parseError(stderr);
			fileuri = Uri.parse(resolve(cwd, file));
			const start = new Position(line - 1, column);
			const end = new Position(line - 1, column + 1);
			const range = new Range(start, end);
			const diagnostic = new Diagnostic(range, message, DiagnosticSeverity.Error);
			diagnostic.source = "V";
			collection.set(fileuri, [diagnostic]);
			status = false;
		} else {
			collection.delete(fileuri);
		}
	});
	return status;
}

function parseError(stderr: string): ErrorInfo {
	stderr = stderr.replace(/^\s*$[\n\r]{1,}/gm, "");
	const split = stderr.split("\n");
	const index = arrayInclude(split, ".v:");
	const moreMsgIndex = arrayInclude(split, " *");
	const infos = split[index].split(":");

	const file = trimBoth(infos[0]);
	const line = parseInt(infos[1]);
	const column = parseInt(infos[2]);
	let message = trimBoth(infos.slice(3).join(""));

	if (split[moreMsgIndex]) message += ":\n" + trimBoth(split[moreMsgIndex]);

	return { file, line, column, message, stderr };
}

function removeWarning(stderr: string): string {
	const split = stderr.split("\n");
	let n = -1;
	split.forEach((ln, idx) => {
		if (!ln.indexOf("warning:")) {
			n = idx;
			return;
		}
	});
	return split.slice(n).join("\n");
}

function createMd5Hash(str: string): string {
	return createHash("md5")
		.update(str)
		.digest("hex");
}
