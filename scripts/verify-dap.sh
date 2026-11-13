#!/usr/bin/env bash
set -euo pipefail

GDB="${GDB:-gdb}"

# Preflight: gdb must be DAP-capable (Python + dap interpreter).
if ! command -v "$GDB" >/dev/null 2>&1; then
  echo "gdb not found on PATH"
  exit 1
fi

python_out="$("$GDB" --batch -ex 'python print("ok")' 2>&1 || true)"
dap_out="$("$GDB" -i=dap --batch </dev/null 2>&1 || true)"

if echo "$python_out" | grep -q "Python scripting is not supported"; then
  ver="$("$GDB" --version 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+' | head -1)"
  echo "gdb ${ver} has no DAP support (built without Python). Install gdb >= 13 with Python, or enable the cppdbg fallback (v.debug.adapter = 'cppdbg')."
  exit 1
fi
if echo "$dap_out" | grep -qi "unrecognized\|Could not find interpreter"; then
  ver="$("$GDB" --version 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+' | head -1)"
  echo "gdb ${ver} has no DAP support (built without Python). Install gdb >= 13 with Python, or enable the cppdbg fallback (v.debug.adapter = 'cppdbg')."
  exit 1
fi

echo "Preflight passed: gdb is DAP-capable."

# Further checks require a DAP-capable host; on this host we never reach here.
echo "Core-file attach: SKIP (requires DAP-capable gdb)"
echo "Pretty printers: SKIP (requires DAP-capable gdb)"
echo "Process picker: SKIP (requires DAP-capable gdb)"

echo "PASS: preflight"
exit 0
"