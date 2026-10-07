# TODO — single priority-ordered list

Merges `ROADMAP.md` (cost-ordered gaps vs `golang.go`), `TODO-DEBUGGER.md`
(java-debug + cpptools debugger comparison), and the vlang/vls issue
review. This file is the tracked source; `TODO-DEBUGGER.md` was folded in
and removed, `IMPROVEMENT-PLAN.md` remains local scratch (git-ignored).

Status words: **done** (in this branch), **in flight** (named branch),
**open** (not started). Branch table at the bottom. Rule for every item:
independently mergeable; pure logic in `vscode`-free modules so it is
testable without an editor (`taskSpec.ts`, `vCommand.ts`,
`coverageProfile.ts` are the pattern); visual changes need a screenshot.

## P0 — defects and unverified claims (cheapest first)

- [x] **P0-6 Legacy `vls.*` settings undeclared.** Done 2026-10-07 on
      this branch: all six keys read via `migratedSetting` (`vls.command`,
      `vls.args`, `vls.vCommand`, `vls.inlayHints.enabled`,
      `vls.diagnostics.enabled`, `vls.coverage.enabled`) declared in
      `package.json` with `markdownDeprecationMessage` naming the `v.*`
      replacement. Pinned by `declares deprecated vls.* aliases for
      migrated settings` (red before, green after). Declaration is
      display-only: `migratedSetting` inspects set values, not defaults,
      so migration behavior is unchanged.
- [x] **D0-1 `stopAtEntry` semantics.** Done 2026-10-07 on this
      branch. Measured against a `-g` build on Windows: entry is `wmain`
      (V inlines `fn main` into it; no `main` symbol exists), and the old
      args put `--eval-command` after `-- <binary>`, which gdb ignores as
      excess arguments — so `stopAtEntry` silently did nothing, twice
      over. Fix: `debugSessionArgs()` (`src/debugCompile.ts`, tested,
      platform-aware: `wmain` on win32, `main` elsewhere) emits the
      eval-command before `--`. Verified `break wmain` stops at the first
      V statement with V source shown. Follow-up found, not fixed here:
      file:line breakpoints fail on Windows/stabs (`No source file
      named`, MI-proven), so user-set V breakpoints likely fail there —
      needs the DWARF route or a GDB-version check as its own item.
- [x] **D0-2 gdb-missing error path.** Done 2026-10-07 on this
      branch: the factory fails fast with `missingDebuggerMessage()` when
      `findInPath("gdb")` finds nothing — before the 60s compile — with a
      per-OS install route (MSYS2/MinGW on win32, brew+codesign on
      darwin, apt/dnf on linux). Pinned by `names a per-OS install route
      when gdb is missing` (red before, green after). Full suite: 97
      tests, 86 pass, same 7 pre-existing Windows failures.
- [x] **D0-3 Prove the free DAP column.** Done 2026-10-07, verdict:
      the column is empty — one root cause. `DebugAdapterExecutable`
      requires the spawned process to speak DAP; raw `gdb --interpreter=mi2`
      speaks MI. Probed with a real DAP `initialize` frame: gdb answers
      `Undefined command: "Content-Length"`, never a DAP response, on any
      platform. So conditional BPs, logpoints, run-to-cursor, disassembly,
      memory, console eval, data BPs, V-named stacks and hover ALL fail at
      the handshake — none is individually broken. Redirected to new D2-0;
      D1-3/D1-4/D1-5 and D2-1..D2-4 all need D2-0 first.
- [ ] **P0-1/2/3/5 Windows suite, Windows CI, manifest check, untitled
      files** — in flight (`test/portable-paths`: 46301f7, 98e637f,
      375e663). Land it; do not duplicate.

## P1 — cheap, high impact

- [ ] **D1-4 V pretty printers (biggest visual win).** Python GDB scripts
      for `string`, `array`, `map`, `Option`/`Result`, `error`, auto-loaded
      per session, under `scripts/gdb/`. Acceptance: before/after Variables
      screenshots on one fixture — no screenshot, no merge.
- [ ] **D1-1 `miDebuggerPath` + `MIMode` (`gdb`/`lldb`).** Reuse
      `expandConfiguredPath` so `~` works from day one. Unblocks macOS.
      Same test shape as the `~` regression test.
- [ ] **P1-3 Tasks as `TaskProvider`.** `taskDefinitions` declares type
      `v` that nothing consumes; users cannot bind/override in `tasks.json`.
