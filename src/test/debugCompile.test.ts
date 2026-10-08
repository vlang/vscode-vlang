import * as assert from "assert"
import * as os from "os"
import * as path from "path"
import { describe, it } from "node:test"
import {
	cppdbgLaunchConfig,
	debugBinaryPath,
	debugCompileArgs,
	gdbSetupCommands,
	missingCppdbgMessage,
	missingDebuggerMessage,
	resolveDebuggerCommand,
	vPrintersPath,
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
		// default output name would land in the source tree.
		assert.deepStrictEqual(debugCompileArgs("/w/app/src/main.v", "/tmp/v-debug-main"), [
			"-g",
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
})
