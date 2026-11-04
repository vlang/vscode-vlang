import * as assert from "assert"
import { describe, it } from "node:test"
import { isMcpInitializeResult, probeVlsMcp } from "../vlsMcpProbe"

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
