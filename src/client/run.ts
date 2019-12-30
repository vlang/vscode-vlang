import * as vscode from 'vscode';

let vRunTerm: vscode.Terminal = null

export function vrun() {
    const cmd = 'v run ' + vscode.window.activeTextEditor.document.fileName

    vscode.window.activeTextEditor.document.save()

    if (!vRunTerm) vRunTerm = vscode.window.createTerminal('V')

    vRunTerm.show()
    vRunTerm.sendText(cmd)

    vscode.window.onDidCloseTerminal(term => {
        if (term.name == 'V') vRunTerm = null
    })
}
