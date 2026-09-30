# V language support for Visual Studio Code

[![Version](https://img.shields.io/visual-studio-marketplace/v/vlanguage.vscode-vlang.svg)](https://marketplace.visualstudio.com/items?itemName=vlanguage.vscode-vlang)
[![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/vlang/vscode-vlang/ci.yml?branch=master)](https://github.com/vlang/vscode-vlang/actions/)

Provides [V language](https://vlang.io) support for Visual Studio Code.

## Preview

![First demo screenshot](./images/demo.png)

## Features

### Code Editing

- syntax highlighting
- code snippets for quick coding
- completion, diagnostics, navigation, inlay hints, and other language
  features via VLS
- runnable CodeLens actions for `main` and tests
- workspace build, run, and test tasks
- test coverage highlighting and a status bar summary

### V Language Server

When V or [VLS](https://github.com/vlang/vls) is missing, the extension offers to
install it. It also checks upstream revisions at most once a day on activation
and offers updates. Nothing is installed or updated without accepting the prompt.
Use `V: Check for Tool Updates` to check immediately, or `V: Install or Update V`
and `V: Install or Update VLS` for one tool.

Accepted installations build the latest official `master` revision from source;
they require Git, GNU make, a shell and a C compiler. On Windows, Git Bash and
GNU make must be available to the extension host. Recent V versions also build
the compatibility compiler used by VLS for navigation and completion.
VLS also requires V; if V is missing, a second prompt offers to install it first.
Each build uses a new directory in the extension's global storage. After verifying
the executable, the extension selects it in settings and restarts VLS. Existing
installations are preserved; failed or cancelled builds do not replace their paths.
These managed tools are available to this extension, not added to your shell PATH.

Existing tools in PATH and custom `v.executablePath` / `v.vls.command` settings
are supported. VLS does not report a reliable build revision, so the freshness of
external VLS binaries is unknown. In that case the extension offers a managed copy
without claiming the current one is outdated; dismissing that offer suppresses it
until the configured installation changes or you check manually. Managed builds
record their source revision and executable hash so future updates can be checked.
Unavailable update checks are logged and do not prevent existing tools from running.

The status bar shows whether VLS is starting, active, stopped, disabled, missing,
or in error. Click it to open the server log or install a missing server.
`V: Restart VLS` reloads the executable, arguments, compiler path, and feature
settings, including after a failed startup.
Changing a server setting automatically restarts VLS. Settings are also sent again
after automatic crash recovery.
Automatic recovery stops after five restart attempts within three minutes; fix
the server problem and use `V: Restart VLS` to try again.

The available VLS settings are:

- `v.vls.enable`: enable or disable VLS
- `v.vls.command`: path or command name for the VLS executable; supports `~`,
  `${env:NAME}`, and `${workspaceFolder}`
- `v.vls.args`: additional command-line arguments
- `v.vls.inlayHints.enabled`: enable or disable inlay hints
- `v.vls.diagnostics`: enable or disable live diagnostics
- `v.vls.coverage.enabled`: collect coverage during test tasks and highlight
  covered and uncovered executable lines
- `v.executablePath`: V compiler used by VLS and tasks; supports absolute
  paths, `~`, `${env:NAME}`, and `${workspaceFolder}`
- `v.tools.checkForUpdates`: enable automatic update checks (default: true).
  Missing tools still prompt for installation; manual checks remain available.
- `v.tools.updateChannel`: track the latest V `master` commit (default) or the
  latest published V `release`. VLS always tracks master and usually needs a V
  newer than the latest release.

Settings from the former VLS extension (`vls.command`, `vls.args`,
`vls.vCommand`, and its inlay hint, diagnostics, and coverage toggles) remain
effective until replaced by the corresponding `v.*` settings.

VLS uses one compiler per server process, selected from the active workspace
folder at startup or the first folder when no folder is active. Tasks and manual
formatting use the compiler configured for their target folder. Workspaces that
require different compiler versions should use separate VS Code windows.

### Build, run, and test

Use `V: Build`, `V: Run`, or `V: Test` in the Command Palette, or select a V
task from `Tasks: Run Task`. Build, Run, and Test operate on the workspace;
Run uses the active V module or script when one is open, and Test uses the
active `_test.v` file. The extension saves modified V files in the target
before running.

`V: Run current file` uses the same run task. For a `.v` file, it runs the
containing module; for a `.vsh` file, it runs the script.

`V: Build optimized module` builds the active module with `v -prod`,
using the same save checks and task output as the other build commands. The
`prod` action is also available in `tasks.json`. Optimized builds reject `.vsh`
scripts because V can execute their top-level code during compilation.

`V: Format current file` formats the current editor buffer with `v fmt` and
applies an undoable edit. It does not save the source file and refuses to replace
text changed while the formatter was running. Standard editor formatting is
provided by VLS when the server is available.

VLS CodeLens actions such as `Run Main`, `Run File`, and `Run Test` use the
same tasks. Test runs collect coverage by default. Covered executable lines
are highlighted green and uncovered lines red. Click the coverage status
item or run `V: Clear Test Coverage` to remove the highlights.

## Usage

First you will need to install [Visual Studio Code][vs-code] >= `1.105`.
In the command palette (`Cmd+Shift+P`) select `Install Extensions` and choose `V`.
Alternatively you can install the extension from the [Marketplace][market-ext-link].
Now open any `.v`, `.vsh`, `.vh`, or `.vv` file in VS Code.

The extension does not install the C/C++ extension. Breakpoints remain available
for users who configure a compatible debugger separately; no V debug adapter or
automatic debug configuration is included.

## Commands

- `V: Run current file`
- `V: Format current file`
- `V: Build optimized module`
- `V: Show V version`
- `V: Install or Update V`
- `V: Install or Update VLS`
- `V: Check for Tool Updates`
- `V: Restart VLS`
- `V: Show Language Server Output`
- `V: Build`, `V: Run`, and `V: Test`
- `V: Clear Test Coverage`

You can access all of the above commands from the command palette (`Cmd+Shift+P`).

## Debug the extension

Clone this repository and run `npm ci` to install the locked dependencies.
Then press `F5` to open a new VS Code window with the extension loaded.

Development and CI use Node.js 24. Run `npm run fmt` to format with Oxfmt,
`npm run fmt:check` to verify formatting, and `npm run lint` for Oxlint with
type-aware TypeScript rules. The recommended Oxc editor extension provides both
formatting and lint diagnostics. TypeScript checks continue to target the declared
minimum VS Code API (1.105) and Node 24; their types are intentionally constrained
to those versions.

Open the output console (`Cmd+Shift+U`) to see the debug output from the extension.

Run `Cmd+Shift+P` and select `Preferences: Open User Settings` to update settings.

Run `npm test` for logic checks and `npm run test:vscode` for an extension-host
check. The latter uses a real V compiler from `V_BINARY` or PATH and a deterministic
LSP fixture by default. Set `VLS_BINARY` to test a real VLS executable instead.
It downloads a local VS Code test build if `CODE_EXECUTABLE` is unset. Tests use
an isolated workspace, extensions directory, and user profile.
After `npm run package`, set
`TEST_PACKAGED=1` when running `npm run test:vscode` to install and test the
VSIX in an isolated VS Code profile.

The real-server suite currently catches an upstream VLS limitation: workspace
rename can omit references in `_test.v` files. The deterministic LSP fixture
checks the extension's client wiring independently of server implementation gaps.

## License

The extension is distributed under [GPL-2.0-only](./LICENSE) because its
task and coverage implementation comes from the VLS VS Code extension.
Existing files covered by the [MIT license](./LICENSE.MIT) retain that license.

<!-- Links -->

[vs-code]: https://code.visualstudio.com/
[market-ext-link]: https://marketplace.visualstudio.com/items?itemName=vlanguage.vscode-vlang
