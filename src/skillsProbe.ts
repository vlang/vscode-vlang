/** The V compiler ships agent skills and installs them with `v skills`.
 *
 * Skills go to `.agents/skills/<name>/`, which VS Code, Claude Code, opencode and
 * Copilot already read. Nothing needs to be contributed to VS Code for that: the
 * layout is an open standard. What the extension adds is a way to run the
 * install without finding a terminal, and a way to see which skills are installed
 * and which have fallen behind the compiler's copy.
 *
 * Everything here is pure so the parsing and the command line can be tested
 * without a compiler. The editor wiring lives in `skills.ts`.
 */

/** Where one skill stands, as `v skills list` reports it. */
export interface SkillEntry {
	name: string
	/** One line. An agent decides whether to load a skill from this alone. */
	description: string
	/** Files relative to the skill directory, `SKILL.md` first. */
	files: string[]
	/** The `status:` line, verbatim: `not installed`, `project`, `global`,
	 * `project (out of date)`, or several joined by a comma. */
	marker: string
}

export interface SkillCatalog {
	skills: SkillEntry[]
	/** Where the compiler's own copies live, for the message a user needs when the
	 * compiler on PATH is not the one they expect. */
	bundledRoot: string
	projectDir: string
	globalDir: string
}

const statusLine = /^\tstatus:\s*(.+)$/
const skillName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Read the catalog `v skills list` prints.
 *
 * Returns `undefined` when the output is not a catalog, which is how a compiler
 * without `v skills` is recognised: it prints its own usage text, or complains
 * that `skills` is an unknown command.
 */
export function parseSkillList(stdout: string): SkillCatalog | undefined {
	const catalog: SkillCatalog = {
		skills: [],
		bundledRoot: "",
		projectDir: "",
		globalDir: "",
	}
	let current: SkillEntry | undefined

	for (const raw of stdout.split("\n")) {
		const line = raw.replace(/\r$/, "")
		if (line.trim() === "") {
			continue
		}
		if (line.startsWith("bundled in ")) {
			catalog.bundledRoot = line.slice("bundled in ".length).trim()
			continue
		}
		if (line.startsWith("project: ")) {
			catalog.projectDir = line.slice("project: ".length).trim()
			continue
		}
		if (line.startsWith("global:  ")) {
			catalog.globalDir = line.slice("global:  ".length).trim()
			continue
		}
		if (line.startsWith("\t")) {
			if (!current) {
				continue
			}
			const status = statusLine.exec(line)
			if (status) {
				current.marker = status[1].trim()
			} else if (current.description === "") {
				current.description = line.slice(1).trim()
			} else {
				current.files.push(line.slice(1).trim())
			}
			continue
		}
		// A name at the start of a line begins the next skill. Anything else is a
		// header this version does not have, so it is skipped rather than mistaken
		// for a skill.
		if (skillName.test(line)) {
			current = { name: line, description: "", files: [], marker: "not installed" }
			catalog.skills.push(current)
		}
	}

	if (catalog.skills.length === 0) {
		return undefined
	}
	return catalog
}

export interface SkillState {
	project: boolean
	global: boolean
	/** Installed, but the compiler's copy has changed since. */
	stale: boolean
}

/** Work out what a `status:` marker means.
 *
 * `v skills list` reports drift per scope, so "installed here but out of date
 * there" is a real state and not a contradiction to flatten.
 */
export function skillState(entry: SkillEntry): SkillState {
	const scopes = entry.marker.split(",").map((part) => part.trim())
	return {
		project: scopes.some((part) => part.startsWith("project")),
		global: scopes.some((part) => part.startsWith("global")),
		stale: scopes.some((part) => part.includes("out of date")),
	}
}

export type SkillScope = "project" | "global"

/** The argument list for `v skills add`.
 *
 * `--global` selects `~/.agents/skills`, which applies to every project on the
 * machine and is written outside the workspace, so the caller has to have asked
 * for it. A project install lands in the repository and is shared with the team.
 *
 * `add` refuses to overwrite an installed skill without `--force`, so nothing is
 * at risk from not passing it here: a skill that is already there is reported as
 * already installed.
 */
export function skillAddArgs(
	names: string[],
	scope: SkillScope,
	force = false,
): string[] {
	const args = ["skills", "add", ...names]
	if (scope === "global") {
		args.push("--global")
	}
	if (force) {
		args.push("--force")
	}
	return args
}

/** The argument list for `v skills update`.
 *
 * `update` refreshes skills whose bundled copy changed and refuses to touch one
 * that was edited locally unless `--force` is given, so `--force` is not passed
 * through here.
 */
export function skillUpdateArgs(scope: SkillScope): string[] {
	return scope === "global" ? ["skills", "update", "--global"] : ["skills", "update"]
}

export interface SkillSummary {
	installed: number
	stale: number
	/** One line per skill that is not installed anywhere. */
	absent: string[]
}

/** Count what is installed and what has fallen behind.
 *
 * Shown before an install so the user can see what the command is about to change
 * rather than being told afterwards.
 */
export function summarize(catalog: SkillCatalog): SkillSummary {
	const summary: SkillSummary = { installed: 0, stale: 0, absent: [] }
	for (const entry of catalog.skills) {
		const state = skillState(entry)
		if (!state.project && !state.global) {
			summary.absent.push(entry.name)
			continue
		}
		summary.installed++
		if (state.stale) {
			summary.stale++
		}
	}
	return summary
}
