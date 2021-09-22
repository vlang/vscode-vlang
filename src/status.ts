import { window } from 'vscode';

export const outputChannel = window.createOutputChannel('V');
export const vlsOutputChannel = window.createOutputChannel('V Language Server');
