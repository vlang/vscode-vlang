# Roadmap

Where this extension is thin, and what would close the gap. Ordered by cost,
cheapest first, so a fix that lands today is never waiting on a bigger one.

`golang.go` is the reference point, not the target. It is roughly ten times this
extension's source and has had years of dedicated work; the goal is to stop
spending developer time on things the editor can answer, not to reach parity.

See `docs/COMPARISON.md` for how the Go, rust-analyzer and Zig extensions
compare area by area, and what was deliberately not copied.

## Open (cheapest first)

- **Toggle test file, both directions.** Generating covers new files;
  navigating back has no command. `testFileName` already exists, so this
  is the reverse mapping plus a command. `golang.go` parity.
- **Snippet repair and curation.** The 50-snippet set is ahead of every
  comparator (all three ship zero TextMate snippets), but it needs
  repair, not volume: duplicate `for`/`fore` prefixes, typos
  (`standart`, `multiply 'const'`), inconsistent float prefixes, and
  weak bodies (`match` without arms, `struct` without fields). Then
  about twelve V-specific additions that no server completion covers
  (`or` blocks, `test_` functions, `error()`/`none`/`panic`, channels,
  `select`, comptime pairs, attributes).
- **Fill-struct-fields code action.** Mechanical from document symbols,
  following the `codeActions.ts` pattern. Interface stubs next, only if
  the pattern proves out.
- **Playground share command.** Post the file, open the URL. Go's most
  learner-friendly command, cheap to mirror.
- **Docs index.** The content exists (README, troubleshooting guides,
  this file, the comparison); nothing points at it. A short `docs`
  index mirroring the Go wiki spine.

## Done

- Windows suite and Windows CI (#571). Separator-agnostic assertions;
  `build-and-package` runs on Windows too.
- Unreachable `v.vls.openOutput` command (#566). Registered in the
  manifest.
- Narrow `documentSelector` (#573). Covers `untitled`, `git` and
  `v.mod` now.
- Undeclared legacy `vls.*` settings (#567). Declared with deprecation
  messages.
- Format/lint coherence (#570). eslint and prettier configs agree, the
  lock installs, `fmt:check` exists and passes.
- Walkthrough and Check/Vet/Format tasks (#562).
- Test Explorer (#563).
- `v` TaskProvider: already implemented (`VTaskProvider`), verified
  against the manifest; the gap text was stale, no PR needed.
- Debugger (#567) with delegation, GDB printers (#574), path and mode
  (#575), launch options (#576), attach and remote targets (#577),
  CodeLens and panic traps (#578).
- Test skeleton code action (upstream #565).
- Public API (#564). Environment status (#566).
- MCP server (#558) and agent skills commands (#559).

## Already here, for contrast

`golang.go` registers no MCP server. The V compiler ships one — `v mcp serve`
calls the parser, checker and formatter in process, so it answers correctly
about code that does not compile yet, which a language server working from a
failed parse cannot — and it ships agent skills that install to
`.agents/skills`, an open standard every major coding agent already reads.

Both are exposed by this extension. Neither is contributed as a bundled copy: the
skills are installed by `v skills` into the standard location, so bundling them
here would put the same skill in the catalog twice, make two of them compete for
one trigger, and tie the freshness of V language knowledge to the extension's
release cadence rather than the compiler's.

## Contributing

Anything on this list is welcome. Please keep each change independently
mergeable, and keep the pure logic in modules that import nothing from `vscode`,
so it can be tested without an editor — the existing `taskSpec.ts`,
`vCommand.ts` and `coverageProfile.ts` are the pattern.
