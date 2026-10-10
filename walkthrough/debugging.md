# Debugging

V programs debug from the Run and Debug view with no `launch.json`: the
extension contributes a `type: "v"` debugger with a default launch
configuration, so **Start Debugging** just works. It compiles the program
with `-g` and hands the session to the C/C++ extension's `cppdbg`
adapter, which needs `ms-vscode.cpptools` and `gdb` on `PATH`.

A **Debug Main** lens over `fn main` starts the same session without any
configuration. Each session loads GDB pretty printers, so strings show
as text and `Option` values show their payload instead of raw structs —
that needs a GDB built with Python support. Panics stop in the debugger
instead of exiting.

`miDebuggerPath` names another MI debugger (with `~` expanded) and
`MIMode` selects `gdb` or `lldb`, which is what unblocks macOS. When a
session misbehaves, `docs/TROUBLESHOOTING-DEBUGGING.md` names the
failure modes.
