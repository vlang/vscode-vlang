import { execFile as _execFile } from "child_process"
import { promisify } from "util"
import * as path from "path"
import * as vscode from "vscode"
import {
	cppdbgLaunchConfig,
	debugBinaryPath,
	debugCompileArgs,
	missingCppdbgMessage,
	missingDebuggerMessage,
} from "./debugCompile"
import { findInPath } from "./vCommand"
import { vCommandFor } from "./vExecutable"

const execFile = promisify(_execFile)

/** How long to wait for the compile step of a debug session. */
const compileTimeoutMs = 60_000

/** The native debugger a V debug session needs on PATH.
 *
 * V compiles to a native binary, so the session runs under the same
 * debugger a C program would use; the `cppdbg` adapter drives it. This
 * is only probed for presence here — the adapter itself is launched by
 * the C/C++ extension, never directly.
 */
const debugAdapterCommand = "gdb"

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

/** The extension a V debug session delegates to. */
const cppdbgExtensionId = "ms-vscode.cpptools"

/** Rewrite a V launch configuration into a real debug session.
 *
 * Spawning raw `gdb --interpreter=mi2` cannot work: it never answers DAP
 * `initialize` (`Undefined command: "Content-Length"`), so no session can
 * run that way on any platform. Instead the program is compiled here and
 * the configuration is rewritten to the C/C++ extension's `cppdbg`
 * adapter, which speaks DAP. The compile still happens here rather than
 * in a `preLaunchTask`, so the debugger stays self-contained: a user
 * does not need a task defined to start a session.
 *
 * Returning `undefined` cancels the session with the message already
 * shown; that is preferable to launching into a guaranteed failure.
 */
export class VDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
	async resolveDebugConfiguration(
		folder: vscode.WorkspaceFolder | undefined,
		configuration: vscode.DebugConfiguration,
	): Promise<vscode.DebugConfiguration | undefined> {
		const vConfiguration = configuration as VDebugConfiguration
		if (!vConfiguration.program) {
			void vscode.window.showErrorMessage("Cannot debug: no V program in the launch configuration.")
			return undefined
		}
		const workspaceFolder =
			folder ?? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(vConfiguration.program))
		if (!findInPath(debugAdapterCommand)) {
			void vscode.window.showErrorMessage(missingDebuggerMessage())
			return undefined
		}
		if (!vscode.extensions.getExtension(cppdbgExtensionId)) {
			const action = "Install C/C++ Extension"
			const choice = await vscode.window.showErrorMessage(missingCppdbgMessage(), action)
			if (choice === action) {
				await vscode.commands.executeCommand(
					"workbench.extensions.installExtension",
					cppdbgExtensionId,
				)
			}
			return undefined
		}
		const vCommand = workspaceFolder ? vCommandFor(workspaceFolder) : "v"
		const cwd =
			vConfiguration.cwd ||
			workspaceFolder?.uri.fsPath ||
			path.dirname(vConfiguration.program)
		return vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Window, title: "Compiling V for debugging..." },
			async () => {
				const binary = await compileForDebug(vCommand, vConfiguration.program, cwd)
				return cppdbgLaunchConfig({
					name: configuration.name,
					binary,
					args: vConfiguration.args ?? [],
					cwd,
					stopAtEntry: vConfiguration.stopAtEntry ?? false,
				})
			},
		)
	}
}

/** Register the V debugger.
 *
 * The debugger is contributed in `package.json` with `type: "v"`. This
 * provider compiles the program and rewrites the configuration to the
 * `cppdbg` adapter before the session starts.
 */
export function registerDebugger(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.debug.registerDebugConfigurationProvider("v", new VDebugConfigurationProvider()),
	)
}
