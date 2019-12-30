import * as vscode from 'vscode';
import * as childProcess from 'child_process'
import { fullDocumentRange } from './utils';

function format(document: vscode.TextDocument): Promise<vscode.TextEdit[]> {
  return new Promise((resolve, reject) => {
    // Create vfmt command
    const vfmtArgs: string = vscode.workspace.getConfiguration('v.format').get('args') || '';
    const cmd = `v fmt ${vfmtArgs} ${document.fileName}`;

    console.log(`Running ${cmd}...`);

    function callback(error: childProcess.ExecException, stdout: string, stderr: string) {
      if (error !== null) {
        const message = `Cannot format due to the following errors: ${stderr}`;
        vscode.window.showErrorMessage(message);
        return reject(message);
      }
      console.log('Formatting complete');
      return [vscode.TextEdit.replace(fullDocumentRange(document), stdout)];
    }
    
    childProcess.exec(cmd, { cwd: vscode.workspace.rootPath }, callback);
  });
}

export function registerFormatter() {
  const formatterEnabled = vscode.workspace.getConfiguration('v.format').get('enable');
  if (!formatterEnabled) {
    console.log('Formatter not enabled');
    return;
  }

  const provider: vscode.DocumentFormattingEditProvider = {
    provideDocumentFormattingEdits( document: vscode.TextDocument): Thenable<vscode.TextEdit[]> {
        return document.save().then(() => format(document));
      }
    }

  // Register the vfmt formatter
  vscode.languages.registerDocumentFormattingEditProvider('v', provider);
}
