"""LLDB pretty printers (formatters) for V values.

Best-effort mirrors of the GDB pretty printers in scripts/gdb/v_printers.py.
LLDB's Python API is used; anything unexpected falls back to the raw display.
"""

import lldb


def _read_string(val):
    try:
        length = val.GetChildMemberWithName("len").GetValueAsUnsigned()
        ptr = val.GetChildMemberWithName("str").GetValueAsUnsigned()
        if length <= 0:
            return '""'
        if ptr == 0:
            return None
        err = lldb.SBError()
        data = val.GetProcess().ReadMemory(ptr, length, err)
        if err.Fail():
            return None
        return '"%s"' % data.decode("utf-8", errors="replace")
    except Exception:
        return None


def v_string_summary(val, dict):
    text = _read_string(val)
    return text if text is not None else None


def v_array_summary(val, dict):
    try:
        length = val.GetChildMemberWithName("len").GetValueAsUnsigned()
        cap = val.GetChildMemberWithName("cap").GetValueAsUnsigned()
        if length < 0 or cap < 0:
            return None
        return "array(len=%d, cap=%d)" % (length, cap)
    except Exception:
        return None


def v_map_summary(val, dict):
    try:
        data = val.GetChildMemberWithName("data")
        if data.GetValueAsUnsigned() == 0:
            return "map(len=0)"
        kv = data.Dereference().GetChildMemberWithName("key_values")
        live = kv.GetChildMemberWithName("len").GetValueAsUnsigned() - kv.GetChildMemberWithName("deletes").GetValueAsUnsigned()
        if live < 0:
            return None
        return "map(len=%d)" % live
    except Exception:
        return None


def __lldb_init_module(debugger, dict):
    debugger.HandleCommand('type summary add -x -F v_formatters.v_string_summary "string"')
    debugger.HandleCommand('type summary add -x -F v_formatters.v_array_summary "^(Array|array)$"')
    debugger.HandleCommand('type summary add -x -F v_formatters.v_map_summary "^map$"')
    print("V pretty printers loaded")
"