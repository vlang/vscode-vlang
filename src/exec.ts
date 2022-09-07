import { window, Terminal } from 'vscode';
import { getVExecCommand, getCwd } from './utils';
import cp, { exec, ExecException, execFile } from 'child_process';

type ExecCallback = (error: ExecException | null, stdout: string, stderr: string) => void;

let vRunTerm: Terminal = null;

export function execVInTerminal(args: string[]): void {
	const vexec = getVExecCommand();
	const cmd = `${vexec} ${args.join(' ')}`;

	if (!vRunTerm) vRunTerm = window.createTerminal('V');

	vRunTerm.show();
	vRunTerm.sendText(cmd);
}

export function execVInTerminalOnBG(args: string[]): void {
	const vexec = getVExecCommand();
	const cmd = `${vexec} ${args.join(' ')}`;

	cp.exec(cmd);
}

export function execV(args: string[], callback: ExecCallback): void {
	const vexec = getVExecCommand();
	const cwd = getCwd();

	// void window.showErrorMessage(`Executing ${vexec} ${args.join(" ")} on ${cwd}`);
	
	exec(vexec+" "+args.join(" "), (err, stdout, stderr) => {
		callback(err, stdout, stderr);
	});
}
