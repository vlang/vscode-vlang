"""GDB pretty printers for V values.

V compiles to C with its containers erased: every dynamic array is one
`Array` struct and every map one `map` struct, so neither carries its
element type into the debug info. These printers therefore never guess
an element type:

- `string` decodes exactly (pointer plus length, no NUL reliance).
- `__v_option_X` reads the `ok` discriminant the compiler generated and
  shows the payload, or `none`.
- `__v_result_X` reads the same discriminant and shows the value, or the
  error message.
- `IError` reads the message off the `MessageError` object, mirroring
  V's own `str()` (`msg`, plus `code` when nonzero).
- `Array` and `map` summarize what the structs do record (`len`, `cap`,
  live entries) so a glance replaces three levels of expansion.

Anything unexpected — a null pointer, a missing field, a layout from a
newer compiler — falls back to the raw display: a printer must never
raise inside a user's session.
"""

import gdb
import gdb.printing


def _v_string_text(value):
    """Decode a V `string`, or return None to fall back to raw."""
    try:
        length = int(value["len"])
        if length <= 0:
            return '""'
        address = int(value["str"])
        if address == 0:
            return None
        raw = gdb.selected_inferior().read_memory(address, length).tobytes()
        return '"%s"' % raw.decode("utf-8", errors="replace")
    except Exception:
        return None


def _v_error_text(value):
    """Format an `IError`, or return None to fall back to raw."""
    try:
        message_type = gdb.lookup_type("MessageError")
    except Exception:
        return None
    try:
        object_pointer = value["_object"]
        if int(object_pointer) == 0:
            return None
        error = object_pointer.cast(message_type.pointer()).dereference()
        text = _v_string_text(error["msg"])
        if text is None:
            return None
        try:
            code = int(error["code"])
        except Exception:
            return text
        if code > 0:
            return "%s; code: %d" % (text, code)
        return text
    except Exception:
        return None


class VStringPrinter:
    def __init__(self, value):
        self.value = value

    def to_string(self):
        return _v_string_text(self.value)


class VArrayPrinter:
    def __init__(self, value):
        self.value = value

    def to_string(self):
        try:
            length = int(self.value["len"])
            capacity = int(self.value["cap"])
            if length < 0 or capacity < 0:
                return None
            return "array(len=%d, cap=%d)" % (length, capacity)
        except Exception:
            return None


class VMapPrinter:
    def __init__(self, value):
        self.value = value

    def to_string(self):
        try:
            data = self.value["data"]
            if int(data) == 0:
                return "map(len=0)"
            key_values = data.dereference()["key_values"]
            live = int(key_values["len"]) - int(key_values["deletes"])
            if live < 0:
                return None
            return "map(len=%d)" % live
        except Exception:
            return None


class VOptionPrinter:
    def __init__(self, value):
        self.value = value

    def to_string(self):
        try:
            if int(self.value["ok"]) == 0:
                return "none"
            return "Option(%s)" % self.value["value"]
        except Exception:
            return None


class VResultPrinter:
    def __init__(self, value):
        self.value = value

    def to_string(self):
        try:
            ok = int(self.value["ok"]) != 0
        except Exception:
            return None
        if ok:
            try:
                return "ok(%s)" % self.value["value"]
            except Exception:
                return None
        try:
            text = _v_error_text(self.value["err"])
        except Exception:
            return None
        return "err(%s)" % text if text is not None else None


class VIErrorPrinter:
    def __init__(self, value):
        self.value = value

    def to_string(self):
        return _v_error_text(self.value)


def _v_printer_collection():
    collection = gdb.printing.RegexpCollectionPrettyPrinter("v")
    collection.add_printer("string", "^string$", VStringPrinter)
    collection.add_printer("Array", "^(Array|array)$", VArrayPrinter)
    collection.add_printer("map", "^map$", VMapPrinter)
    collection.add_printer("Option", "^__v_option_", VOptionPrinter)
    collection.add_printer("Result", "^__v_result_", VResultPrinter)
    collection.add_printer("IError", "^IError$", VIErrorPrinter)
    return collection


# Registered globally (no objfile): the extension sources this script fresh
# for every debug session, and replace=True keeps a relaunch from stacking
# duplicate printers.
gdb.printing.register_pretty_printer(None, _v_printer_collection(), replace=True)
