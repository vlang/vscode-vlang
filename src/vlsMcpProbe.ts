import { spawn } from "child_process"
import { processLaunchCommand } from "./processExecution"

/** Whether one stdout line is an MCP `initialize` result.
 *
 * Pure so the recognition can be tested without spawning anything: an MCP
 * server answers `initialize` with a result carrying `protocolVersion` and
 * `serverInfo`, while a language server that does not speak MCP never answers
 * this request at all.
 */
export function isMcpInitializeResult(line: string): boolean {
	let parsed: unknown
	try {
		parsed = JSON.parse(line)
	} catch {
		return false
	}
	if (typeof parsed !== "object" || parsed === null) {
		return false
	}
	const result = (parsed as { result?: unknown }).result
	if (typeof result !== "object" || result === null) {
		return false
	}
	const record = result as Record<string, unknown>
	return (
		typeof record.protocolVersion === "string" &&
		typeof record.serverInfo === "object" &&
		record.serverInfo !== null
	)
}

/** The arguments a VLS MCP server is probed and started with.
 *
 * The user's configured `v.vls.args` come first, so a custom VLS that depends
 * on them sees the same configuration in the probe as in the served process;
 * `--mcp` selects the mode. Probing with anything else would reject a server
 * that only answers with its arguments, or start one without them.
 */
export function vlsMcpArgs(userArgs: readonly string[]): string[] {
	return [...userArgs, "--mcp"]
}

/** Ask a VLS binary whether it serves MCP over stdio.
 *
 * VLS gained no `--mcp` mode up to and including the version this extension
 * was verified against, where the flag is ignored and no MCP server starts.
 * Registering a definition for such a server would offer agents a tool host
 * that exits on first use, so the provider only registers what answers an
 * MCP `initialize` handshake here.
 */
export async function probeVlsMcp(
	command: string,
	args: string[] = ["--mcp"],
	timeoutMs = 5_000,
): Promise<boolean> {
	return new Promise((resolve) => {
		let child: ReturnType<typeof spawn>
		try {
			// The configured server may be a `.bat`/`.cmd` launcher, which
			// Node cannot spawn directly on Windows; the launch goes through
			// `cmd.exe`.
			const launch = processLaunchCommand(command, args)
			child = spawn(launch.command, launch.args, {
				stdio: ["pipe", "pipe", "ignore"],
				windowsVerbatimArguments: launch.windowsVerbatimArguments,
			})
		} catch {
			resolve(false)
			return
		}
		let done = false
		const cleanup = () => {
			clearTimeout(timer)
			try {
				child.kill()
			} catch {
				// The process already exited, which is itself an answer.
			}
		}
		const finish = (ok: boolean) => {
			if (done) {
				return
			}
			done = true
			cleanup()
			resolve(ok)
		}
		const timer = setTimeout(() => finish(false), timeoutMs)
		let buffer = ""
		child.on("error", () => finish(false))
		child.on("close", () => finish(false))
		child.stdout?.on("data", (chunk: Buffer) => {
			buffer += chunk.toString("utf8")
			const newline = buffer.indexOf("\n")
			if (newline >= 0) {
				finish(isMcpInitializeResult(buffer.slice(0, newline).trim()))
			} else if (buffer.length > 65_536) {
				finish(false)
			}
		})
		const request = `${JSON.stringify({
			jsonrpc: "2.0",
			id: "vls-mcp-probe",
			method: "initialize",
			params: {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "vscode-vlang-probe", version: "0.0.0" },
			},
		})}\n`
		child.stdin?.on("error", () => undefined)
		child.stdin?.write(request)
	})
}
