// Live DAP checks for scripts/verify-dap.sh.
//
// Speaks Debug Adapter Protocol to `gdb -i=dap` over stdio and exercises the
// paths the V extension's built-in adapter uses: launch with the printers
// `-iex` mechanism, core-file attach, and live-PID attach. Prints one
// PASS/FAIL line per check and exits nonzero on the first failure.
import { spawn } from "node:child_process"

const args = Object.fromEntries(
	process.argv
		.slice(2)
		.map((token) => token.split(/=(.+)/))
		.map(([key, value]) => [key.replace(/^--/, ""), value ?? ""]),
)
const GDB = args.gdb || "gdb"
const PRINTERS = args.printers || ""
const WORK = args.work || ""
const ATTACH_PID = Number(args["attach-pid"])
const ATTACH_BIN = args["attach-bin"] || ""
const TIMEOUT_MS = 30_000

function fail(check, message) {
	console.log(`FAIL: ${check}: ${message}`)
	process.exit(1)
}

function pass(check, detail) {
	console.log(`PASS: ${check}${detail ? ` (${detail})` : ""}`)
}

/** Minimal DAP session over a spawned `gdb -i=dap`. */
function startSession(extraArgs) {
	const child = spawn(GDB, ["-i=dap", ...extraArgs], { stdio: ["pipe", "pipe", "pipe"] })
	let buffer = Buffer.alloc(0)
	const pending = new Map()
	const events = []
	let seq = 0
	let stderrText = ""

	child.stderr.on("data", (chunk) => {
		stderrText += chunk.toString()
	})
	child.on("error", (error) => {
		fail("spawn", `${GDB} -i=dap: ${error.message}`)
	})

	child.stdout.on("data", (chunk) => {
		buffer = Buffer.concat([buffer, chunk])
		for (;;) {
			const text = buffer.toString("utf8")
			const match = text.match(/Content-Length: (\d+)\r\n\r\n/)
			if (!match) {
				return
			}
			const headerLength = match[0].length
			const bodyLength = Number(match[1])
			const start = buffer.indexOf(match[0]) + headerLength
			if (buffer.length < start + bodyLength) {
				return
			}
			const body = JSON.parse(buffer.subarray(start, start + bodyLength).toString("utf8"))
			buffer = buffer.subarray(start + bodyLength)
			if (body.type === "response") {
				pending.get(body.request_seq)?.(body)
				pending.delete(body.request_seq)
			} else if (body.type === "event") {
				events.push(body)
			}
		}
	})

	function send(command, args) {
		const id = ++seq
		return new Promise((resolve) => {
			pending.set(id, resolve)
			const payload = Buffer.from(
				JSON.stringify({ seq: id, type: "request", command, arguments: args }),
				"utf8",
			)
			child.stdin.write(
				Buffer.concat([
					Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, "utf8"),
					payload,
				]),
			)
		})
	}

	async function waitFor(check, predicate, detail) {
		const deadline = Date.now() + TIMEOUT_MS
		for (;;) {
			const found = events.find(predicate)
			if (found) {
				return found
			}
			if (Date.now() > deadline) {
				fail(check, `timed out waiting for ${detail}`)
			}
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
	}

	return {
		send,
		waitFor,
		events,
		stderr: () => stderrText,
		async close() {
			try {
				await send("disconnect", {})
			} catch {}
			child.stdin.end()
			await new Promise((resolve) => {
				const timer = setTimeout(() => child.kill("SIGKILL"), 5000)
				child.on("exit", () => {
					clearTimeout(timer)
					resolve()
				})
			})
		},
	}
}

