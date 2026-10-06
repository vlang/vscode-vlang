// Checks the TextMate grammar for broken and dead pattern references.
//
// A grammar can include a pattern that does not exist, which fails at load time
// with an error that names the missing pattern but not the include that asked for
// it. And a pattern that is defined but never included is dead weight that drifts
// from the language it was written for. Both are checked here so they are caught
// by CI rather than by a user opening a file.
//
// Usage: node scripts/check-grammar.js [path-to-grammar]
// Exits 0 when every include resolves and no pattern is dead, 1 otherwise.

const fs = require("fs")
const path = require("path")

const grammarPath = path.resolve(process.argv[2] || "syntaxes/v.tmLanguage.json")
const grammar = JSON.parse(fs.readFileSync(grammarPath, "utf8"))

/** Every pattern name the repository defines. */
const defined = new Set(Object.keys(grammar.repository || {}))

/** Every pattern name an `include` asks for. */
const referenced = new Set()

/** Walk a value, collecting every `include` string it contains.
 *
 * `include` is either a single name or an array of names, and it appears at any
 * depth: in a top-level pattern, in a repository entry, in a begin/end pair, in a
 * capture's patterns. A recursive walk covers all of those without having to know
 * the shape of every rule type.
 */
function collectIncludes(value) {
	if (value === null || value === undefined) {
		return
	}
	if (typeof value === "string") {
		return
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			collectIncludes(item)
		}
		return
	}
	if (typeof value === "object") {
		if (typeof value.include === "string") {
			referenced.add(value.include)
		} else if (Array.isArray(value.include)) {
			for (const name of value.include) {
				if (typeof name === "string") {
					referenced.add(name)
				}
			}
		}
		for (const key of Object.keys(value)) {
			if (key === "include") {
				continue
			}
			collectIncludes(value[key])
		}
	}
}

collectIncludes(grammar.patterns)
collectIncludes(grammar.repository)

// `$self` is a TextMate builtin that refers to the grammar itself, not a pattern in
// the repository. It always resolves and is not a bug.
const missing = [...referenced]
	.filter((name) => name !== "$self" && !defined.has(name.replace(/^#/, "")))
	.sort()

const dead = [...defined].filter((name) => !referenced.has(`#${name}`)).sort()

let failed = false

if (missing.length > 0) {
	failed = true
	console.error("Patterns included but not defined:")
	for (const name of missing) {
		console.error(`  ${name}`)
	}
	console.error("")
}

if (dead.length > 0) {
	failed = true
	console.error("Patterns defined but never included:")
	for (const name of dead) {
		console.error(`  ${name}`)
	}
	console.error("")
}

if (failed) {
	console.error(
		`${grammarPath}: ${missing.length} missing, ${dead.length} dead. ` +
			"An include that does not resolve fails the grammar at load time.",
	)
	process.exit(1)
}

console.log(
	`${grammarPath}: ${defined.size} patterns defined, ${referenced.size} includes, all resolve.`,
)
