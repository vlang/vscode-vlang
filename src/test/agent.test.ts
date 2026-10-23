import * as assert from "assert"
import { describe, it } from "node:test"
import {
	parseSkillList,
	SkillCatalog,
	skillAddArgs,
	SkillEntry,
	skillState,
	skillUpdateArgs,
	summarize,
} from "../skillsProbe"

/** Two skills, as `v skills list` prints them: one installed and stale, one absent. */
const listSample = [
	"bundled in /opt/v/vlib/v/skills",
	"",
	"v-lang",
	"\tThe V language rules that make code look right fail to compile.",
	"\tSKILL.md",
	"\treferences/MUTABILITY.md",
	"\tstatus: global (out of date)",
	"v-tools",
	"\tThe V command surface.",
	"\tSKILL.md",
	"\tstatus: not installed",
	"",
	"project: /w/app/.agents/skills (missing)",
	"global:  /home/dev/.agents/skills",
	"",
].join("\n")

function entry(catalog: SkillCatalog, name: string): SkillEntry {
	const found = catalog.skills.find((skill) => skill.name === name)
	assert.ok(found, `${name} is missing from the catalog`)
	return found
}

describe("V agent skills", () => {
	it("reads the catalog a V compiler reports", () => {
		const catalog = parseSkillList(listSample)
		assert.ok(catalog)
		assert.strictEqual(catalog.bundledRoot, "/opt/v/vlib/v/skills")
		// The trailing `(missing)` is an annotation for a human, not part of the path.
		assert.strictEqual(catalog.projectDir, "/w/app/.agents/skills (missing)")
		assert.strictEqual(catalog.globalDir, "/home/dev/.agents/skills")
		assert.deepStrictEqual(
			catalog.skills.map((skill) => skill.name),
			["v-lang", "v-tools"],
		)

		const lang = entry(catalog, "v-lang")
		// The description is the only part an agent sees before deciding whether to
		// load the skill, so it must not pick up a file name.
		assert.strictEqual(lang.description, "The V language rules that make code look right fail to compile.")
		assert.deepStrictEqual(lang.files, ["SKILL.md", "references/MUTABILITY.md"])
		assert.strictEqual(lang.marker, "global (out of date)")
	})

	it("recognises a compiler that has no `v skills`", () => {
		assert.strictEqual(parseSkillList(""), undefined)
		assert.strictEqual(parseSkillList("Usage:\n  v skills list [--global]\n"), undefined)
		assert.strictEqual(parseSkillList("v skills: unknown subcommand `bogus`\n"), undefined)
		// `bundled in` alone is not a catalog, so a header-only output is rejected
		// rather than yielding an empty install that looks like success.
		assert.strictEqual(parseSkillList("bundled in /opt/v/vlib/v/skills\n"), undefined)
		// CRLF is what the compiler prints on Windows.
		assert.ok(parseSkillList(listSample.replace(/\n/g, "\r\n")))
	})

	it("separates installed, absent and stale skills", () => {
		const catalog = parseSkillList(listSample)
		assert.ok(catalog)
		assert.deepStrictEqual(skillState(entry(catalog, "v-lang")), {
			project: false,
			global: true,
			stale: true,
		})
		assert.deepStrictEqual(skillState(entry(catalog, "v-tools")), {
			project: false,
			global: false,
			stale: false,
		})
		// Installed in both scopes is a real state, and drift is reported per scope so
		// "installed here but out of date there" is not flattened away.
		const both = entry(catalog, "v-lang")
		both.marker = "project, global (out of date)"
		assert.deepStrictEqual(skillState(both), {
			project: true,
			global: true,
			stale: true,
		})
		both.marker = "project, global"
		assert.deepStrictEqual(skillState(both), {
			project: true,
			global: true,
			stale: false,
		})
	})

	it("counts what a user would gain from installing", () => {
		const catalog = parseSkillList(listSample)
		assert.ok(catalog)
		assert.deepStrictEqual(summarize(catalog), {
			installed: 1,
			stale: 1,
			absent: ["v-tools"],
		})
	})

	it("never overwrites an installed skill unless the user asked for it", () => {
		// `--force` is what replaces a skill that is already there, and `add` refuses
		// without it, so leaving it off is what keeps a local edit safe.
		assert.deepStrictEqual(skillAddArgs(["v-lang"], "project"), [
			"skills",
			"add",
			"v-lang",
		])
		assert.deepStrictEqual(skillAddArgs(["v-lang", "v-tools"], "global"), [
			"skills",
			"add",
			"v-lang",
			"v-tools",
			"--global",
		])
		assert.deepStrictEqual(skillAddArgs(["v-lang"], "project", true), [
			"skills",
			"add",
			"v-lang",
			"--force",
		])
	})

	it("updates without discarding local edits", () => {
		// `update` holds back a skill that was edited locally unless `--force` is
		// given, so it is never passed through from here.
		assert.deepStrictEqual(skillUpdateArgs("project"), ["skills", "update"])
		assert.deepStrictEqual(skillUpdateArgs("global"), ["skills", "update", "--global"])
	})
})
