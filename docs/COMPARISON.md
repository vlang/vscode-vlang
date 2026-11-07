# Extension comparison: Go, Rust, Zig, and V

How the VS Code extensions for comparable languages do it, where this
one stands, and what is deliberately not copied. Reference, not target:
each of these has had years of dedicated work.

## The comparators

- **Go** (`golang.Go`, ~20M installs, Google team). Fullest surface:
  gopls management, tasks, Test Explorer with lenses/coverage/pprof,
  Delve debugging, code generation (interface stubs, unit tests, struct
  tags, fill struct), toggle test file, vulnerability checks,
  playground sharing, call hierarchy. No TextMate snippets —
  completions come from gopls.
- **rust-analyzer** (server-first, ~50 commands). Assists as code
  actions, cargo taskDefinitions, opt-in Test Explorer, runnables with
  CodeLens, debugging delegated to other extensions via an engine
  choice, walkthrough, views (dependencies, syntax tree). No TextMate
  snippets, no bundled debugger.
- **Zig** (`ziglang/vscode-zig`, archived Nov 2025). Minimal: install
  and manage the toolchain, highlighting, linting, formatting,
  run/debug, optional ZLS. No snippets, no Test Explorer, no tasks
  provider.

## Where V stands

| Area         | Go                 | rust-analyzer     | Zig         | V                       |
| ------------ | ------------------ | ----------------- | ----------- | ----------------------- |
| Toolchain    | auto-installs      | bundled binary    | version mgr | managed installs        |
| Tasks        | via commands       | cargo definitions | none        | `v` provider plus gates |
| Tests        | explorer, pprof    | runnables         | none        | explorer, coverage      |
| Debugging    | Delve              | delegates         | CodeLLDB    | own `type: v`           |
| Actions      | stubs, tests, fill | ~100 assists      | none        | test skeleton only      |
| Snippets     | 0 (server)         | 0 (server)        | 0           | 50 TextMate snippets    |
| Toggle tests | yes                | peek tests        | no          | generate only           |
| Docs         | wiki spine         | book              | README      | README plus guides      |
| Agents       | none               | none              | none        | MCP server plus skills  |

## Criticism

1. Code actions are the thinnest area: one generator against Go's
   generation suite and rust-analyzer's assists. The mechanical,
   high-value V candidates are fill-struct-fields, interface stubs,
   and `or`-block insertion.
2. No toggle test file: generation covers new files, navigating back
   has no command.
3. The snippet set needs repair, not volume: duplicate prefixes,
   typos, and weak bodies (see the snippet plan in the tracking
   issue). All three comparators ship zero snippets; the set here is
   already ahead.
4. No playground share: Go's most learner-friendly command, cheap to
   mirror.
5. Docs lack an index: the content exists, but there is no wiki-style
   spine pointing at it.

## Deliberately not copied

rust-analyzer's fifty-command surface (mostly server-debug furniture),
a toolchain version manager (managed installs cover it better), and
snippet volume for its own sake.
