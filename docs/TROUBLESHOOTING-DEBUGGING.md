# Troubleshooting V debugging

Starting a `type: "v"` session compiles the program with `-g` to a fresh
temporary binary, then runs it on the selected adapter (`v.debug.adapter`):
the built-in gdb/lldb DAP server when the debugger supports it, else the
C/C++ extension's `cppdbg` adapter. Most failures fall into the cases below.

## No debugger found

The provider checks the resolved debugger before compiling. With no
`miDebuggerPath` it looks for `gdb` (`lldb` under `"MIMode": "lldb"`)
on PATH; with one set, it checks that path and names it in the error.

- Windows: install GDB via MSYS2
  (`pacman -S mingw-w64-ucrt-x86_64-gdb`) or MinGW-w64, then restart
  VS Code so PATH updates propagate.
- macOS: gdb needs a codesign dance, so prefer lldb — install the
  Xcode command line tools and set `"MIMode": "lldb"`.
- Linux: `sudo apt install gdb` (or `dnf`), `sudo apt install lldb`
  for the lldb mode.

## No pretty printing

The session sources GDB Python printers. That needs a GDB built with
Python: notably, the Scoop `gdb` package is built `--without-python`,
under which the session still runs but values show raw. The setup
commands never fail a launch, so a missing Python is silent — check
with `show configuration` in a GDB prompt if values stay raw.

## Breakpoint does not bind on Windows

Default Windows builds carry stabs instead of DWARF: stopping at entry
works (V inlines `fn main` into `wmain`, which the entry breakpoint
targets), but file:line breakpoints may report no source file. A build
with DWARF info (e.g. via a GCC-backed compiler) resolves normally.
This is a known defect, not a misconfiguration.

## Stale binary vs breakpoint

There is none to go stale: every session recompiles to a new temporary
binary, so breakpoints always match the running code. A compile failure
shows instead of launching into an old build.

## Program input and output

I/O goes to the integrated terminal by default. Set
`"externalConsole": true` for a separate console window. There is no
internal-console mode: that knob does not exist on `cppdbg`.

## Environment variables

The built-in adapters replace the debuggee environment with the `env`
they send, so the provider seeds it from the inherited environment:
setting one variable never drops PATH or HOME. Precedence is
inherited < `envFile` entries < explicit `environment` entries.

`envFile` is read after VS Code substitutes variables, so
`${workspaceFolder}/.env` resolves instead of being read literally
(a GDB/LLDB DAP adapter would ignore `envFile` itself, which is why the
provider merges it into `env`). An unreadable file warns but does not
cancel the session.

## Remote attach

With the built-in adapters, `"miDebuggerServerAddress"` alone is
enough to attach: no `processId` or `coreFile` is required, and when a
remote target and a PID are both set the target wins (GDB DAP would
otherwise attach locally and ignore the remote). The `cppdbg` fallback
still needs a `processId`.

## Core-file attach

Core files need a GDB whose DAP accepts `coreFile` (added in GDB 18;
15.1/17.1 DAPs predate it and only take `pid`/`target`). The provider checks the
probed version and cancels with an install hint instead of launching
into a guaranteed failure; the live verifier records a SKIP (validated
via a batch backtrace) on such hosts and a PASS where DAP coreFile
works.

## Stepping into generated C

`setupCommands` in the `type: "v"` config pass MI commands through
after the printer setup, e.g. GDB `skip` rules for generated-C and
runtime frames (the built-in gdb adapter translates them to CLI
equivalents). That is also where lldb-specific setup goes, since the
printer commands are gdb-only and omitted under lldb.

## Missing C/C++ extension

Only the `cppdbg` fallback needs `ms-vscode.cpptools`. The extension pack
recommends it, and with `v.debug.adapter` set to `cppdbg` a missing install
cancels the session with an install hint instead of launching.
