/** Running one `v test` file as a child process.
 *
 * Everything here is vscode-free so it can be tested without an editor. The
 * Test Explorer wiring lives in `testExplorer.ts`.
 *
 * A manual spawn rather than `execFile`: cancelling must kill the process
 * *tree* — `v test` compiles the file and runs the binary as its own child,
 * and killing only the compiler leaves the test binary running — and only a
 * directly spawned child can lead its own process group (detached) so one
 * signal takes the whole tree.
 */

import { spawn, type ChildProcess } from "child_process"
import { processLaunchCommand, processTreeKillCommand } from "./processExecution"

/** The cancellation half of `vscode.CancellationToken`, structurally typed.
 *
 * A real `CancellationToken` satisfies this, and a test builds one from a
 * listener without an editor.
 */
export interface TestProcessToken {
	readonly isCancellationRequested: boolean
	onCancellationRequested(listener: () => void): { dispose(): void }
}

export interface TestProcessResult {
	stdout: string
	stderr: string
	/** Exit code, or null when the process never exited normally. */
	code: number | null
	timedOut: boolean
	cancelled: boolean
}

/** Kill a test process and every child it launched.
 *
 * Windows gets `taskkill /t /f`, which walks the tree; elsewhere the child
 * leads its own group (see the spawn below), so a negative-pid kill takes the
 * whole tree. Either way a direct kill is the fallback, never the plan: it
 * would orphan the compiled test binary.
 */
function killTestTree(child: ChildProcess | undefined): void {
	const pid = child?.pid
	if (pid === undefined) {
		return
	}
	if (process.platform === "win32") {
		const treeKill = processTreeKillCommand(pid)
		if (treeKill !== undefined) {
			const killer = spawn(treeKill.command, treeKill.args, {
				windowsHide: true,
				stdio: "ignore",
			})
			killer.once("error", () => {
				try {
					child?.kill("SIGKILL")
				} catch {
					// The process is already gone, which is the goal.
				}
			})
			killer.once("close", (code) => {
				if (code !== 0) {
					try {
						child?.kill("SIGKILL")
					} catch {
						// The process is already gone, which is the goal.
					}
				}
			})
			return
		}
	} else {
		try {
			process.kill(-pid, "SIGKILL")
			return
		} catch {
			// Fall through to killing the direct child.
		}
	}
	try {
		child?.kill("SIGKILL")
	} catch {
		// The process is already gone, which is the goal.
	}
}

/** Run one test process to completion, timeout or cancellation.
 *
 * Output is captured whatever the exit code: a failing `v test` run exits
 * non-zero and still names its passed and failed tests. The configured
 * command may be a `.bat`/`.cmd` launcher, which Node cannot spawn directly
 * on Windows; the launch goes through `cmd.exe`.
 */
export function runTestProcess(
	command: string,
	args: string[],
	cwd: string | undefined,
	timeoutMs: number,
	token: TestProcessToken,
): Promise<TestProcessResult> {
	return new Promise((resolve) => {
		const launch = processLaunchCommand(command, args)
		let stdout = ""
		let stderr = ""
		let settled = false
		let child: ChildProcess | undefined
		const finish = (result: TestProcessResult): void => {
			if (settled) {
				return
			}
			settled = true
			clearTimeout(timer)
			subscription.dispose()
			resolve(result)
		}
		const result = (overrides: Partial<TestProcessResult>): TestProcessResult => ({
			stdout,
			stderr,
			code: null,
			timedOut: false,
			cancelled: false,
			...overrides,
		})
		let timer: ReturnType<typeof setTimeout> | undefined
		let subscription: { dispose(): void } = { dispose: () => undefined }
		try {
			child = spawn(launch.command, launch.args, {
				cwd,
				stdio: ["ignore", "pipe", "pipe"],
				windowsVerbatimArguments: launch.windowsVerbatimArguments,
				windowsHide: true,
				detached: process.platform !== "win32",
			})
		} catch (error) {
			resolve(result({ stderr: String(error) }))
			return
		}
		timer = setTimeout(() => {
			killTestTree(child)
			finish(result({ timedOut: true }))
		}, timeoutMs)
		subscription = token.onCancellationRequested(() => {
			killTestTree(child)
			finish(result({ cancelled: true }))
		})
		const outputs =
			child.stdout && child.stderr ? { out: child.stdout, err: child.stderr } : undefined
		if (!outputs) {
			killTestTree(child)
			finish(result({ stderr: "Could not capture the test process output." }))
			return
		}
		outputs.out.setEncoding("utf8")
		outputs.err.setEncoding("utf8")
		outputs.out.on("data", (chunk: string) => {
			stdout += chunk
		})
		outputs.err.on("data", (chunk: string) => {
			stderr += chunk
		})
		// A spawn failure reports through `error` and may never `close`; the
		// settled guard keeps the first verdict either way.
		child.once("error", (error) => {
			finish(result({ stderr: stderr + String(error) }))
		})
		child.once("close", (code) => {
			finish(result({ code }))
		})
		if (token.isCancellationRequested) {
			killTestTree(child)
			finish(result({ cancelled: true }))
		}
	})
}
