# Expected output for scripts/verify-dap.sh

On a host whose gdb lacks DAP/Python (e.g. this host's gdb 17.1), the script
exits non-zero at preflight and prints exactly:

```
gdb 17.1 has no DAP support (built without Python). Install gdb >= 13 with Python, or enable the cppdbg fallback (v.debug.adapter = 'cppdbg').
```

On a DAP-capable host, the preflight line is:

```
Preflight passed: gdb is DAP-capable.
```

followed by one PASS line per live check (pretty printers batch source,
launch, pretty printers under DAP, live PID attach) and a final
`PASS: verify-dap`. Any failure prints `FAIL: <check>` and exits
non-zero.

Core-file attach depends on the host gdb's DAP surface: gdb 15.1 only accepts
`pid`/`target`, so there it prints `SKIP: core-file attach (gdb DAP without
coreFile support; ...)` after validating the core itself via a batch
backtrace. On a gdb whose DAP accepts `coreFile` it prints
`PASS: core-file attach` instead.
