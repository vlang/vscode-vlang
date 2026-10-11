import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, it, mock } from "node:test"
import type { Uri as VscodeUri } from "vscode"
import { executeV } from "../exec"
import { resetVscode, Uri, workspace } from "./fixtures/vscode"

let directory = ""

beforeEach(() => {
	directory = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-vlang-exec-"))
	resetVscode()
})

afterEach(() => {
	mock.restoreAll()
	fs.rmSync(directory, { recursive: true, force: true })
})

describe("V command execution", () => {
	it("uses global compiler settings and the file directory outside workspace folders", async () => {
		const firstFolder = path.join(directory, "workspace")
		const standalone = path.join(directory, "standalone")
		fs.mkdirSync(firstFolder)
		fs.mkdirSync(standalone)
		workspace.workspaceFolders = [{ uri: Uri.file(firstFolder) }]
		mock.method(workspace, "getConfiguration", (_section: string, resource?: unknown) => ({
			inspect: () => ({ globalValue: process.execPath }),
			get: () => (resource ? path.join(directory, "wrong-compiler") : process.execPath),
		}))
		const result = await executeV(
			["-e", "console.log(require('fs').realpathSync(process.cwd()))"],
			{
				...Uri.file(path.join(standalone, "main.v")),
				scheme: "file",
			} as unknown as VscodeUri,
		)
		assert.equal(result.trim(), fs.realpathSync(standalone))
	})

	it("streams a buffer to stdin without trimming the formatted output", async () => {
		mock.method(workspace, "getConfiguration", () => ({
			inspect: () => ({ globalValue: process.execPath }),
			get: () => process.execPath,
		}))
		const content = "\tunsaved buffer\n\n"
		assert.equal(
			await executeV(["-e", "process.stdin.pipe(process.stdout)"], undefined, {
				input: content,
				cwd: directory,
			}),
			content,
		)
	})
})
