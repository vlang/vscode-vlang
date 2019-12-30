import * as vscode from 'vscode';
import * as commands from './commands';
import childProcess = require('child_process');

// Public functions ------------------------------------------------------------

/**
 * This method is called when the extension is activated.
 * @param context The extension context is a collection of utilities private to
 * the extension.
 */
export function activate(context: vscode.ExtensionContext) {
    let run = vscode.commands.registerCommand('v.run', commands.run);
    let prod = vscode.commands.registerCommand('v.prod', commands.prod);
    let help = vscode.commands.registerCommand('v.help', commands.help);
    let ver = vscode.commands.registerCommand('v.ver', commands.ver);
    let path = vscode.commands.registerCommand('v.path', commands.path);
    let testFile = vscode.commands.registerCommand(
        'v.test.file',
        commands.testFile
    );
    let testPackage = vscode.commands.registerCommand(
        'v.test.package',
        commands.testPackage
    );
    let playground = vscode.commands.registerCommand(
        'v.playground',
        commands.playground
    );

    registerFormatter();
}

/**
 * This method is called when the extension is deactivated.
 */

// Private functions -----------------------------------------------------------

function registerFormatter() {
    const formatterDisabled = !vscode.workspace
        .getConfiguration('v.format')
        .get('enable');
    if (formatterDisabled) {
        console.log('Formatter not enabled');
        return;
    }

    // Register the vfmt formatter
    vscode.languages.registerDocumentFormattingEditProvider('v', {
        provideDocumentFormattingEdits(
            document: vscode.TextDocument
        ): Thenable<vscode.TextEdit[]> {
            return document.save().then(() => {
                return format(document);
            });
        }
    });
}

function format(document: vscode.TextDocument): Promise<vscode.TextEdit[]> {
    return new Promise((resolve, reject) => {
        // Create vfmt command
        const vfmtArgs: string =
            vscode.workspace.getConfiguration('v.format').get('args') || '';
        const cmd = `vfmt ${vfmtArgs} ${document.fileName}`;

        console.log(`Running ${cmd}...`);

        // Run the command
        childProcess.exec(
            cmd,
            {
                cwd: vscode.workspace.rootPath
            },
            function(error, stdout, stderr) {
                if (error !== null) {
                    const message = `Cannot format due to the following errors: ${stderr}`;
                    vscode.window.showErrorMessage(message);
                    return reject(message);
                }

                console.log('Formatting complete');
                return [
                    vscode.TextEdit.replace(fullDocumentRange(document), stdout)
                ];
            }
        );
    });
}

function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
    const lastLineId = document.lineCount - 1;
    return new vscode.Range(
        0,
        0,
        lastLineId,
        document.lineAt(lastLineId).text.length
    );
}

export function deactivate() {}
