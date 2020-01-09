import { window, Terminal } from "vscode";
import { getVExecCommand, getCwd } from "./utils";
import { exec, ExecException } from "child_process";

type ExecCallback = (error: ExecException | null, stdout: string, stderr: string) => void;

let vRunTerm: Terminal = null;

export function execVInTerminal(args: string) {
	const cmd = getVExecCommand(args);

	if (!vRunTerm) {
		vRunTerm = window.createTerminal("V");
	}
	vRunTerm.show();
	vRunTerm.sendText(cmd);
}

export function execV(args: string, callback: ExecCallback) {
	const cmd = getVExecCommand(args);
	const cwd = getCwd();

	console.log(`Executing ${cmd}`);
	exec(cmd, { cwd }, (err, stdout, stderr) => {
		callback(err, stdout, stderr);
	});
}

export function attachOnCloseTerminalListener() {
	window.onDidCloseTerminal(term => {
		if (term.name == "V") {
			vRunTerm = null;
		}
	});
}
