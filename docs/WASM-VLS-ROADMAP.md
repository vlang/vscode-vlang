# WASM-VLS Roadmap

_Draft plan for vscode-vlang. Date: 2026-10-15._
_No code changes ship with this plan. This document records the goal, the
options, and the phased route. It does not change any default._

## Goal

All three, in order, each independently shippable:

- **G1 — zero-install desktop.** First V features work with no `v`/`vls`
  build step by the user. Prebuilt binaries ship in the VSIX; the
  `v.vls.command` override and PATH fallback keep working.
- **G2 — works on VS Code for the Web** (`vscode.dev`, `github.dev`).
  The extension installs and edits V files there. A degraded feature
  set is explicitly allowed as an interim.
- **G3 — full VLS as WASM embedded via a JS/WASM runtime.** No native
  binary required anywhere.

Ordering rule: G1 → G2-degraded → G3. No phase waits on a bigger one.

## Current state (evidence)

Extension side, read from this repo:

- `src/langserver.ts` imports `vscode-languageclient/node`. The build
  (`package.json`, `build:base`) bundles with
  `esbuild … --platform=node`, and `main` is `./out/extension.js`.
  This is a desktop-Node extension.
- Tasks, the debugger, MCP, skills, and managed-tool installs all
  assume local `v`/`vls` executables.

VLS side (`vlang/vls`, `module main`), read from upstream sources:

- Every compiler-backed feature (diagnostics, hover, completion,
  signature help, go-to-definition) shells out to a `v` subprocess
  (`run_v_argv` / `os.new_process` with `v -check`, `-line-info`,
  `-vls-mode`, `v fmt`). WASM-ing VLS therefore means WASM-ing the V
  compiler invocation model, not one binary.
- Host-OS surface: `os.ls` project walks, `find_v_dir` → `vlib`
  lookup, temp overlay dirs with symlinks, a raw-fd stdin reader,
  `net.listen_tcp` multi-client mode, and a `spawn` + `sync`
  diagnostics pool. Code-lens `v run` / `v test` compiles and runs
  user programs, which is meaningless in a browser sandbox.

V toolchain (per `vlang.io`): the JS backend is WIP and WASM builds go
"for now with Emscripten, but native WASM support is planned". The only
route today is `v -o vls.c` → `emcc` → `vls.wasm`.

VS Code web path exists but is unused here:
`vscode-languageclient/browser` (`BrowserMessageReader/Writer` over a
`Worker`) plus `@vscode/wasm-wasi` / `ms-vscode.wasm-wasi-core`
(see `code.visualstudio.com/blogs/2023/06/05/vscode-wasm-wasi`).
None of that exists in this repo today.

Verdict: VLS cannot be compiled to WASM as a drop-in. It is a research
project with the blockers enumerated below, not a packaging task.

## Options

- **A. Prebuilt native VLS (reaches G1).** Bundle one `vls` binary per
  platform in the VSIX (the rust-analyzer/clangd pattern); keep the
  version gate in `src/vlsSupport.ts` and the `v.vls.command`
  override. Kills install friction, changes nothing else, no web story.
- **B. Web extension with degraded VLS (reaches G2).** A separate
  `browser/` entry with client-only features (grammar, snippets,
  formatting where a compiler exists); full LSP stays desktop-only.
  Unblocks web presence before G3.
- **C. True WASM-VLS (reaches G3).** Upstream work owned by `vlang/v`
  and `vlang/vls`: a WASI-reactor build, compiler-as-library instead of
  subprocess spawn, a virtual FS fed from workspace documents, and the
  browser LSP transport. Blocked until V has a stable native WASM
  target and VLS drops process-spawn.

## Phased roadmap (gates, not dates)

- **Phase 0 — this document.** Lands the goal/options record plus a
  pointer in `ROADMAP.md`. No behavior change. Gate: merged doc.
- **Phase 1 — G1.** Prebuilt binaries, version-gate reuse, fallback to
  `v.vls.command`. Gate: clean-machine install reports VLS Active with
  no manual build.
- **Phase 2 — G2 degraded.** `browser` entry, manifest split, web smoke
  test on `vscode.dev`. Gate: installs on web and edits without
  errors; desktop behavior unchanged.
- **Phase 3 — G3 spike (time-boxed).** `emcc` probe of a VLS C dump;
  record the first errors; count the `os.new_process` /
  `VLS_V_COMMAND` call sites as the porting surface. Gate: go/no-go on
  a full port vs. staying at option B.
- **Phase 4 — G3 (conditional on the spike).** Upstream WASI build,
  in-process compiler, virtual FS, browser transport. Gate: full LSP
  on web with no native binary.

## Non-goals

- Executing user programs (`v run`) inside the browser.
- Bundling `gdb`, skills (`v skills` owns `.agents/skills`), or MCP
  writing tools by default.
- Touching the `## Completed` count line in `README.md` (bot-owned);
  tool PRs flip only their own rows.
