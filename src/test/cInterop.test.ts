import * as assert from "assert"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { describe, it } from "node:test"
import {
	c2vBuildCommand,
	c2vExecutable,
	c2vInstallArguments,
	c2vModuleDirectory,
	c2vNotInstalledMessage,
	cOutputFileName,
	isCFileName,
	vOutputFileName,
} from "../cInterop"

describe("V and C interop", () => {
	it("derives the C output name from the V source name", () => {
		// The C lands beside the source, which is the spelling `v -o h.c hello.v` uses.
		assert.strictEqual(cOutputFileName("hello.v"), "hello.c")
		assert.strictEqual(cOutputFileName("/w/app/src/main.v"), "/w/app/src/main.c")
		assert.strictEqual(cOutputFileName("/w/app/deploy.vsh"), "/w/app/deploy.c")
		assert.strictEqual(cOutputFileName("no_extension"), "no_extension.c")
	})

	it("names the V file c2v writes for a C source", () => {
		assert.strictEqual(vOutputFileName("hello.c"), "hello.v")
		assert.strictEqual(vOutputFileName("/w/app/src/main.c"), "/w/app/src/main.v")
		assert.strictEqual(vOutputFileName("no_extension"), "no_extension.v")
	})

	it("gates the c2v command on a C source file", () => {
		assert.ok(isCFileName("hello.c"))
		assert.ok(isCFileName("/w/app/src/MAIN.C"))
		assert.ok(!isCFileName("hello.v"))
		assert.ok(!isCFileName("header.h"))
		assert.ok(!isCFileName("main.cc"))
	})

	it("names the exact install commands when c2v is missing", () => {
		// A message that does not name the commands leaves the user to go and find them.
		assert.ok(c2vNotInstalledMessage.includes("v install --git https://github.com/vlang/c2v"))
		assert.ok(c2vNotInstalledMessage.includes("v -g ~/.vmodules/c2v/"))
	})

	it("derives the module directory c2v is cloned into", () => {
		assert.strictEqual(c2vModuleDirectory("/w/modules"), path.join("/w/modules", "c2v"))
	})

	it("installs c2v with the command V's own CI runs", () => {
		// Anything else installs a different thing than `cmd/tools/translate.v` builds.
		assert.deepStrictEqual(c2vInstallArguments(), [
			"install",
			"--git",
			"https://github.com/vlang/c2v",
		])
	})

	it("builds c2v with the exact command from translate.v", () => {
		const executableName = process.platform === "win32" ? "c2v.exe" : "c2v"
		const moduleDirectory = path.join("/w/modules", "c2v")
		assert.deepStrictEqual(c2vBuildCommand("/w/modules"), {
			args: [
				"-o",
				path.join(moduleDirectory, executableName),
				"-keepc",
				"-g",
				"-experimental",
				".",
			],
			cwd: moduleDirectory,
		})
	})

	it("finds a built c2v through VMODULES or an explicit directory", () => {
		const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-vlang-c2v-"))
		const executableName = process.platform === "win32" ? "c2v.exe" : "c2v"
		try {
			// `v install` leaves a cloned tree with no executable, which is not usable.
			fs.mkdirSync(path.join(temporaryRoot, "c2v"))
			assert.strictEqual(c2vExecutable(temporaryRoot), undefined)

			fs.writeFileSync(path.join(temporaryRoot, "c2v", executableName), "")
			// The executable bit is what `isExecutable` checks on POSIX:
			// without it the file is data, not a binary.
			fs.chmodSync(path.join(temporaryRoot, "c2v", executableName), 0o755)
			const expected = path.join(temporaryRoot, "c2v", executableName)
			assert.strictEqual(c2vExecutable(temporaryRoot), expected)

			const previous = process.env.VMODULES
			process.env.VMODULES = temporaryRoot
			try {
				assert.strictEqual(c2vExecutable(), expected)
			} finally {
				if (previous === undefined) {
					delete process.env.VMODULES
				} else {
					process.env.VMODULES = previous
				}
			}
		} finally {
			fs.rmSync(temporaryRoot, { recursive: true, force: true })
		}
	})
})
