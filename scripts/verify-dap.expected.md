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

Further checks (core-file attach, pretty printers, process picker) print PASS/FAIL per check.
"