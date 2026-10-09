# Contributing

Node 24 (what CI pins) and `npm ci`. Nothing else is required for the logic
tests, the grammar tests, the build or the package; a V toolchain is only
needed by the extension-host tests (see _V toolchain_).

## Commands

- `npm run build` — bundle `src/extension.ts` into `out/extension.js` with a
  sourcemap. `vscode` stays external: the host provides it.
- `npm run build:prod` — the same bundle, minified. `npm run package` runs it
  first.
- `npm run watch` — rebuild on every change, with a sourcemap.
- `npm run typecheck` — `tsc --noEmit`. The compiler runs with `strict` and
  `noUncheckedIndexedAccess`, so `array[index]` is `T | undefined`.
- `npm run lint` — `eslint src`.
- `npm run fmt` / `npm run fmt:check` — prettier over the tree. Tabs, no
  semicolons, double quotes; both are enforced by config, not by review.
- `npm test` — typecheck, lint, then the logic tests. This is the gate.
- `npm run test:logic` — bundle and run the logic tests with `node --test`.
- `npm run test:grammar` — vscode-tmgrammar-test over `syntaxes/tests/*.v`
  against `syntaxes/v.tmLanguage.json`.
- `npm run test:vscode` — run the extension in a real VS Code.
- `npm run package` — `build:prod` then `vsce package`, producing a `.vsix`.

## Tests

Pure logic tests sit beside the code they test, one `src/test/<module>.test.ts`
per module, using `node:test` and `node:assert`. They are bundled to
`out/test/` and run by `node --test`. Anything that needs a live editor is an
`src/test/*.integration.ts` instead and is driven by `npm run test:vscode`.

Run one test file by building and running it directly:

```sh
npx esbuild src/test/folding.test.ts --bundle \
	--alias:vscode=./src/test/fixtures/vscode.ts \
	--platform=node --target=node24 --format=cjs --outdir=out/test
node --test out/test/folding.test.js
```

The alias is what lets a test reach a module that imports `vscode`: the module
is external to the production bundle, so the test bundle swaps in
`src/test/fixtures/vscode.ts`. A test that needs editor state (settings,
workspace folders, prompts) calls `resetVscode()` first and reads `state`
after. A test that goes through `parseByVersion` also needs `resetParseCache()`,
which memoises by document URI and version — a version a test does not change
between cases.

`test:logic` names its entry files twice, once as esbuild inputs and once for
`node --test`, so a new test file has to be added to both lists in
`package.json`.

Six tests fail on a Windows checkout for environment reasons, not for logic:
symlink permissions, POSIX paths in a fixture, and an executable name
without the `.exe` suffix Windows adds. They are, in
`npm run test:logic`:

- builds V with an installed V instead of bootstrapping from vc
- falls back to the full bootstrap when the installed V cannot build V
- does not accept copied metadata for an external or symlinked executable
- parses and merges covered and uncovered LCOV lines
- uses the nearest V project root for standalone saves and coverage
- scopes and preserves the configured server compiler

A change is green when that list is unchanged. A new name in it is a
regression until proven otherwise.

## Architecture

`src/extension.ts` only wires: `activate()` registers everything and starts
VLS when `v.vls.enable` is on. The rest is one module per concern, and the
split that matters is **pure logic in one module, editor API in another**:

- `fillStruct.ts`, `importsCleanup.ts`, `numberHover.ts`, `playground.ts`,
  `taskSpec.ts`, `testSkeleton.ts`, `decodeStruct.ts`, `docTables.ts`,
  `convert.ts`, `vpm.ts`, `processExecution.ts` — the text, argv and parse
  shapes. No `vscode` import, so `npm run test:logic` reaches them without a
  host.
- `folding.ts` — the same, plus the registration it needs to answer VS Code.
  It does import `vscode`, which is why the test bundle aliases it
  (see _Tests_), and the editor state it wants is documented there.
- `codeActions.ts`, `commands.ts`, `debugger.ts`, `langserver.ts`,
  `vTasks.ts` — the commands, providers, tasks and server that call the above.
- VLS settings migration: `settings.ts`, `vExecutable.ts`, `vCommand.ts`,
  `managedTools.ts`.
- Toolchain: `toolVersions.ts`, `toolInstallation.ts`, `toolProvisioning.ts`,
  `toolManager.ts`, `vlsSupport.ts`, `utils.ts`, `exec.ts`.
- Coverage: `coverageProfile.ts` (LCOV parse, covered-line computation) and
  `coverageDecoration.ts` (decoration and status bar).
- `documentMemo.ts` — memoise a parse per document version (see below).

## Code style

- Tabs, no semicolons, double quotes. `.prettierrc.json` and `eslint.config.mjs`
  decide; do not argue with them in review.
- A doc comment answers _why_, and records what a decision was measured
  against. `numberHover.ts` cites the V scanner rule it implements and
  `importsCleanup.ts` cites the `v fmt` version that makes its copy safe.
  A comment that restates the code is deleted.
- Be conservative in text matching. When a shape cannot be established
  textually, say nothing rather than guessing: `unusedImports` returns `[]`
  for selective and aliased imports, and the folding provider hands a document
  it cannot read back to VS Code rather than emitting a wrong range.
- Anything VS Code asks about repeatedly, while the user types, goes through
  `parseByVersion(document, parse)` in `documentMemo.ts`. It is keyed by URI
  plus document version, which is what keeps it correct.

## Grammar changes

`syntaxes/v.tmLanguage.json` is the TextMate grammar for `v`, and
`syntaxes/v.mod.tmLanguage.json` for `v.mod`. A grammar change ships with a
`// SYNTAX TEST` case in `syntaxes/tests/*.v`: a header naming the scope, then
caret assertions under each token. `npm run test:grammar` runs them.

Do not put syntax in the grammar, or in a module, that V does not have.
`#region` is the example: a line starting with `#` is one directive token to
the V parser (`directive()` in `vlib/v/parser/parser.v`), so the extension
folds the `//#region` comment form that `language-configuration.json`
declares, and `folding.ts` records the reason in its header. The same goes
for `import ( ... )`, which is not a V import form.

## V toolchain

The logic tests, grammar tests, build and package need no V.

`npm run test:vscode` runs this extension in a real VS Code, driven by
`scripts/test-vscode.cjs`. `V_BINARY` names the V compiler it expects on PATH;
`VLS_BINARY` names a real VLS, and when it is unset the bundled fake one is
used instead. `CODE_EXECUTABLE` names a VS Code installation to launch rather
than downloading a build, and `TEST_PACKAGED=1` installs the packaged VSIX into
a throwaway profile. Set `V_BINARY` and `VLS_BINARY` as absolute paths, and
expect the first run to download VS Code.

## Pull requests

One concern per branch, branched off `master`. The commit message is a
`feat:`/`fix:`/`perf:`/`docs:`/`chore:`/`refactor:` prefix, imperative and
lower case, with the issue number in the subject when there is one
(`fix: show V notices from task output as information (#550)`), and a scope
in parentheses when it is narrower than the title (`fix(grammar): scope mut
params, multi-generics, return types (#427, #453, #66)`). The subject names
the change; the body says why when the diff does not show it.

Run `npm test`, `npm run fmt:check`, `npm run lint:md`, `npm run test:grammar`
and `npm run build` before asking for review.

## Debugging the extension

Press `F5` in VS Code with this folder open. The launch configuration in
`.vscode/launch.json` builds through the `Build Extension` task and opens an
Extension Development Host with the local build loaded. Breakpoints in
`src/` resolve to the bundled `out/extension.js`. The V output channel, where
VLS and task output goes, opens from the Output pane.
