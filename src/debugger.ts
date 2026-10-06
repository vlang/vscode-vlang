import { execFile as _execFile } from "child_process"
import { promisify } from "util"
import * as path from "path"
import * as vscode from "vscode"
import { debugBinaryPath, debugCompileArgs } from "./debugCompile"
import { vCommandFor } from "./vExecutable"

const execFile = promisify(_execFile)

/** How long to wait for the compile step of a debug session. */
const compileTimeoutMs = 60_000

/** The debug adapter V programs are debugged with.
 *
 * V compiles to a native binary with DWARF debug info, so the debugger is the same
 * one a C program would use. `gdb` is used because it is the one available on the
 * platforms V targets; `lldb` is not installed by default on Windows.
 *
 * The adapter speaks the MI interface, which is what `DebugAdapterExecutable`
 * expects from an external program.
 */
const debugAdapterCommand = "gdb"
const debugAdapterArgs = ["--interpreter=mi2"]

/** The shape of a V debug configuration.
 *
 * `program` is the V source file to debug. It is compiled with `-g` before the
 * session starts, because the debug info is what lets a breakpoint in V source map
 * to a location in the binary.
 */
export interface VDebugConfiguration extends vscode.DebugConfiguration {
	program: string
	args?: string[]
	stopAtEntry?: boolean
	cwd?: string
}

/** Compile a V program to a binary with debug info. */
async function compileForDebug(
	vCommand: string,
	program: string,
	cwd: string,
): Promise<string> {
	const binary = debugBinaryPath(program)
	await execFile(vCommand, debugCompileArgs(program, binary), { cwd, timeout: compileTimeoutMs })
	return binary
}

/** Create a debug session for a V program.
 *
 * The session is a `gdb` MI session on the compiled binary. V emits DWARF, so
 * breakpoints in V source resolve through the debug info the compile step produced.
 *
 * The compile happens here rather than in a `preLaunchTask`, so the debugger is
 * self-contained: a user does not need a task defined to start a session.
 */
export class VDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
	createDebugAdapterDescriptor(
		_session: vscode.DebugSession,
	): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
		const configuration = _session.configuration as VDebugConfiguration
		const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(configuration.program))
		const vCommand = folder ? vCommandFor(folder) : "v"
		const cwd = configuration.cwd || folder?.uri.fsPath || path.dirname(configuration.program)

		return vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Window, title: "Compiling V for debugging..." },
			async () => {
				const binary = await compileForDebug(vCommand, configuration.program, cwd)
				const args = [...debugAdapterArgs, "--", binary]
				if (configuration.stopAtEntry) {
					args.push("--eval-command", "break main")
				}
				return new vscode.DebugAdapterExecutable(debugAdapterCommand, args)
			},
		)
	}
}

/** Register the V debugger.
 *
 * The debugger is contributed in `package.json` with `type: "v"`. This factory is
 * what turns a launch configuration into a debug session.
 */
export function registerDebugger(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.debug.registerDebugAdapterDescriptorFactory("v", new VDebugAdapterDescriptorFactory()),
	)
}