- [ ] **D1-5 `setupCommands` passthrough.** Unlocks GDB `skip` for
      generated-C/runtime frames (poor-man's step filters).
- [ ] **D1-2 `env` + `envFile`.** Trivial passthrough; cpptools parity.
- [ ] **D1-3 Console choice.** After D0-3 shows where I/O goes today:
      `console: integratedTerminal | internalConsole`.
- [ ] **D1-6 Troubleshooting doc** (`docs/TROUBLESHOOTING-DEBUGGING.md`):
      gdb per OS, stale binary vs breakpoint, Windows console, macOS lldb,
      stepping into C (→ D1-5). Java parity.
- [ ] **P1-1 Walkthrough, P1-2 Check/Vet, P1-4 Test Explorer, P2-2 test
      skeleton, P2-3 public API, P2-4 env status, MCP/skills exposure** —
      all in flight (branch table). Land them; do not duplicate. P1-1 should
      gain a debugging step once D1 lands.

## P2 — larger, bounded

- [ ] **D2-0 Provide a real DAP adapter (gates everything below).** Two
      routes: (a) inline `DebugAdapterInlineImplementation` translating
      DAP↔MI in-process against the spawned gdb (initialize, launch,
      setBreakpoints, threads, stackTrace, scopes, variables, evaluate,
      continue, next, stepIn, disconnect); (b) delegate: compile, then
      `vscode.debug.startDebugging` with a generated `cppdbg` config
      (cpptools is already our extensionPack). (b) is cheaper and gets
      the whole free column for real; (a) keeps `type: "v"`. Decide with
      one spike each. Until this lands, D1-3/D1-4/D1-5 and D2-1..D2-4
      are unreachable — do not polish MI flags no session can receive.
      Spikes run 2026-10-07 (probe in Temp, not shipped). **Spike A
      PASSED**: throwaway translator drove real gdb-mi2 + a V `-g`
      binary through initialize → `-break-insert wmain` → `-exec-run`
      → stopped at V entry → `-thread-info` → continue → exit →
      `-gdb-exit`, all green — the bridge is viable and sized like a
      real project (every DAP request type is more translation work).
      **Spike B structurally confirmed**: cpptools contributes
      `type: "cppdbg"` (required: only `program`; MIMode/setupCommands/
      args/cwd supported; `extension.pickNativeProcess` exists), and
      `ms-vscode.cpptools` is already our extensionPack — but it is NOT
      installed on this machine, so the live `startDebugging` proof is
      deferred to whoever implements. **Recommendation: build (b)
      first** — compile stays ours, then start a generated `cppdbg`
      session (checking the extension is present, else a D0-2-style
      message); the free column arrives with it. Note: (b) does NOT
      fix Windows/stabs file:line breakpoints (GDB-level, MI-proven) —
      that stays a separate defect. Keep (a) as the independence
      fallback.
      Implemented 2026-10-07 on this branch: `resolveDebugConfiguration`
      compiles, fail-fasts on missing gdb / missing cpptools (with
      install action), and rewrites `type: "v"` to a generated
      `cppdbg` config (`cppdbgLaunchConfig()`, tested); the raw-MI
      adapter factory and `debugSessionArgs` are removed. Suite: 96
      tests, 85 pass, same 7 pre-existing failures. Live-session proof
      still deferred (no cpptools on this machine): install it, F5 on a
      `-g` fixture, expect stop-at-entry + variables + call stack.
- [ ] **D2-1 Attach + process picker** (`request: attach`,
      `processId: ${command:pickProcess}`). Needs D2-0.
- [ ] **D2-2 Debug CodeLens over `fn main`.** Extend the existing
      `vls.runFile` middleware pattern.
- [ ] **D2-3 `sourceFileMap` + remote gdbserver configs.**
- [ ] **D2-4 Exception breakpoint for V `panic`.** Probe how panic
      surfaces in the binary first — may need a `vlang/v` change, do not
      guess.
- [ ] **D2-5 Value-format settings** (`showHex` et al., Java parity).
- [ ] **D2-6 Core-dump config.** Low priority; record only.

## Upstream VLS (vlang/vls) — improve, do not replace

- [x] **#484 (`~` in VLS location).** Fixed in extension
      (`expandConfiguredPath`), regression-tested, comment posted
      2026-10-07.
- [ ] **#473 same-module auto-import.** Server-side indexer issue.
- [ ] **#495 Windows "starting, never active".** Upstream PR #529
      announces the missing-V1-compiler cause; needs merge + a note here.
- Reference: v-analyzer (204★, tree-sitter, semantic tokens, rename,
  TOML config) is the feature bar, not a replacement target. Cheapest
  VLS-side answers in order: semantic tokens, type-definition,
  references, rename.

## In flight (stacked on #554) — land, do not duplicate

| Branch                                                     | Item                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| `test/portable-paths`                                      | P0-1 Windows suite, P0-2 Windows CI, P0-3 manifest check, P0-5 untitled |
| `feat/check-vet-fmt-tasks`                                 | P1-2 Check/Vet/Format tasks, P1-1 walkthrough                           |
| `feat/test-explorer`                                       | P1-4 Test Explorer                                                      |
| `feat/generate-test-skeleton`                              | P2-2 test-skeleton code action                                          |
| `feat/public-api`                                          | P2-3 public API                                                         |
| `feat/environment-status`                                  | P2-4 env report command                                                 |
| `feat/v-compiler-mcp-server`, `feat/agent-skills-commands` | MCP + skills exposure                                                   |
| `feat/debugger` (this branch)                              | Basic `type: "v"` GDB debugger; `~` regression test                     |

## Not doing

- Hot-Code-Replace equivalent (recompile-restart is the V story).
- Custom debug views/webviews/icons (java + cpptools use the standard
  Run view; the battle is variable/call-stack content).
- Bundling gdb, skills (`v skills` owns `.agents/skills`), or MCP
  writing tools by default (`v_edit_replace` has no preview).
- `contributes.chatSkills` duplication; anything #554 already fixes.
