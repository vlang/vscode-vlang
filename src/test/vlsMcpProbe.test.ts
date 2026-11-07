import * as assert from "assert"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { describe, it } from "node:test"
import { isMcpInitializeResult, probeVlsMcp, vlsMcpArgs } from "../vlsMcpProbe"

const initializeResult = JSON.stringify({
	jsonrpc: "2.0",
	id: "vls-mcp-probe",
	result: {
		protocolVersion: "2024-11-05",
		capabilities: {},
		serverInfo: { name: "vls", version: "0.0.3" },
	},
})

describe("VLS MCP handshake", () => {
	it("recognizes an MCP initialize result", () => {
		assert.strictEqual(isMcpInitializeResult(initializeResult), true)
	})

	it("rejects anything that is not an initialize result", () => {
		assert.strictEqual(isMcpInitializeResult(""), false)
		assert.strictEqual(isMcpInitializeResult("not json"), false)
		assert.strictEqual(
			isMcpInitializeResult(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })),
			false,
		)
		assert.strictEqual(
			isMcpInitializeResult(
				JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "x" } }),
			),
			false,
		)
		// An LSP response carries no MCP protocol version.
		assert.strictEqual(
			isMcpInitializeResult(
				JSON.stringify({ jsonrpc: "2.0", id: 1, result: { capabilities: {} } }),
			),
			false,
		)
		// A null serverInfo is not a server description.
		assert.strictEqual(
			isMcpInitializeResult(
				JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					result: { protocolVersion: "2024-11-05", serverInfo: null },
				}),
			),
			false,
		)
	})

	it("probes a server that answers the handshake", async () => {
		const script = `process.stdout.write(${JSON.stringify(initializeResult)} + "\\n");`
		assert.strictEqual(await probeVlsMcp(process.execPath, ["-e", script], 10_000), true)
	})

	it("forwards the configured arguments to the probed process", async () => {
		// A custom VLS can depend on its arguments, so the probe must run with
		// the same ones the served process gets. The fixture refuses to answer
		// unless both the custom argument and `--mcp` reach it. (Argv after a
		// script name, unlike after `-e`, is never option-parsed by Node, so
		// the real `--mcp` shape is exercised here.)
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vls-mcp-args-"))
		try {
			const fixture = path.join(directory, "fake-mcp.cjs")
			fs.writeFileSync(
				fixture,
				[
					"if (!process.argv.includes('--custom') || !process.argv.includes('--mcp')) {",
					"  process.exit(1);",
					"}",
					`process.stdout.write(${JSON.stringify(initializeResult)} + "\\n");`,
				].join("\n"),
			)
			assert.strictEqual(
				await probeVlsMcp(process.execPath, [fixture, ...vlsMcpArgs(["--custom"])], 10_000),
				true,
			)
		} finally {
			fs.rmSync(directory, { recursive: true, force: true })
		}
	})

	it("appends --mcp after the configured arguments", () => {
		// No configured arguments is the plain `--mcp` probe.
		assert.deepStrictEqual(vlsMcpArgs([]), ["--mcp"])
		assert.deepStrictEqual(vlsMcpArgs(["--custom", "value"]), ["--custom", "value", "--mcp"])
	})

	it("rejects a missing executable without waiting out the timeout", async () => {
		const started = Date.now()
		assert.strictEqual(
			await probeVlsMcp("vscode-vlang-no-such-binary", ["--mcp"], 10_000),
			false,
		)
		assert.ok(Date.now() - started < 10_000)
	})

	it("rejects a process that exits silently, like VLS without MCP support", async () => {
		assert.strictEqual(
			await probeVlsMcp(process.execPath, ["-e", "process.exit(0)"], 10_000),
			false,
		)
	})
})
