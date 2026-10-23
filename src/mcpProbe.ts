/** The V compiler exposes itself to agents over MCP with `v mcp serve`.
 *
 * Everything here is pure so the detection and the command line can be tested
 * without a compiler, a workspace or an editor. The editor wiring lives in
 * `mcp.ts`.
 */

/** What `v mcp tools` reported about one V compiler. */
export interface McpToolCatalog {
	/** Every tool the server registers, in the order the compiler listed them. */
	tools: string[]
	/** The subset that writes files. */
	writers: string[]
}

const catalogLine = /^(v_[a-z0-9_]+)\t(true|false)\t/

/** Read the tool list `v mcp tools` prints.
 *
 * Returns `undefined` when the output is not a tool list, which is how a
 * compiler without `v mcp` is recognised: it prints its own usage text, or
 * complains that `mcp` is an unknown command, and neither looks like this.
 */
export function parseToolCatalog(stdout: string): McpToolCatalog | undefined {
	const tools: string[] = []
	const writers: string[] = []
	for (const line of stdout.split("\n")) {
		const match = catalogLine.exec(line.trimEnd())
		if (!match) {
			continue
		}
		tools.push(match[1])
		if (match[2] === "false") {
			writers.push(match[1])
		}
	}
	if (tools.length === 0) {
		return undefined
	}
	return { tools, writers }
}

export interface McpServerOptions {
	/** The workspace folder the server resolves relative paths against. */
	root: string
	/** Omit every tool that writes a file. */
	readOnly?: boolean
	/** Print the server's model instructions and exit, instead of serving. */
	instructions?: boolean
}

/** The argument list for `v mcp serve`.
 *
 * `--root` is always passed. The server defaults it to the working directory,
 * which for an MCP server is whatever the client happened to launch from, so
 * relying on the default would put the server's idea of the project outside the
 * folder the user has open.
 *
 * `--read-only` is the default because the three tools that write a file are
 * the only part of this that can lose work. Read-only tools carry a
 * `readOnlyHint` annotation, so an editor approves them without asking.
 */
export function mcpServerArgs(options: McpServerOptions): string[] {
	const args = ["mcp", "serve", "--root", options.root]
	if (options.readOnly !== false) {
		args.push("--read-only")
	}
	if (options.instructions) {
		args.push("--instructions")
	}
	return args
}

/** A label for the status of one workspace folder's server.
 *
 * Each folder gets its own server definition, so the label has to say which one.
 *
 * `readOnly` is passed in rather than derived from the catalog, because the
 * catalog always lists every tool the compiler has. `--read-only` decides which
 * ones the server registers, and that is the part a user needs to know.
 */
export function describeServer(
	folderName: string,
	catalog: McpToolCatalog,
	readOnly: boolean,
): string {
	const mode = readOnly ? "read-only" : `${catalog.writers.length} tools can write files`
	return `V Compiler (${folderName}): ${catalog.tools.length} tools, ${mode}`
}
