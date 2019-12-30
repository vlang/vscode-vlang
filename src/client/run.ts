import * as vscode from 'vscode';

let vRunTerm: vscode.Terminal = null

function runTerm(term: vscode.Terminal, cmd: string) {
    term.show()
    term.sendText(cmd)
}

export function vrun() {
    const cmd = 'v run ' + vscode.window.activeTextEditor.document.fileName
    
    vscode.window.activeTextEditor.document.save()
    
    if (!vRunTerm) {
        vRunTerm = vscode.window.createTerminal(cmd)
        runTerm(vRunTerm, cmd)
    } else {
        runTerm(vRunTerm, cmd)
    }

    vscode.window.onDidCloseTerminal((term)=> {
        if (term.name == cmd) vRunTerm = null 
    })
}
