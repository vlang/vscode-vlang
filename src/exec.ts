import { window, Terminal, Disposable } from "vscode";
import { getVExecCommand, getCwd } from "./utils";
import { ExecException, execFile } from "child_process";

type ExecCallback = (error: ExecException | null, stdout: string, stderr: string) => void;

let vRunTerm: Terminal = null;

export function execVInTerminal(args: string[]): void {
	const vexec = getVExecCommand();
	const cmd = vexec + " " + args.join(" ");

	if (!vRunTerm) vRunTerm = window.createTerminal("V");

	vRunTerm.show();
	vRunTerm.sendText(cmd);
}

export function execV(args: string[], callback: ExecCallback): void {
	const vexec = getVExecCommand();
	const cwd = getCwd();

	// console.log(`Executing ${vexec} ${args.join(" ")} on ${cwd}`);
	execFile(vexec, args, { cwd }, (err, stdout, stderr) => {
		callback(err, stdout, stderr);
	});
}

export function attachOnCloseTerminalListener(): Disposable {
	return window.onDidCloseTerminal((term) => {
		if (term.name == "V") vRunTerm = null;
	});
}
