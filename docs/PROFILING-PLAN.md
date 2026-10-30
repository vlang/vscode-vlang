# V Profiling Support Plan

_Draft plan for vscode-vlang. Date: 2026-10-08._
_Stays on the current branch. No code changes ship with this plan._

## Verified toolchain facts

All facts were read from the installed V toolchain help output
and its `vlib` sources, not assumed from docs or memory.

- `v help profile` does not exist. The profiler is a build flag,
  documented under `v help build`, not a subcommand or topic.
- `-prof, -profile <file.txt>` compiles the program so every V
  function is timed. Results land in `file.txt` after it exits.
- Each result line holds four space-separated fields: call count,
  total time in nanoseconds, average per call, function name.
- The flag composes with `run`: `v -prof prof.txt run main.v`.
- `-profile -` prints the report to stdout instead of a file.
- `import v.profile` with `profile.on(false)` and
  `profile.on(true)` pauses and resumes recording. The module is
  tiny (`vlib/v/profile/api.v`, 15 lines) and `on()` only exists
  under `@[if profile]`.
- `-d no_profile_startup` drops pre-`main` init from the report.
- `-profile-fns f1,f2` instruments only named functions plus the
  functions they call. `-profile-no-inline` skips `[inline]` code.
- The help text warns the profiler is not thread safe, so numbers
  from multithreaded programs are approximate, not exact.
- There is no pprof-compatible output and no bundled visualizer.
  No `*pprof*` file ships anywhere in the toolchain.
- This extension has no Test Explorer today. `src` holds no test
  controller; the closest feature is VLS test coverage display
  (`src/coverageProfile.ts`, `src/coverageDecoration.ts`).
- For contrast only, from general knowledge: the Go extension
  turns `go test -cpuprofile` pprof files into Test Explorer
  affordances backed by `go tool pprof`. V has no binary profile
  format, so that design cannot be copied as is.

## Data source decision

Use the `-profile` text table as the single data source.

- Run the target with `v -profile <tmpfile> run <target>` (or
  build with `-profile`, then execute the binary), wait for exit,
  then parse `<tmpfile>`. Prefer a temp file over `-profile -`
  so the profiled program's own stdout cannot corrupt parsing.
- Parse defensively: skip blank lines, accept only lines shaped
  like the documented example (`127 0.721ms 5680ns println`),
  and keep the raw file so a "show raw" command can display
  exactly what the compiler wrote.

## Where profiling surfaces

Two candidate homes, one recommendation.

- Option A: Test Explorer run profile. Needs a test controller,
  which this extension does not have. Profiling also applies to
  any runnable program, not only tests, so this home is narrow.
- Option B: dedicated command flow. A `V: Profile Current File`
  command plus a report view works for programs and tests alike
  and needs no Test Explorer to exist first.
- Recommendation: build Option B now. Structure the runner and
  parser as reusable modules so a future Test Explorer can add
  per-test profile buttons on top without rework.

## Report view technology

VS Code offers no chart API, so every chart is custom work.

- Option 1: bundle a chart library in a webview. Adds bundle
  weight, Content-Security-Policy plumbing, and a dependency to
  maintain, for data that is one flat table.
- Option 2: shell out to an external visualizer. Nothing in the
  V toolchain reads its own profile format, so there is no tool
  to shell out to.
- Option 3: hand-rolled webview. A sortable table with a
  proportional bar column and a share-of-total column covers the
  documented use case in plain HTML and CSS with zero
  dependencies. It also fits the extension's offline story.
- Recommendation: Option 3. Note the honest limit: `-profile`
  data is flat self-time with no call graph, so a flame graph
  would be decoration, not information. Do not draw one until
  the toolchain emits stack or caller data.

## Phase 0: command and parser

- Add a `V: Profile Current File` command that runs the active
  `.v` file under `v -profile <tmpfile> run`, then shows the raw
  report in an output channel or read-only document.
- Ship a parser module for the four-field format with unit tests
  covering the documented example lines and malformed input.
- Phase 0 acceptance: profiling the standard hello-world sample
  shows a parsed table; a program that fails to build shows the
  compiler error, never an empty or stale report; temp files are
  cleaned up on success and kept on failure for inspection.

## Phase 1: sortable report webview

- Render the parsed model as a sortable table: function, calls,
  total, average, share of total, plus an inline bar column.
- Add a function filter box and a "show raw" toggle that reveals
  the exact compiler-emitted text the table was built from.
- Phase 1 acceptance: columns sort both directions; the shares
  sum to 100 percent modulo rounding; the raw toggle matches the
  temp file byte for byte; the webview works with no network.

## Phase 2: editor integration

- CodeLens or gutter hints on the hottest functions linking back
  to the report rows, reusing the coverage decoration patterns.
- A setting for default profile flags, for example always adding
  `-d no_profile_startup` or a `-profile-fns` allow-list.
- Phase 2 acceptance: hints appear only for profiled runs and
  clear on the next edit; settings round-trip through reload.

## Explicitly out of scope

- Sampling, system, or memory profilers. Only `-profile` counts.
- pprof import, export, or `go tool pprof` style views.
- Live, attach, or continuous profiling of running processes.
- Fixing the toolchain's thread-safety warning upstream.
- Chart-library dashboards and flame graphs from flat data.
- Remote targets and multi-root quirks beyond what the existing
  run and test commands already handle.
