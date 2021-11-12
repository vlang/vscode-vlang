import { window } from 'vscode';

export const outputChannel = window.createOutputChannel('V');
export const vlsOutputChannel = window.createOutputChannel('V Language Server');

export function log(msg: string): void {
    // logging for devtools/debug
    console.log(`[vscode-vlang] ${msg}`);
    outputChannel.appendLine(msg);
}
