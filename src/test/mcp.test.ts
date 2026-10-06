import * as assert from "assert"
import { describe, it } from "node:test"
import { describeServer, mcpServerArgs, parseToolCatalog } from "../mcpProbe"

/** Two lines from `v mcp tools`, one read-only and one that writes. */
const catalogSample = [
	"v_project_info\ttrue\tDescribe the V project this server is pointed at.",
	"v_symbols\ttrue\tList what a file declares.",
	"v_edit_replace\tfalse\tReplace a range of lines in a file.",
	"v_rename_symbol\tfalse\tRename a symbol across files.",
	"v_format\tfalse\tFormat a file.",
].join("\n")

describe("V MCP server", () => {
	it("reads the tool list a V compiler reports", () => {
		const catalog = parseToolCatalog(catalogSample)
		assert.ok(catalog)
		assert.deepStrictEqual(catalog.tools, [
			"v_project_info",
			"v_symbols",
			"v_edit_replace",
			"v_rename_symbol",
			"v_format",
		])
		// The three that write are the only part of this that can lose work, which is
		// what `--read-only` exists to withhold.
		assert.deepStrictEqual(catalog.writers, ["v_edit_replace", "v_rename_symbol", "v_format"])
	})

	it("recognises a compiler that has no `v mcp`", () => {
		// A compiler without `v mcp` rejects the subcommand and prints nothing, or
		// prints usage text. Neither is a tool list, and mistaking either for one
		// would offer a server that cannot start.
		assert.strictEqual(parseToolCatalog(""), undefined)
		assert.strictEqual(parseToolCatalog("\n\n"), undefined)
		assert.strictEqual(
			parseToolCatalog("Usage:\n  v mcp serve [options]\n       v mcp tools\n"),
			undefined,
		)
		assert.strictEqual(parseToolCatalog("unknown command `mcp`\n"), undefined)
		// The description column is free text, so only the first two columns decide.
		assert.strictEqual(parseToolCatalog("v_check\ttrue"), undefined)
		// CRLF is what the compiler prints on Windows.
		assert.ok(parseToolCatalog(catalogSample.replace(/\n/g, "\r\n")))
	})

	it("passes --root so the server does not guess the project directory", () => {
		assert.deepStrictEqual(mcpServerArgs({ root: "/w/app" }), [
			"mcp",
			"serve",
			"--root",
			"/w/app",
			"--read-only",
		])
		// `--root` stays when writing tools are allowed, or the server would fall back
		// to whatever directory the client launched it from.
		assert.deepStrictEqual(mcpServerArgs({ root: "/w/app", readOnly: false }), [
			"mcp",
			"serve",
			"--root",
			"/w/app",
		])
		assert.deepStrictEqual(mcpServerArgs({ root: "/w/app", instructions: true }), [
			"mcp",
			"serve",
			"--root",
			"/w/app",
			"--read-only",
			"--instructions",
		])
	})

	it("names each folder's server so two of them are told apart", () => {
		const catalog = parseToolCatalog(catalogSample)
		assert.ok(catalog)
		// Two folders are open, so both labels appear in the MCP list at once.
		assert.notStrictEqual(
			describeServer("app", catalog, true),
			describeServer("lib", catalog, true),
		)
		// The mode comes from the flag, not the catalog: the catalog lists every tool
		// the compiler has either way, so a read-only server would otherwise be
		// reported as writable.
		assert.ok(describeServer("app", catalog, true).includes("read-only"))
		assert.ok(describeServer("app", catalog, false).includes("3 tools can write files"))
		// The same compiler reports the same count in both modes, so the label is the
		// only place that says which one is running.
		assert.strictEqual(
			describeServer("app", catalog, true).split(",")[0],
			describeServer("app", catalog, false).split(",")[0],
		)
	})
})
