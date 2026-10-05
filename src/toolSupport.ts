import { promises as fs } from "fs"
import * as os from "os"
import * as path from "path"
import { runToolProcess, type ToolProcessRunner } from "./toolInstallation"

/** First upstream VLS with shared V3 checks and validated semantic renames. */
export const MIN_VLS_REVISION = "4f668aa04e2568eb7ffdc6a02198ef14cec3e12a"
export const VLS_SUPPORT_BASELINE = MIN_VLS_REVISION

export class UnsupportedVCompilerError extends Error {
	constructor(detail?: string) {
		super(
			`The configured V compiler does not provide the current V3 compiler answers required by VLS. Run V: Install or Update V using the master channel, then install or restart VLS.${detail ? ` ${detail}` : ""}`,
		)
	}
}

export interface CompilerSupportOptions {
	signal?: AbortSignal
	run?: ToolProcessRunner
	env?: typeof process.env
	/** Parent of a temporary fixture; the probe never writes into a project. */
	directory?: string
}

const probeSource = `module main

interface Named {
	name string
}
struct Sample {
	name string
}
fn name_of[T Named](value T) string {
	return value.name
}
fn main() {
	sample := Sample{name: 'vls'}
	println(name_of(sample))
}
`

/** Require compiler answers for current constrained-generic code, without a V1 fallback. */
export async function requireCurrentVCompiler(
	executable: string,
	options: CompilerSupportOptions = {},
): Promise<void> {
	options.signal?.throwIfAborted()
	const directory = await fs.mkdtemp(
		path.join(options.directory ?? os.tmpdir(), "vscode-vlang-v3-"),
	)
	try {
		const file = path.join(directory, "main.v")
		await fs.writeFile(file, probeSource)
		const env: typeof process.env = {
			...(options.env ?? process.env),
			V_MACOS_V3_NO_FALLBACK: "1",
		}
		for (const key of Object.keys(env)) {
			if (["VFLAGS", "VARGS"].includes(key.toUpperCase()) || key.startsWith("V_DIAGNOSTICS_"))
				delete env[key]
		}
		const result = await (options.run ?? runToolProcess)(
			executable,
			[
				"-new-compiler",
				"-check",
				"-nocolor",
				"-vls-mode",
				"-line-info",
				`${file}:14:gd^10`,
				file,
			],
			{ cwd: directory, env, timeoutMs: 20_000, signal: options.signal },
		)
		options.signal?.throwIfAborted()
		const normalize = (value: string): string => path.normalize(value).replace(/\\/g, "/")
		const supported = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).some((line) => {
			const answer = /^(.*):(\d+):(\d+)$/.exec(line.trim())
			return (
				answer !== null &&
				normalize(answer[1]!) === normalize(file) &&
				Number(answer[2]) === 9 &&
				Number(answer[3]) > 0
			)
		})
		if (!supported) throw new UnsupportedVCompilerError()
	} catch (error) {
		if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError"))
			throw error
		if (error instanceof UnsupportedVCompilerError) throw error
		throw new UnsupportedVCompilerError(error instanceof Error ? error.message : String(error))
	} finally {
		await fs.rm(directory, { recursive: true, force: true })
	}
}
