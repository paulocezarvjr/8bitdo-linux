#!/usr/bin/env python3
"""Read/write 8BitDo Retro Mechanical Keyboard *software* macros (profile layer).

Protocol reversed from Ultimate Software V2 (see docs/protocol-findings.md,
"Keyboard MACRO protocol"). Talks to the wired keyboard's vendor config
interface (Usage Page 0x008C) over hidraw, report 0x52 out / 0x54 in.

There are TWO macro stores on this keyboard:
  * the ★ star / base layer (active with the profile OFF) -- NOT this tool,
  * the software / profile layer (active when the profile is engaged via the
    8BitDo-logo key) -- what Ultimate Software V2 and THIS tool read/write.

The keyboard must be wired with the power switch OFF (config mode).

Macro step = 3 bytes:  down `81 <usage> 00`, up `01 <usage> 00`, delay `0F lo hi`.
Commands (report 0x52):  82 list · 84 <i> name · 86 <i> steps ·
                         74 write-name · 76 write-steps · 77 <key> <n> clear.

Usage:
  kbd_macro.py read                 # dump the software macro slots
  kbd_macro.py set <hwkey> <text>   # assign a typed string to <hwkey> (EXPERIMENTAL)
  kbd_macro.py clear <hwkey>        # remove the macro on <hwkey>      (EXPERIMENTAL)
  kbd_macro.py keys                 # list valid hardware key names
"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from kbd_read import find_hidraw, read_raw, load_key_tables  # noqa: E402
sys.path.insert(0, os.path.join(HERE, "..", "references", "8bitdo-kbd-mapper", "src", "eightbdkbd"))
import keys  # type: ignore  # noqa: E402

# --- macro step opcodes (byte 0 of each 3-byte step) ---
OP_UP = 0x01
OP_TIME = 0x0F
OP_DOWN = 0x81

# minimal printable-ASCII -> HID usage map for building macros from text
SHIFT = 0xE1  # left shift usage, for capitals / shifted symbols
_BASE = {}
for i, c in enumerate("abcdefghijklmnopqrstuvwxyz"):
    _BASE[c] = 0x04 + i
for i, c in enumerate("1234567890"):
    _BASE[c] = 0x1E + i
_BASE.update({" ": 0x2C, "\n": 0x28, "\t": 0x2B, "-": 0x2D, "=": 0x2E,
              "[": 0x2F, "]": 0x30, "\\": 0x31, ";": 0x33, "'": 0x34,
              "`": 0x35, ",": 0x36, ".": 0x37, "/": 0x38})


def char_to_usage(ch):
    low = ch.lower()
    if low in _BASE:
        return _BASE[low], ch.isupper()
    return None, False


# ---------------- HID transport (report 0x52 / 0x54) ----------------
def send(fd, payload):
    """Write a 33-byte report: [0x52, *payload] zero-padded."""
    os.write(fd, bytes([0x52] + list(payload)) + bytes(33 - 1 - len(payload)))


def query(fd, payload, want, chunks=12):
    """Read-style command: send, Sleep(5ms), collect 0x54 chunks (like the DLL)."""
    _drain(fd)
    send(fd, payload)
    time.sleep(0.005)
    out = []
    for _ in range(chunks):
        r = read_raw(fd, 0.4)
        if r is None:
            break
        out.append(r[:32])
        if r[0] != want:
            break
    return out


def _drain(fd):
    while read_raw(fd, 0.03) is not None:
        pass


def _ack_ok(r):
    return r is not None and r[0] == 0x54 and r[1] == 0xE4 and r[2] == 0x08


# ---------------- reads ----------------
HW_BY_CODE = {v: k for k, v in keys.HWKEY.items()}
USAGE_CHAR = {u: c for c, u in _BASE.items()}


def get_macro_list(fd):
    return query(fd, [0x82], 0x82)


def get_macro_name(fd, key):
    return query(fd, [0x84, key], 0x84)  # indexed by KEY code, not slot


def get_macro_value(fd, key):
    return query(fd, [0x86, key], 0x86)  # indexed by KEY code, not slot


def parse_macro_keys(chunks):
    """The 52 82 list is (key, attr) pairs terminated by key==0 (like 0x81)."""
    if not chunks:
        return []
    b = chunks[0]
    out = []
    i = 2
    while i < len(b) - 1:
        if b[i] == 0:
            break
        out.append(b[i])
        i += 2
    return out


def decode_steps(step_bytes):
    out = []
    for i in range(0, len(step_bytes) - 2, 3):
        t, a, _ = step_bytes[i], step_bytes[i + 1], step_bytes[i + 2]
        if t == 0:
            break
        if t == OP_TIME:
            out.append(f"delay {a | (step_bytes[i + 2] << 8)}ms")
        elif t in (OP_DOWN, OP_UP):
            ch = USAGE_CHAR.get(a, f"0x{a:02x}")
            out.append(ch + ("↓" if t == OP_DOWN else "↑"))
        else:
            out.append(f"?{t:02x}{a:02x}")
    return out


def read_all(fd):
    lst = get_macro_list(fd)
    print("software macro list (52 82):", (lst[0].hex() if lst else "-"))
    macro_keys = parse_macro_keys(lst)
    if not macro_keys:
        print("  (no software macros set)")
        return
    for k in macro_keys:
        val = get_macro_value(fd, k)
        hwname = HW_BY_CODE.get(k, f"0x{k:02x}")
        if not val or val[0][1] != 0x86:
            print(f"  {hwname} (0x{k:02x}): (no value)")
            continue
        c = val[0]
        nsteps = c[10]
        steps = bytes(c[11:])
        for extra in val[1:]:          # best-effort multi-chunk concat
            steps += bytes(extra[3:])
        steps = steps[:nsteps * 3]
        print(f"  {hwname} (0x{k:02x}), {nsteps} steps: {' '.join(decode_steps(steps))}")


# ---------------- writes (EXPERIMENTAL until hardware round-trip) ----------------
def steps_from_text(text):
    """Build the 3-byte step stream for typing `text` (down+up per char)."""
    out = bytearray()
    for ch in text:
        usage, shifted = char_to_usage(ch)
        if usage is None:
            raise ValueError(f"no HID usage for {ch!r}")
        if shifted:
            out += bytes([OP_DOWN, SHIFT, 0x00])
        out += bytes([OP_DOWN, usage, 0x00, OP_UP, usage, 0x00])
        if shifted:
            out += bytes([OP_UP, SHIFT, 0x00])
    return bytes(out)


def write_macro_steps(fd, key, step_bytes, interval_ms=0, cycles=1):
    """Port of native writeMacroJP. Small (<=21 bytes) path implemented; longer
    macros use the multi-chunk 19/18 framing (implemented, less tested)."""
    n = len(step_bytes)
    num_steps = n // 3
    if n <= 21:
        pkt = bytearray(32)
        pkt[0] = 0x76
        pkt[1] = key
        pkt[5] = 0x1A
        pkt[6] = 0x01
        if cycles == 0xFF:
            pkt[8] = 0x20
        else:
            pkt[7] = cycles
        pkt[9] = num_steps
        pkt[10:10 + n] = step_bytes
        send(fd, pkt)
        return read_raw(fd, 0.5)
    # multi-chunk
    offset = 0
    first = True
    last = None
    while offset < n:
        remaining = n - offset
        pkt = bytearray(32)
        pkt[0] = 0x76
        pkt[1] = key
        pkt[2] = 0x01
        if first:
            pkt[5] = 0x19
            pkt[6] = 0x01
            if cycles == 0xFF:
                pkt[8] = 0x20
            else:
                pkt[7] = cycles
            pkt[9] = num_steps
            take = min(20, remaining)
            pkt[10:10 + take] = step_bytes[offset:offset + take]
            first = False
        else:
            addr = offset + 4
            pkt[3] = addr & 0xFF
            pkt[4] = (addr >> 8) & 0xFF
            take = min(24, remaining)
            pkt[5] = 0x18 if remaining > 24 else remaining
            pkt[10:10 + take] = step_bytes[offset:offset + take]
        send(fd, pkt)
        last = read_raw(fd, 0.5)
        offset += take
        time.sleep(0.005)
    return last


def clear_macro(fd, key, count):
    _drain(fd)
    send(fd, [0x77, key, count])
    return read_raw(fd, 0.5)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    action = sys.argv[1]

    if action == "keys":
        print("Hardware keys:", " ".join(sorted(set(keys.HWKEY))))
        return

    dev = find_hidraw()
    if not dev:
        sys.exit("keyboard config interface not found. Wired with power switch OFF?")
    print(f"device: {dev}")
    fd = os.open(dev, os.O_RDWR)
    try:
        if action == "read":
            read_all(fd)
        elif action in ("set", "clear"):
            hwname = sys.argv[2]
            if hwname not in keys.HWKEY:
                sys.exit(f"unknown hardware key {hwname!r} (try: kbd_macro.py keys)")
            key = keys.HWKEY[hwname]
            if action == "clear":
                print(f"clear macro on {hwname} (0x{key:02x}):",
                      (clear_macro(fd, key, 200) or b"").hex())
            else:
                text = sys.argv[3]
                steps = steps_from_text(text)
                print(f"set macro {hwname} (0x{key:02x}) = {text!r} "
                      f"({len(steps)//3} steps)")
                print("  ack:", (write_macro_steps(fd, key, steps) or b"").hex())
                print("  re-read:", [r.hex() for r in get_macro_list(fd)])
        else:
            print(__doc__)
    finally:
        os.close(fd)


if __name__ == "__main__":
    main()
