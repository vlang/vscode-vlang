import * as vscode from 'vscode';
// import * as superchild from 'superchild';

let v_run_term: vscode.Terminal = null

// PRIVATE FUNCTIONS
function run_term(term, cmd) {
    term.show()
    term.sendText(cmd)
} 

/**
 * Run current file.
 */
export function run() {
    const filename = vscode.window.activeTextEditor.document.fileName
    const cmd = 'v run ' + filename
    
    vscode.window.activeTextEditor.document.save()
    
    if (!v_run_term) {
        v_run_term = vscode.window.createTerminal(cmd)
        run_term(v_run_term, cmd)
    } else {
        run_term(v_run_term, cmd)
    }

    vscode.window.onDidCloseTerminal((term)=> {
        if (term.name == cmd) v_run_term = null 
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
