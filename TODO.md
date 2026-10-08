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
- [x] **P0-1/2/3/5 Windows suite, Windows CI, manifest check, untitled
      files.** Done: separator-agnostic assertions and a Windows CI job
      (#571), `openOutput` in the manifest (#566), `untitled`/`git`/`v.mod`
      selector (#573). Suite: 91 tests, 0 fail on Windows.

## P1 — cheap, high impact

- [x] **D1-4 V pretty printers (biggest visual win).** Done (#574):
      `scripts/gdb/v_printers.py` for `string`, `array`, `map`,
      `Option`/`Result`, `error`, sourced per session through MI setup
      commands. Layouts measured from DWARF, never guessed; containers
      never guess element types (erased). Acceptance is MI transcripts,
      not screenshots (no GUI automation here): all six printers
      register and render on real fixtures.
- [x] **D1-1 `miDebuggerPath` + `MIMode` (`gdb`/`lldb`).** Done (#575):
      `expandConfiguredPath` reused, macOS unblocked, lldb sessions
      carry no printer commands.
- [x] **P1-3 Tasks as `TaskProvider`.** Not a gap: `VTaskProvider`
      already provides and resolves `v` definitions (verified against
      the manifest, no PR).
- [x] **D1-5 `setupCommands` passthrough.** Done (#576): user entries
      run after the printer commands under gdb, alone under lldb.
- [x] **D1-2 `env` + `envFile`.** Done (#576): verbatim passthrough,
      resolved adapter-side.
- [x] **D1-3 Console choice.** Done as `externalConsole` (#576):
      cppdbg has no internal-console mode, so the boolean is the honest
      knob.
- [x] **D1-6 Troubleshooting doc** (`docs/TROUBLESHOOTING-DEBUGGING.md`).
      Done (#576): measured failure modes only, including scoop's
      `--without-python` gdb.
- [x] **P1-1 Walkthrough, P1-2 Check/Vet, P1-4 Test Explorer, P2-2 test
      skeleton, P2-3 public API, P2-4 env status, MCP/skills exposure.**
      Done (#562, #563, #565, #564, #566, #558, #559). P1-1 gains its
      debugging step via the README Debugging section.

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
- [x] **D2-1 Attach + process picker.** Done (#577): no compile step,
      `processId` passes through including `${command:pickProcess}`.
- [x] **D2-2 Debug CodeLens over `fn main`.** Done (#578): pure finder,
      same compile-and-delegate pipeline, palette fallback.
- [x] **D2-3 `sourceFileMap` + remote gdbserver configs.** Done (#577):
      verbatim passthrough on launch and attach, plus an attach manifest
      block.
- [x] **D2-4 Exception breakpoint for V `panic`.** Done (#578) with no
      `vlang/v` change: every panic funnels through `v_panic`, and `-d
panics_break_into_debugger` traps under a debugger (SIGTRAP
      measured, V frames intact). Debug builds carry the define.
- [x] **D2-5 Value-format settings.** Resolved as docs (#578): per-variable
      `-exec -var-set-format` (measured 4 → 0x4); the adapter has no
      showHex-style setting.
- [x] **D2-6 Core-dump config.** Recorded (#578): out of scope, manual
      `coreDumpPath` route named in the README.

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
| `fix/resuscitate-master`                                   | Master repair: install, typecheck, lint                                 |
| `test/windows-separators`                                  | Windows suite fixes and CI                                              |
| `fix/document-selector`                                    | Untitled, diff and `v.mod` selector                                     |
| `feat/pretty-printers`                                     | D1-4 GDB printers                                                       |
| `feat/debugger-path-mode`                                  | D1-1 path and mode                                                      |
| `feat/debug-launch-options`                                | D1-5, D1-2, D1-3, D1-6                                                  |
| `feat/debug-attach-map`                                    | D2-1 attach, D2-3 remote                                                |
| `feat/debug-codelens-panic`                                | D2-2 CodeLens, D2-4 panic traps                                         |

## Not doing

- Hot-Code-Replace equivalent (recompile-restart is the V story).
- Custom debug views/webviews/icons (java + cpptools use the standard
  Run view; the battle is variable/call-stack content).
- Bundling gdb, skills (`v skills` owns `.agents/skills`), or MCP
  writing tools by default (`v_edit_replace` has no preview).
- `contributes.chatSkills` duplication; anything #554 already fixes.
