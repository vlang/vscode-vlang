import * as assert from "assert"
import * as os from "os"
import * as path from "path"
import { describe, it } from "node:test"
import {
	cppdbgAttachConfig,
	cppdbgLaunchConfig,
	buildDapEnv,
	dapAttachFields,
	debugBinaryPath,
	debugCompileArgs,
	gdbSetupCommandToCli,
	gdbSetupCommands,
	isCommandReference,
	lldbDapFields,
	mainFunctionLines,
	missingCppdbgMessage,
	missingDebuggerMessage,
	parseEnvFile,
	parseGdbVersion,
	pipeTransportArgs,
	preflightGdb,
	resolveDebuggerCommand,
	vPrintersPath,
	withEnvFileEntries,
} from "../debugCompile"

describe("V debug compile", () => {
	it("writes the debug binary to a temporary directory", () => {
		const binary = debugBinaryPath("/w/app/src/main.v")
		// A debug build is not something the user asked to keep, so it goes to a
		// temporary directory rather than next to the source.
		assert.strictEqual(path.dirname(binary), os.tmpdir())
		assert.ok(path.basename(binary).startsWith("v-debug-"))
		assert.ok(path.basename(binary).endsWith("-main"))
	})

	it("compiles with debug info and an explicit output path", () => {
		// `-g` is the debug info that lets a breakpoint in V source resolve to a
		// location in the binary. `-o` writes to the computed path, because the
		// default output name would land in the source tree. The panic define
		// turns a panic into a trap under a debugger instead of an exit.
		assert.deepStrictEqual(debugCompileArgs("/w/app/src/main.v", "/tmp/v-debug-main"), [
			"-g",
			"-d",
			"panics_break_into_debugger",
			"-o",
			"/tmp/v-debug-main",
			"/w/app/src/main.v",
		])
	})

	it("gives every debug binary a distinct name", () => {
		// Two sessions on the same program must not collide, so the name carries a
		// timestamp.
		const first = debugBinaryPath("/w/app/src/main.v")
		const second = debugBinaryPath("/w/app/src/main.v")
		assert.notStrictEqual(first, second)
	})

	it("names the C/C++ extension when its adapter is missing", () => {
		assert.ok(missingCppdbgMessage().includes("ms-vscode.cpptools"))
		assert.ok(missingCppdbgMessage().includes("cppdbg"))
	})

	it("names a per-OS install route when gdb is missing", () => {
		// A first debug session on default Windows or any macOS dies on a
		// raw spawn error without this; the message must say what to do.
		assert.ok(missingDebuggerMessage("win32").includes("MSYS2"))
		assert.ok(missingDebuggerMessage("darwin").includes("brew install gdb"))
		assert.ok(missingDebuggerMessage("linux").includes("apt install gdb"))
		for (const platform of ["win32", "darwin", "linux"] as const) {
			assert.ok(missingDebuggerMessage(platform).includes("gdb"))
			assert.ok(missingDebuggerMessage(platform).includes("PATH"))
		}
	})

	it("names a per-OS install route when lldb is missing", () => {
		assert.ok(missingDebuggerMessage("win32", "lldb").includes("LLVM"))
		assert.ok(missingDebuggerMessage("darwin", "lldb").includes("xcode-select"))
		assert.ok(missingDebuggerMessage("linux", "lldb").includes("apt install lldb"))
		for (const platform of ["win32", "darwin", "linux"] as const) {
			assert.ok(missingDebuggerMessage(platform, "lldb").includes("lldb"))
		}
	})

	it("expands the configured debugger path from day one", () => {
		// `~`, `${env:NAME}` and `${workspaceFolder}` work exactly like the
		// other executable settings, and blank means the mode default.
		assert.strictEqual(
			resolveDebuggerCommand("~/tools/gdb", "gdb"),
			`${os.homedir()}/tools/gdb`,
		)
		assert.strictEqual(
			resolveDebuggerCommand("${workspaceFolder}/bin/gdb", "gdb", "/ws"),
			"/ws/bin/gdb",
		)
		assert.strictEqual(resolveDebuggerCommand(undefined, "gdb"), "gdb")
		assert.strictEqual(resolveDebuggerCommand("  ", "lldb"), "lldb")
	})

	it("maps a V launch to a cppdbg delegation", () => {
		// The `type: "v"` config is rewritten to a real DAP adapter
		// instead of spawning raw gdb, which never answers DAP.
		assert.deepStrictEqual(
			cppdbgLaunchConfig({
				name: "Debug V Program",
				binary: "/tmp/v-debug-main",
				args: ["a", "b"],
				cwd: "/workspace",
				stopAtEntry: true,
				printersPath: "/extension/scripts/gdb/v_printers.py",
				miMode: "gdb",
				miDebuggerPath: "/usr/bin/gdb",
			}),
			{
				type: "cppdbg",
				request: "launch",
				name: "Debug V Program",
				program: "/tmp/v-debug-main",
				args: ["a", "b"],
				cwd: "/workspace",
				MIMode: "gdb",
				miDebuggerPath: "/usr/bin/gdb",
				stopAtEntry: true,
				setupCommands: gdbSetupCommands("/extension/scripts/gdb/v_printers.py"),
			},
		)
	})

	it("delegates lldb sessions without gdb printer commands", () => {
		// The printers are GDB Python; under lldb there is nothing to
		// source, so the session carries no setup commands at all.
		const config = cppdbgLaunchConfig({
			name: "Debug V Program",
			binary: "/tmp/v-debug-main",
			args: [],
			cwd: "/workspace",
			stopAtEntry: false,
			printersPath: "/extension/scripts/gdb/v_printers.py",
			miMode: "lldb",
			miDebuggerPath: "/usr/bin/lldb",
		})
		assert.strictEqual(config.MIMode, "lldb")
		assert.strictEqual(config.miDebuggerPath, "/usr/bin/lldb")
		assert.deepStrictEqual(config.setupCommands, [])
	})

	it("loads the printers through MI without failing the session", () => {
		// The texts are MI commands, which is what the adapter sends, so
		// the console `source` runs wrapped in `-interpreter-exec`.
		assert.deepStrictEqual(gdbSetupCommands("/extension/scripts/gdb/v_printers.py"), [
			{
				description: "Enable GDB pretty-printing",
				text: "-enable-pretty-printing",
				ignoreFailures: true,
			},
			{
				description: "Load V pretty printers",
				text: '-interpreter-exec console "source \\"/extension/scripts/gdb/v_printers.py\\""',
				ignoreFailures: true,
			},
		])
	})

	it("quotes Windows printers paths for MI", () => {
		// Backslashes become forward slashes so no MI-level escaping is
		// needed beyond the quotes; a printer failure never fails the launch.
		const [enable, source] = gdbSetupCommands("C:\\vscode ext\\v_printers.py")
		assert.strictEqual(enable?.text, "-enable-pretty-printing")
		assert.strictEqual(
			source?.text,
			'-interpreter-exec console "source \\"C:/vscode ext/v_printers.py\\""',
		)
		assert.ok(source?.ignoreFailures)
	})

	it("resolves the printers next to the bundle", () => {
		assert.strictEqual(
			vPrintersPath("/extension/out"),
			path.join("/extension/out", "..", "scripts", "gdb", "v_printers.py"),
		)
	})

	it("runs user setup commands after the printer commands", () => {
		// Unlocks GDB `skip` for generated-C frames and the like; a user
		// entry needs only its text, and never fails the session either.
		const config = cppdbgLaunchConfig({
			name: "Debug V Program",
			binary: "/tmp/v-debug-main",
			args: [],
			cwd: "/workspace",
			stopAtEntry: false,
			printersPath: "/extension/scripts/gdb/v_printers.py",
			miMode: "gdb",
			miDebuggerPath: "/usr/bin/gdb",
			setupCommands: [{ text: "skip -gfi vlib/*" }],
		})
		assert.deepStrictEqual(
			config.setupCommands.map((command) => command.text),
			[
				"-enable-pretty-printing",
				'-interpreter-exec console "source \\"/extension/scripts/gdb/v_printers.py\\""',
				"skip -gfi vlib/*",
			],
		)
		assert.ok(config.setupCommands.every((command) => command.ignoreFailures))
	})

	it("passes user setup commands to lldb sessions untouched", () => {
		const config = cppdbgLaunchConfig({
			name: "Debug V Program",
			binary: "/tmp/v-debug-main",
			args: [],
			cwd: "/workspace",
			stopAtEntry: false,
			printersPath: "/extension/scripts/gdb/v_printers.py",
			miMode: "lldb",
			miDebuggerPath: "/usr/bin/lldb",
			setupCommands: [
				{ description: "Skip runtime", text: "skip -gfi vlib/*", ignoreFailures: false },
			],
		})
		assert.deepStrictEqual(config.setupCommands, [
			{ description: "Skip runtime", text: "skip -gfi vlib/*", ignoreFailures: false },
		])
	})

	it("passes environment, envFile and console choice through", () => {
		// The adapter resolves the file and the variables itself.
		const config = cppdbgLaunchConfig({
			name: "Debug V Program",
			binary: "/tmp/v-debug-main",
			args: [],
			cwd: "/workspace",
			stopAtEntry: false,
			printersPath: "/extension/scripts/gdb/v_printers.py",
			miMode: "gdb",
			miDebuggerPath: "/usr/bin/gdb",
			environment: [{ name: "VFLAGS", value: "-d debug" }],
			envFile: "/workspace/.env",
			externalConsole: true,
		})
		assert.deepStrictEqual(config.environment, [{ name: "VFLAGS", value: "-d debug" }])
		assert.strictEqual(config.envFile, "/workspace/.env")
		assert.strictEqual(config.externalConsole, true)
	})

	it("omits environment, envFile and console choice when unset", () => {
		const config = cppdbgLaunchConfig({
			name: "Debug V Program",
			binary: "/tmp/v-debug-main",
			args: [],
			cwd: "/workspace",
			stopAtEntry: false,
			printersPath: "/extension/scripts/gdb/v_printers.py",
			miMode: "gdb",
			miDebuggerPath: "/usr/bin/gdb",
		})
		assert.ok(!("environment" in config))
		assert.ok(!("envFile" in config))
		assert.ok(!("externalConsole" in config))
	})

	it("rewrites attach without compiling", () => {
		// Attaching joins a running process: `program` names the binary
		// for symbols and `processId` passes through untouched, including
		// the adapter's own process picker.
		assert.deepStrictEqual(
			cppdbgAttachConfig({
				name: "Attach V Program",
				program: "/tmp/v-debug-main",
				processId: "${command:pickProcess}",
				cwd: "/workspace",
				printersPath: "/extension/scripts/gdb/v_printers.py",
				miMode: "gdb",
				miDebuggerPath: "/usr/bin/gdb",
			}),
			{
				type: "cppdbg",
				request: "attach",
				name: "Attach V Program",
				program: "/tmp/v-debug-main",
				args: [],
				cwd: "/workspace",
				MIMode: "gdb",
				miDebuggerPath: "/usr/bin/gdb",
				stopAtEntry: false,
				setupCommands: gdbSetupCommands("/extension/scripts/gdb/v_printers.py"),
				processId: "${command:pickProcess}",
			},
		)
	})

	it("passes source maps and remote transport through attach", () => {
		const config = cppdbgAttachConfig({
			name: "Attach Remote V Program",
			program: "/tmp/v-debug-main",
			processId: "1234",
			cwd: "/workspace",
			printersPath: "/extension/scripts/gdb/v_printers.py",
			miMode: "gdb",
			miDebuggerPath: "/usr/bin/gdb",
			sourceFileMap: { "/build": "/workspace" },
			miDebuggerServerAddress: "localhost:2345",
			pipeTransport: {
				pipeProgram: "ssh",
				pipeArgs: ["remote"],
				debuggerPath: "/usr/bin/gdb",
			},
		})
		assert.deepStrictEqual(config.sourceFileMap, { "/build": "/workspace" })
		assert.strictEqual(config.miDebuggerServerAddress, "localhost:2345")
		assert.deepStrictEqual(config.pipeTransport, {
			pipeProgram: "ssh",
			pipeArgs: ["remote"],
			debuggerPath: "/usr/bin/gdb",
		})
	})

	it("passes source maps through launch", () => {
		const config = cppdbgLaunchConfig({
			name: "Debug V Program",
			binary: "/tmp/v-debug-main",
			args: [],
			cwd: "/workspace",
			stopAtEntry: false,
			printersPath: "/extension/scripts/gdb/v_printers.py",
			miMode: "gdb",
			miDebuggerPath: "/usr/bin/gdb",
			sourceFileMap: { "/build": "/workspace" },
		})
		assert.deepStrictEqual(config.sourceFileMap, { "/build": "/workspace" })
		assert.ok(!("miDebuggerServerAddress" in config))
		assert.ok(!("pipeTransport" in config))
	})

	it("finds fn main lines for the Debug CodeLens", () => {
		assert.deepStrictEqual(mainFunctionLines("module main\n\nfn main() {\n}\n"), [2])
		assert.deepStrictEqual(mainFunctionLines("module main\n\nfn main () {\n}\n"), [2])
		assert.deepStrictEqual(mainFunctionLines("module main\n\nfn helper() {}\n"), [])
		assert.deepStrictEqual(mainFunctionLines("module main\n\nfn mainx() {}\n"), [])
		assert.deepStrictEqual(mainFunctionLines("// fn main() {}\nfn helper() {}\n"), [])
		assert.deepStrictEqual(mainFunctionLines("  fn main() {}\n"), [])
		assert.deepStrictEqual(mainFunctionLines("fn main() {}\nfn main() {}\n"), [0, 1])
	})

	describe("gdb preflight", () => {
		it("detects a DAP-capable gdb", () => {
			const result = preflightGdb("GNU gdb (GDB) 18.1\nok\n")
			assert.deepStrictEqual(result, { adapter: "gdb-dap", coreFileDap: true })
		})
		it("accepts distro-packaged version banners", () => {
			// Ubuntu/Debian tag the vendor before the version; the version
			// is the token right after the vendor tag, not the (GDB) shape
			// and not a later dotted distro suffix.
			assert.strictEqual(parseGdbVersion("GNU gdb (Ubuntu 15.1-1ubuntu1) 15.1\nok\n"), "15.1")
			assert.strictEqual(parseGdbVersion("GNU gdb (Debian 13.1-3) 13.1\nok\n"), "13.1")
			assert.strictEqual(
				parseGdbVersion("GNU gdb (Ubuntu 12.1-0ubuntu1~22.04.2) 12.1\nok\n"),
				"12.1",
			)
			assert.strictEqual(parseGdbVersion("GNU gdb (GDB) 17.1\nok\n"), "17.1")
			assert.strictEqual(parseGdbVersion("GNU gdb (GDB) Fedora 13.2-5.fc38\nok\n"), "13.2")
			assert.strictEqual(parseGdbVersion("GNU gdb (GDB) 16.0.50.20240513-git\nok\n"), "16.0")
			assert.strictEqual(parseGdbVersion("not a gdb banner\nok\n"), "")
			const result = preflightGdb("GNU gdb (Ubuntu 15.1-1ubuntu1) 15.1\nok\n")
			assert.deepStrictEqual(result, { adapter: "gdb-dap", coreFileDap: false })
			assert.deepStrictEqual(preflightGdb("GNU gdb (Debian 13.1-3) 13.1\nok\n"), {
				adapter: "gdb-dap",
				coreFileDap: false,
			})
		})
		it("rejects this host's gdb 17.1 (no Python/DAP)", () => {
			const recorded =
				"GNU gdb (GDB) 17.1\nPython scripting is not supported in this copy of GDB.\nInterpreter `dap' unrecognized"
			const result = preflightGdb(recorded)
			assert.strictEqual(result.adapter, null)
			assert.strictEqual(
				result.error,
				"gdb 17.1 has no DAP support (built without Python). Install gdb >= 13 with Python, or enable the cppdbg fallback (v.debug.adapter = 'cppdbg').",
			)
		})
		it("gates core-file attach on DAP support", () => {
			// DAP core-file support arrived in GDB 18 (gdb-patches, April
			// 2026): 15.1 and 17.1 only accept pid/target (the live verifier
			// records a SKIP there).
			assert.strictEqual(preflightGdb("GNU gdb (GDB) 15.1\nok\n").coreFileDap, false)
			assert.strictEqual(
				preflightGdb("GNU gdb (Ubuntu 15.1-1ubuntu1) 15.1\nok\n").coreFileDap,
				false,
			)
			assert.strictEqual(preflightGdb("GNU gdb (GDB) 17.1\nok\n").coreFileDap, false)
			assert.strictEqual(preflightGdb("GNU gdb (GDB) 18.1\nok\n").coreFileDap, true)
			assert.strictEqual(preflightGdb("gdb not found on PATH").coreFileDap, false)
		})
		it("handles gdb not found", () => {
			const result = preflightGdb("gdb not found on PATH")
			assert.strictEqual(result.adapter, null)
			assert.strictEqual(result.error, "gdb not found on PATH")
		})
	})

	describe("pretty-printer toggle", () => {
		it("omits the printer commands from a cppdbg launch when disabled", () => {
			const config = cppdbgLaunchConfig({
				name: "Debug V Program",
				binary: "/tmp/v-debug-main",
				args: [],
				cwd: "/workspace",
				stopAtEntry: false,
				printersPath: "/extension/scripts/gdb/v_printers.py",
				miMode: "gdb",
				miDebuggerPath: "/usr/bin/gdb",
				setupCommands: [{ text: "skip -gfi vlib/*" }],
				usePrettyPrinters: false,
			})
			assert.deepStrictEqual(
				config.setupCommands.map((command) => command.text),
				["skip -gfi vlib/*"],
			)
		})

		it("omits the printer commands from a cppdbg attach when disabled", () => {
			const config = cppdbgAttachConfig({
				name: "Attach V Program",
				program: "/tmp/v-debug-main",
				processId: "1234",
				cwd: "/workspace",
				printersPath: "/extension/scripts/gdb/v_printers.py",
				miMode: "gdb",
				miDebuggerPath: "/usr/bin/gdb",
				usePrettyPrinters: false,
			})
			assert.deepStrictEqual(config.setupCommands, [])
		})

		it("keeps the printer commands by default", () => {
			const launch = cppdbgLaunchConfig({
				name: "Debug V Program",
				binary: "/tmp/v-debug-main",
				args: [],
				cwd: "/workspace",
				stopAtEntry: false,
				printersPath: "/extension/scripts/gdb/v_printers.py",
				miMode: "gdb",
				miDebuggerPath: "/usr/bin/gdb",
			})
			assert.strictEqual(launch.setupCommands.length, 2)
			const attach = cppdbgAttachConfig({
				name: "Attach V Program",
				program: "/tmp/v-debug-main",
				processId: "1234",
				cwd: "/workspace",
				printersPath: "/extension/scripts/gdb/v_printers.py",
				miMode: "gdb",
				miDebuggerPath: "/usr/bin/gdb",
			})
			assert.strictEqual(attach.setupCommands.length, 2)
		})
	})

	describe("MI setup command translation", () => {
		it("translates the pretty-printing enablement to CLI", () => {
			assert.strictEqual(
				gdbSetupCommandToCli("-enable-pretty-printing"),
				"set print pretty on",
			)
		})

		it("unwraps console interpreter-exec to the inner CLI command", () => {
			assert.strictEqual(
				gdbSetupCommandToCli(
					'-interpreter-exec console "source \\"/extension/scripts/gdb/v_printers.py\\""',
				),
				'source "/extension/scripts/gdb/v_printers.py"',
			)
		})

		it("runs other MI commands through the MI interpreter", () => {
			assert.strictEqual(
				gdbSetupCommandToCli("-gdb-set print pretty on"),
				'-interpreter-exec mi "-gdb-set print pretty on"',
			)
		})

		it("passes CLI commands through untouched", () => {
			assert.strictEqual(gdbSetupCommandToCli("skip -gfi vlib/*"), "skip -gfi vlib/*")
		})
	})

	describe("built-in attach fields", () => {
		it("maps a processId string to a numeric pid", () => {
			assert.deepStrictEqual(dapAttachFields({ processId: "1234" }), { pid: 1234 })
		})

		it("accepts a core-file-only configuration with no PID", () => {
			assert.deepStrictEqual(dapAttachFields({ coreFile: "/tmp/core.test" }), {
				coreFile: "/tmp/core.test",
			})
		})

		it("keeps both pid and coreFile when both are set", () => {
			assert.deepStrictEqual(
				dapAttachFields({ processId: "1234", coreFile: "/tmp/core.test" }),
				{ pid: 1234, coreFile: "/tmp/core.test" },
			)
		})

		it("accepts a target-only remote attach with no PID", () => {
			assert.deepStrictEqual(dapAttachFields({ target: "localhost:2345" }), {
				target: "localhost:2345",
			})
		})

		it("prefers a remote target over a PID", () => {
			// GDB DAP would otherwise attach locally and ignore the remote.
			assert.deepStrictEqual(
				dapAttachFields({ processId: "1234", target: "localhost:2345" }),
				{ target: "localhost:2345" },
			)
		})

		it("rejects an attach with neither PID, core file, nor target", () => {
			const result = dapAttachFields({})
			assert.ok("error" in result)
		})

		it("rejects a PID that is not a positive integer", () => {
			for (const processId of ["${command:v.pickProcess}", "abc", "0", "-5", "12.5"]) {
				const result = dapAttachFields({ processId })
				assert.ok("error" in result, processId)
			}
		})

		it("recognizes unsubstituted command references", () => {
			assert.ok(isCommandReference("${command:v.pickProcess}"))
			assert.ok(isCommandReference("${command:pickProcess}"))
			assert.ok(!isCommandReference("1234"))
			assert.ok(!isCommandReference(""))
		})
	})

	describe("lldb field conversion", () => {
		it("maps stopAtEntry and sourceFileMap to lldb-dap names", () => {
			assert.deepStrictEqual(
				lldbDapFields({
					stopAtEntry: true,
					sourceFileMap: { "/build": "/workspace" },
					setupCommands: [{ text: "settings set auto-confirm true" }],
					usePrettyPrinters: true,
					formattersPath: "/extension/scripts/lldb/v_formatters.py",
				}),
				{
					stopOnEntry: true,
					sourceMap: [["/build", "/workspace"]],
					preRunCommands: ["settings set auto-confirm true"],
					initCommands: ["command script import /extension/scripts/lldb/v_formatters.py"],
				},
			)
		})

		it("omits empty sourceMap and printer import when disabled", () => {
			assert.deepStrictEqual(
				lldbDapFields({ usePrettyPrinters: false, formattersPath: "/x/v_formatters.py" }),
				{ stopOnEntry: false, preRunCommands: [], initCommands: [] },
			)
		})
	})

	describe("debuggee environment", () => {
		it("preserves inherited variables under explicit entries", () => {
			const env = buildDapEnv([{ name: "VFLAGS", value: "-d debug" }], {
				PATH: "/usr/bin",
				HOME: "/root",
			})
			assert.strictEqual(env.PATH, "/usr/bin")
			assert.strictEqual(env.HOME, "/root")
			assert.strictEqual(env.VFLAGS, "-d debug")
		})

		it("merges inherited < envFile < explicit entries", () => {
			const env = buildDapEnv(
				[{ name: "VFLAGS", value: "explicit" }],
				{ PATH: "/usr/bin", SHARED: "base" },
				{ SHARED: "file", FROM_FILE: "1" },
			)
			assert.strictEqual(env.SHARED, "file")
			assert.strictEqual(env.FROM_FILE, "1")
			assert.strictEqual(env.VFLAGS, "explicit")
			assert.strictEqual(env.PATH, "/usr/bin")
		})

		it("parses KEY=VALUE files, skipping comments and blanks", () => {
			assert.deepStrictEqual(
				parseEnvFile("# comment\n\nA=1\nB = two = three\nNOEQUALS\n=noname\n"),
				{ A: "1", B: "two = three" },
			)
		})

		it("merges envFile entries after substitution and drops envFile", () => {
			// The hook runs after VS Code substitutes variables, so the path
			// here is already expanded; the merge must keep inherited values,
			// let the file override them, and let explicit entries win.
			const resolved = withEnvFileEntries(
				{
					type: "v",
					request: "launch",
					program: "/tmp/v-debug-main",
					envFile: "/w/app/.env",
					environment: [{ name: "SHARED", value: "explicit" }],
				},
				{ SHARED: "file", FROM_FILE: "1" },
				{ PATH: "/usr/bin", SHARED: "base" },
			)
			assert.deepStrictEqual(resolved.env, {
				PATH: "/usr/bin",
				SHARED: "explicit",
				FROM_FILE: "1",
			})
			assert.ok(!("envFile" in resolved))
			assert.strictEqual(resolved.program, "/tmp/v-debug-main")
		})
	})

	describe("remote pipe transport", () => {
		it("passes the remote debugger path through verbatim", () => {
			// The remote gdb may live at a different path than the local one,
			// so it must not be resolved against the local PATH.
			assert.deepStrictEqual(
				pipeTransportArgs(
					{
						pipeProgram: "ssh",
						pipeArgs: ["remote"],
						debuggerPath: "/opt/remote/bin/gdb",
					},
					["-i=dap"],
				),
				["remote", "/opt/remote/bin/gdb", "-i=dap"],
			)
		})

		it("handles a bare pipe with no extra args", () => {
			assert.deepStrictEqual(
				pipeTransportArgs({ pipeProgram: "ssh", debuggerPath: "/usr/bin/lldb-dap" }),
				["/usr/bin/lldb-dap"],
			)
		})
	})
})
