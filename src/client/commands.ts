import * as vscode from 'vscode';
// import * as superchild from 'superchild';

let vRunTerm: vscode.Terminal = null

// PRIVATE FUNCTIONS
function runTerm(cmd) {
    vRunTerm.show()
    vRunTerm.sendText(cmd)
} 

/**
 * Run current file.
 */
export function run() {
    const cmd = 'v run ' + vscode.window.activeTextEditor.document.fileName
    
    vscode.window.activeTextEditor.document.save()
    
    if (!vRunTerm) {
        vRunTerm = vscode.window.createTerminal(cmd)
        runTerm(cmd)
    } else {
        runTerm(cmd)
    }

    vscode.window.onDidCloseTerminal((term)=> {
        if (term.name == cmd) vRunTerm = null 
    })
}

/**
 * Build an optimized executable from current file.
 */
export function prod() { }

/**
 * Show help info.
 */
export function help() { }

/**
 * Show version info.
 */
export function ver() { }

/**
 * Show local paths info.
 */
export function path() { }

/**
 * Test current file.
 */
export function testFile() { }

/**
 * Test current package.
 */
export function testPackage() { }

/**
 * Upload and share current code to V playground.
 */
export function playground() { }