async function checkLaunch() {
	const session = startSession(["-iex", `source ${PRINTERS}`])
	const init = await session.send("initialize", { adapterID: "verify-dap" })
	if (!init.success) {
		fail("launch", `initialize failed: ${JSON.stringify(init)}`)
	}
	const launched = await session.send("launch", { program: `${WORK}/hello` })
	if (!launched.success) {
		fail("launch", `launch failed: ${JSON.stringify(launched)}`)
	}
	await session.send("configurationDone", {})
	const exited = await session.waitFor(
		"launch",
		(event) => event.event === "exited" || event.event === "terminated",
		"program exit",
	)
	const output = session.events
		.filter((event) => event.event === "output")
		.map((event) => event.body?.output ?? "")
		.join("")
	if (!output.includes("v-dap-hello")) {
		fail("launch", `missing program output: ${JSON.stringify(output)}`)
	}
	if (exited.body?.exitCode !== undefined && exited.body.exitCode !== 0) {
		fail("launch", `exit code ${exited.body.exitCode}`)
	}
	const stderrText = session.stderr()
	await session.close()
	if (/Traceback|Error in sourced command/.test(stderrText)) {
		fail("pretty printers", `printers failed to source: ${stderrText.slice(0, 500)}`)
	}
	pass("launch", "exit 0, program output seen")
	pass("pretty printers", "sourced under DAP with no errors")
}

async function checkCoreAttach() {
	const session = startSession([])
	const init = await session.send("initialize", { adapterID: "verify-dap" })
	if (!init.success) {
		fail("core-file attach", `initialize failed: ${JSON.stringify(init)}`)
	}
	const attached = await session.send("attach", {
		program: `${WORK}/crasher`,
		coreFile: `${WORK}/core.test`,
	})
	if (!attached.success) {
		// gdb 15.1's DAP only knows pid/target; coreFile arrived later. The
		// provider still sends coreFile per the documented protocol — here
		// just prove the core itself is good and move on.
		if (/requires either 'pid' or 'target'/.test(attached.message ?? "")) {
			await session.close()
			await checkCoreViaBatch()
			return
		}
		fail("core-file attach", `attach failed: ${JSON.stringify(attached)}`)
	}
	await session.waitFor("core-file attach", (event) => event.event === "stopped", "stop at core")
	const threads = await session.send("threads", {})
	if (!threads.success || !threads.body?.threads?.length) {
		fail("core-file attach", `no threads: ${JSON.stringify(threads)}`)
	}
	const stack = await session.send("stackTrace", {
		threadId: threads.body.threads[0].id,
	})
	const frames = (stack.body?.stackFrames ?? []).map((frame) => frame.name ?? "")
	if (!frames.some((name) => name.includes("crash"))) {
		fail("core-file attach", `crash frame missing: ${JSON.stringify(frames)}`)
	}
	await session.close()
	pass("core-file attach", `stopped in ${frames.find((name) => name.includes("crash"))}`)
}

/** Fallback when the host gdb's DAP predates coreFile: prove via batch `bt`
 * that the core the DAP check would have opened is valid, so the SKIP is
 * host-limited rather than fixture-limited. */
async function checkCoreViaBatch() {
	const { spawnSync } = await import("node:child_process")
	const result = spawnSync(
		GDB,
		["--batch", "-ex", `core-file ${WORK}/core.test`, "-ex", "bt", `${WORK}/crasher`],
		{ encoding: "utf8" },
	)
	const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
	if (result.status !== 0 || !output.includes("crash")) {
		fail("core-file attach", `core is unusable: ${output.slice(0, 500)}`)
	}
	console.log(
		"SKIP: core-file attach (gdb DAP without coreFile support; core validated via batch bt)",
	)
}

async function checkLiveAttach() {
	const session = startSession([])
	const init = await session.send("initialize", { adapterID: "verify-dap" })
	if (!init.success) {
		fail("live attach", `initialize failed: ${JSON.stringify(init)}`)
	}
	const attached = await session.send("attach", { program: ATTACH_BIN, pid: ATTACH_PID })
	if (!attached.success) {
		fail("live attach", `attach to pid ${ATTACH_PID} failed: ${JSON.stringify(attached)}`)
	}
	await session.waitFor("live attach", (event) => event.event === "stopped", "stop on attach")
	await session.close()
	pass("live attach", `attached to pid ${ATTACH_PID}`)
}

if (!PRINTERS || !WORK || !ATTACH_BIN || !Number.isInteger(ATTACH_PID) || ATTACH_PID <= 0) {
	fail("args", "need --gdb, --printers, --work, --attach-bin and --attach-pid")
}

await checkLaunch()
await checkCoreAttach()
await checkLiveAttach()
console.log("PASS: dap")
