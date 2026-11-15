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

Core-file attach depends on the host gdb's DAP surface: DAP coreFile
support arrived in GDB 18, so on older gdbs (15.1, 17.1) it prints
`SKIP: core-file attach (gdb DAP without coreFile support; ...)` after
validating the core itself via a batch backtrace. On a gdb whose DAP
accepts `coreFile` it prints `PASS: core-file attach` instead.

Every DAP request carries a 10s timeout, so a stalled adapter fails the
check loudly instead of hanging CI. Requests follow the DAP order
initialize → launch/attach → configurationDone: the launch/attach request
goes out before its response is awaited, because gdb 18.1 holds the
launch reply until it sees configurationDone.
