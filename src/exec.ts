import { window, Terminal, Disposable, TextDocument } from "vscode";
import { getVExecCommand, getCwd } from "./utils";
import { ExecException, exec, execFile, spawn } from "child_process";

type ExecCallback = (error: ExecException | null, stdout: string, stderr: string) => void;

let vRunTerm: Terminal = null;

export function execVInTerminal(args: string[]) {
	const vexec = getVExecCommand();
	const cmd = vexec + " " + args.join(" ");

	if (!vRunTerm) vRunTerm = window.createTerminal("V");

	vRunTerm.show();
	vRunTerm.sendText(cmd);
}

export function execV(args: string[], callback: ExecCallback) {
	execFile(getVExecCommand(), args, { cwd: getCwd() }, callback);
}

export function execVWithDocument(
	document: TextDocument,
	args: string[],
	callback: ExecCallback
) {
	let result = { stdout: "", stderr: "" };
	const proc = spawn(getVExecCommand(document), args, {
		windowsHide: true,
		cwd: getCwd(),
		shell: true,
		stdio: "pipe",
	});
	proc.stdin.end(document.getText(), "utf8");
	proc.stderr.on("data", (chunk) => (result.stderr += chunk || ""));
	proc.stdout.on("data", (chunk) => (result.stdout += chunk || ""));
	proc.stderr.on("end", (chunk) => (result.stderr += chunk || ""));
	proc.stdout.on("end", (chunk) => (result.stdout += chunk || ""));

	let didFinish = false;

	proc.once("close", (_, __) => {
		if (didFinish) return;
		callback(null, result.stdout, result.stderr);
		didFinish = true;
	});

	proc.once("err", (err, __) => {
		if (didFinish) return;
		callback(err, result.stdout, result.stderr);
		didFinish = true;
	});
}

function handleCloseTerminal(term: Terminal) {
	if (term.name == "V") vRunTerm = null;
}

export function attachOnCloseTerminalListener(): Disposable {
	return window.onDidCloseTerminal(handleCloseTerminal);
}
