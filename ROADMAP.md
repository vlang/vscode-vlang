# Roadmap

Where this extension is thin, and what would close the gap. Ordered by cost,
cheapest first, so a fix that lands today is never waiting on a bigger one.

`golang.go` is the reference point, not the target. It is roughly ten times this
extension's source and has had years of dedicated work; the goal is to stop
spending developer time on things the editor can answer, not to reach parity.

Some items below are already being implemented in
[#554](https://github.com/vlang/vscode-vlang/pull/554) (tool management, current
VLS compatibility, language server lifecycle, Oxlint/Oxfmt). Those are marked
**in #554** and not duplicated here.

## P0 — defects on `master` today

- **The test suite fails on Windows.** Three tests assert POSIX path separators
  and CI runs only on `ubuntu-latest`, so nothing catches it. The assertions
  should be separator-agnostic rather than hard-coding `path.sep`.
- **CI covers one operating system.** `ubuntu-latest` for every job, while
  `golang.go` runs at least Ubuntu and Windows. The build job already exercises
  path handling via `vsce package`. Adding Windows will surface real bugs first,
  which is the point.
- **One registered command is unreachable.** `v.vls.openOutput` is registered in
  `src/commands.ts` but absent from `contributes.commands`, so it never appears in
  the Command Palette and cannot be bound to a key. There should be a test that
  every `commands.registerCommand` call has a manifest entry, rather than a
  check that happens to name the ids someone remembered.
- **`documentSelector` is narrower than the language definition.** It is
  `{ scheme: "file", language: "v" }`, so `untitled` buffers, the diff and git
  views, and `v.mod` — which `contributes.languages` does declare — get no V
  features at all.
- **Legacy `vls.*` settings are read but never declared.** `migratedSetting`
  honours `vls.command`, `vls.args`, `vls.vCommand` and the three toggles, so
  anyone who set one during the VLS extension days gets an "Unknown
  Configuration Setting" warning and no hint about what replaced it. Declaring
  them with a deprecation message costs nothing and keeps the migration honest.
- **The documented format command breaks lint.** `npm run fmt` is `prettier -w .`.
  Prettier prefers `'…'` when a string contains a double quote, and eslint is
  configured with `quotes: ["error", "double"]`, so running the format command
  rewrites the repository and then fails its own lint. One of the two should own
  quoting. **in #554** (Oxlint/Oxfmt).

## P1 — cheap, and worth doing

- **No onboarding.** There is no `contributes.walkthroughs`, so tasks, CodeLens,
  coverage and the agent commands are only discoverable from the README. A
  four-step walkthrough would also be the natural home for the agent features.
- **Two documented gates are missing from the editor.** `v -check` type-checks
  without producing a binary, and `v fmt -verify` reports whether the formatter
  would change a file. Both are the checks the rest of a change hangs on, and
  neither is reachable from the extension. `v vet` is likewise absent, even
  though the extension already ships a `problemMatchers` entry for V's own
  diagnostics.
- **Test Explorer integration.** This is the largest gap that can be closed
  without inventing anything. `golang.go` uses `vscode.tests.createTestController`
  and three views in the `test` container; this extension uses tasks and CodeLens,
  so nothing appears in the Test Explorer panel.
  The mapping is unusually good for V: a test is a `test_`-prefixed function in a
  `_test.v` file, `VTEST_ONLY` and `VTEST_ONLY_FN` take exactly the glob filter
  that `TestRunRequest.include` already models, and `v test` is already a task.
  Starting with one item per test file is enough to be useful.
- **Tasks are hand-built instead of contributed.** `src/vTasks.ts` constructs
  task objects in TypeScript. `contributes.taskDefinitions` declares a `v` type
  that nothing consumes as a `TaskProvider`, so users cannot bind `v.build` in
  `tasks.json` or override the arguments.

## P2 — larger, but bounded

- **No debugger.** This contributes `breakpoints` and leans on the C/C++
  extension; `doc/vscode.md` walks the user through a hand-written `launch.json`
  with lldb. `golang.go` contributes a debugger backed by ~144 KB of TypeScript.
  V is a better candidate than it looks: it emits DWARF, `-g` gives V line
  numbers, `-cg` gives C line numbers, and `run` and `test` already exist as
  tasks. A thin `type: "v"` debugger delegating to the C/C++ extension's DAP
  session would cost far less than building one from scratch.
- **No code actions.** Generating a `foo_test.v` skeleton for a `foo.v` is a
  mechanical transformation that V's own test layout makes unambiguous, and it is
  the one code action that pays for itself.
- **No public API.** `golang.go` exports a small surface so other extensions can
  resolve the toolchain path. Exporting `resolveV(resource)` would be enough for
  CI tooling to stop guessing.
- **No environment status.** Which `v` is live, which VLS is live, and which of
  the two V extensions in the marketplace is providing language support are all
  invisible to the user today. **Largely in #554.**

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
