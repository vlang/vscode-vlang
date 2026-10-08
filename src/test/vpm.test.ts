import * as assert from "assert"
import { describe, it } from "node:test"
import { parseInstalledList, parseModuleInfo, parseSearchList, vpmArgs } from "../vpm"

// Real `v search vls` output (C:/Users/MR/v/.bin/v.bat, 2026-10-08).
const searchVls = [
	"Search server: https://vpm.url4e.com .",
	"Search results for `vls`:",
	"",
	"1. vls [vls]",
	"2. vlsd by zztkm [zztkm.vlsd]",
	"",
	"Use `v install author_name.module_name` to install the module.",
	"",
].join("\n")

// Real `v search json` output: note the hint line in the middle of the list.
const searchJson = [
	"Search server: https://vpm.vlang.io .",
	"Search results for `json`:",
	"",
	"1. json by prantlf [prantlf.json]",
	"2. jsonrpc by nedpals [nedpals.jsonrpc]",
	"3. cjson by lydiandy [lydiandy.cjson]",
	"4. jsonmap by Iaiao [Iaiao.jsonmap]",
	"Use `v install author_name.module_name` to install the module.",
	"",
	"5. json112 by zhangbush [zhangbush.json112]",
	"6. jsonrpcv by Te4nick [Te4nick.jsonrpcv]",
	"",
].join("\n")

// Real `v list` output: bare names, no header.
const installedList = ["markdown", "ui2", "vtext", ""].join("\n")

// Real `v show markdown` output (installed module).
const showInstalled = [
	"Name: markdown",
	"Version: 0.1.1",
	"Description: ",
	"Homepage: ",
	"Author: ",
	"License: ",
	"Location: C:\\Users\\MR\\.vmodules\\markdown",
	"Requires: ",
	"--------",
	"",
].join("\n")

// Real `v show prantlf.json` output (remote module).
const showRemote = [
	"Name: prantlf.json",
	"Homepage: https://github.com/prantlf/v-json",
	"Downloads: 0",
	"Installed: False",
	"--------",
	"",
].join("\n")

describe("parseSearchList", () => {
	it("parses real v search vls output", () => {
		assert.deepStrictEqual(parseSearchList(searchVls), [
			{ name: "vls", description: "" },
			{ name: "zztkm.vlsd", description: "" },
		])
	})

	it("parses real v search json output across a mid-list hint", () => {
		assert.deepStrictEqual(parseSearchList(searchJson), [
			{ name: "prantlf.json", description: "" },
			{ name: "nedpals.jsonrpc", description: "" },
			{ name: "lydiandy.cjson", description: "" },
			{ name: "Iaiao.jsonmap", description: "" },
			{ name: "zhangbush.json112", description: "" },
			{ name: "Te4nick.jsonrpcv", description: "" },
		])
	})

	it("keeps a trailing description when one is present", () => {
		const output = "1. vls [vls] - V language server\n"
		assert.deepStrictEqual(parseSearchList(output), [
			{ name: "vls", description: "V language server" },
		])
	})

	it("handles rows without a qualified name", () => {
		assert.deepStrictEqual(parseSearchList("1. loneword\n"), [
			{ name: "loneword", description: "" },
		])
	})

	it("returns [] for empty output and skips garbage lines", () => {
		assert.deepStrictEqual(parseSearchList(""), [])
		assert.deepStrictEqual(
			parseSearchList(
				[
					"Search server: https://vpm.vlang.io .",
					"error: Http server did not respond",
					"Use `v install author_name.module_name` to install the module.",
					"not a result row",
				].join("\n"),
			),
			[],
		)
	})
})

describe("parseInstalledList", () => {
	it("parses real v list output", () => {
		assert.deepStrictEqual(parseInstalledList(installedList), ["markdown", "ui2", "vtext"])
	})

	it("returns [] for empty output and skips garbage lines", () => {
		assert.deepStrictEqual(parseInstalledList(""), [])
		assert.deepStrictEqual(
			parseInstalledList(
				["List all installed packages.", "", "markdown", "not a module!", "ui2"].join("\n"),
			),
			["markdown", "ui2"],
		)
	})
})

describe("parseModuleInfo", () => {
	it("parses real v show output for an installed module", () => {
		const info = parseModuleInfo(showInstalled)
		assert.strictEqual(info.name, "markdown")
		assert.strictEqual(info.details["Version"], "0.1.1")
		assert.strictEqual(info.details["Location"], "C:\\Users\\MR\\.vmodules\\markdown")
		assert.strictEqual(info.details["Requires"], "")
	})

	it("parses real v show output for a remote module", () => {
		const info = parseModuleInfo(showRemote)
		assert.strictEqual(info.name, "prantlf.json")
		assert.strictEqual(info.details["Homepage"], "https://github.com/prantlf/v-json")
		assert.strictEqual(info.details["Downloads"], "0")
		assert.strictEqual(info.details["Installed"], "False")
	})

	it("never throws on empty or garbage input", () => {
		assert.deepStrictEqual(parseModuleInfo(""), { name: "", details: {} })
		const info = parseModuleInfo("garbage line\n--------\nName: kept\nno colon here\n")
		assert.strictEqual(info.name, "kept")
		assert.strictEqual(info.details["garbage line"], undefined)
	})
})

describe("vpmArgs", () => {
	it("builds argv arrays without shell interpolation", () => {
		assert.deepStrictEqual(vpmArgs("search", "vls"), ["search", "vls"])
		assert.deepStrictEqual(vpmArgs("list"), ["list"])
		assert.deepStrictEqual(vpmArgs("show", "markdown"), ["show", "markdown"])
		assert.deepStrictEqual(vpmArgs("install", "prantlf.json"), ["install", "prantlf.json"])
	})

	it("omits a missing or blank module instead of interpolating", () => {
		assert.deepStrictEqual(vpmArgs("search"), ["search"])
		assert.deepStrictEqual(vpmArgs("show", "   "), ["show"])
		assert.deepStrictEqual(vpmArgs("install"), ["install"])
		assert.deepStrictEqual(vpmArgs("list", "markdown"), ["list"])
	})
})
