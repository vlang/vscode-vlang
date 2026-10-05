const fs = require("node:fs")

const eventsPath = process.env.TEST_VLS_EVENTS
let buffer = Buffer.alloc(0)
let shuttingDown = false
let diagnostics = false
let documentUri

function record(event, details = {}) {
	if (eventsPath) {
		fs.appendFileSync(
			eventsPath,
			JSON.stringify({ event, pid: process.pid, ...details }) + "\n",
		)
	}
}

function send(message) {
	const body = Buffer.from(JSON.stringify(message))
	process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`)
	process.stdout.write(body)
}

function response(id, result) {
	send({ jsonrpc: "2.0", id, result })
}

function publishDiagnostics(uri) {
	if (!uri) return
	send({
		jsonrpc: "2.0",
		method: "textDocument/publishDiagnostics",
		params: {
			uri,
			diagnostics: diagnostics
				? [
						{
							range: {
								start: { line: 2, character: 0 },
								end: { line: 2, character: 2 },
							},
							severity: 1,
							source: "fake-vls",
							message: "fixture diagnostic",
						},
					]
				: [],
		},
	})
}

function handle(message) {
	const { id, method, params = {} } = message
	if (method === "initialize") {
		record("initialize", { command: process.env.VLS_V_COMMAND })
		response(id, {
			capabilities: {
				textDocumentSync: 1,
				completionProvider: {},
				hoverProvider: true,
				definitionProvider: true,
				renameProvider: { prepareProvider: true },
				inlayHintProvider: true,
				documentFormattingProvider: true,
				codeLensProvider: {},
				executeCommandProvider: { commands: ["vls.runFile", "vls.runTests"] },
			},
			serverInfo: { name: "vls", version: "0.0.2" },
		})
		return
	}
	if (method === "initialized") {
		record("initialized")
		return
	}
	if (method === "workspace/didChangeConfiguration") {
		diagnostics = Boolean(params.settings?.vls?.diagnostics?.enabled)
		record("settings", { settings: params.settings })
		publishDiagnostics(documentUri)
		return
	}
	if (method === "textDocument/didOpen") {
		documentUri = params.textDocument?.uri
		record("open", { uri: documentUri })
		publishDiagnostics(documentUri)
		return
	}
	if (method === "textDocument/didChange") {
		documentUri = params.textDocument?.uri
		publishDiagnostics(documentUri)
		return
	}
	if (method === "textDocument/completion") {
		response(id, [{ label: "fake_completion", kind: 3 }])
		return
	}
	if (method === "textDocument/hover") {
		response(id, { contents: { kind: "plaintext", value: "fake hover" } })
		return
	}
	if (method === "textDocument/definition") {
		response(id, {
			uri: params.textDocument.uri,
			range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
		})
		return
	}
	if (method === "textDocument/rename") {
		response(id, {
			changes: {
				[params.textDocument.uri]: [
					{
						range: {
							start: { line: 2, character: 20 },
							end: { line: 2, character: 23 },
						},
						newText: params.newName,
					},
				],
			},
		})
		return
	}
	if (method === "textDocument/prepareRename") {
		response(id, {
			range: { start: { line: 2, character: 20 }, end: { line: 2, character: 23 } },
			placeholder: "add",
		})
		return
	}
	if (method === "textDocument/formatting") {
		response(id, [
			{
				range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
				newText: "MODULE",
			},
		])
		return
	}
	if (method === "textDocument/codeLens") {
		response(id, [
			{
				range: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } },
				command: {
					title: "Run",
					command: "vls.runFile",
					arguments: [params.textDocument.uri],
				},
			},
		])
		return
	}
	if (method === "shutdown") {
		shuttingDown = true
		record("shutdown")
		response(id, null)
		return
	}
	if (method === "exit") {
		record("exit")
		process.exit(shuttingDown ? 0 : 1)
	}
	if (id !== undefined) response(id, null)
}

process.stdin.on("data", (chunk) => {
	buffer = Buffer.concat([buffer, chunk])
	for (;;) {
		const headerEnd = buffer.indexOf("\r\n\r\n")
		if (headerEnd < 0) break
		const header = buffer.subarray(0, headerEnd).toString()
		const length = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1])
		if (!Number.isInteger(length) || length < 0) process.exit(2)
		const bodyStart = headerEnd + 4
		if (buffer.length < bodyStart + length) break
		const body = buffer.subarray(bodyStart, bodyStart + length).toString()
		buffer = buffer.subarray(bodyStart + length)
		handle(JSON.parse(body))
	}
})

record("spawn")
