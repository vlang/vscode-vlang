#!/usr/bin/env -S v run

// Checks the TextMate grammar for broken and dead pattern references.
//
// A grammar can include a pattern that does not exist, which fails at load time
// with an error that names the missing pattern but not the include that asked for
// it. And a pattern that is defined but never included is dead weight that drifts
// from the language it was written for. Both are checked here so they are caught
// by CI rather than by a user opening a file.
//
// Usage: v run scripts/check-grammar.vsh [path-to-grammar]
// Exits 0 when every include resolves and no pattern is dead, 1 otherwise.

import json2 as json

const default_grammar_path = 'syntaxes/v.tmLanguage.json'

// Walk a value, collecting every `include` string it contains.
//
// `include` is either a single name or an array of names, and it appears at any
// depth: in a top-level pattern, in a repository entry, in a begin/end pair, in a
// capture's patterns. A recursive walk covers all of those without having to know
// the shape of every rule type.
fn collect_includes(value json.Any, mut referenced map[string]bool) {
	match value {
		map[string]json.Any {
			if include := value['include'] {
				match include {
					string {
						referenced[include] = true
					}
					[]json.Any {
						for item in include {
							if item is string {
								referenced[item] = true
							}
						}
					}
					else {}
				}
			}
			for _, v in value {
				collect_includes(v, mut referenced)
			}
		}
		[]json.Any {
			for item in value {
				collect_includes(item, mut referenced)
			}
		}
		else {}
	}
}

// The grammar path is the first argument, or the default.
const grammar_path = if os.args.len > 1 { os.args[1] } else { default_grammar_path }

content := os.read_file(grammar_path) or {
	eprintln('cannot read ${grammar_path}: ${err}')
	exit(1)
}

grammar := json.decode[map[string]json.Any](content) or {
	eprintln('cannot parse ${grammar_path}: ${err}')
	exit(1)
}

// Every pattern name the repository defines.
defined := map[string]bool{}
repository := grammar['repository'] or { exit(1) }.as_map()
for name, _ in repository {
	defined[name] = true
}

// Every pattern name an `include` asks for.
mut referenced := map[string]bool{}
collect_includes(grammar['patterns'] or { exit(1) }, mut referenced)
collect_includes(grammar['repository'] or { exit(1) }, mut referenced)

// `$self` is a TextMate builtin that refers to the grammar itself, not a pattern in
// the repository. It always resolves and is not a bug.
mut missing := []string{}
for name, _ in referenced {
	clean := name.replace('#', '')
	if name != '$self' && !defined[clean] {
		missing << name
	}
}
missing.sort()

mut dead := []string{}
for name, _ in defined {
	if !referenced['#${name}'] {
		dead << name
	}
}
dead.sort()

mut failed := false

if missing.len > 0 {
	failed = true
	eprintln('Patterns included but not defined:')
	for name in missing {
		eprintln('  ${name}')
	}
	eprintln('')
}

if dead.len > 0 {
	failed = true
	eprintln('Patterns defined but never included:')
	for name in dead {
		eprintln('  ${name}')
	}
	eprintln('')
}

if failed {
	eprintln('${grammar_path}: ${missing.len} missing, ${dead.len} dead. ' +
		'An include that does not resolve fails the grammar at load time.')
	exit(1)
}

println('${grammar_path}: ${defined.len} patterns defined, ${referenced.len} includes, all resolve.')