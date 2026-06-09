#!/usr/bin/env python3
"""WRITE / remap tool for the 8BitDo Retro Mechanical Keyboard.

DESTRUCTIVE: changes the active profile's key mappings. Mirrors goncalor's
map_hid_usage, but over hidraw (no libusb / no kernel-driver detach). It
snapshots the current mappings before writing so you can restore.

The keyboard must be wired with the power switch OFF.

Usage:
  kbd_write.py map <hwkey> <target>   # e.g. "map capslock esc"
  kbd_write.py disable <hwkey>        # map the key to "no event"
  kbd_write.py reset <hwkey>          # restore the key's default function
  kbd_write.py list                   # list valid hardware keys and targets
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "references", "8bitdo-kbd-mapper", "src", "eightbdkbd"))

import keys  # type: ignore  # noqa: E402
from kbd_read import (  # noqa: E402
    ATTN, cmd, find_hidraw, load_key_tables,
    get_profile_name, get_mapped_keys, get_key_mapping,
)

MAP      = [0x52, 0xFA, 0x03, 0x0C, 0x00, 0xAA, 0x09, 0x71]
MAP_DONE = [0x52, 0x76, 0xA5]
OK       = bytes([0x54, 0xE4])  # ack prefix; the 3rd byte varies per operation
DISABLE_USAGE = 0x070000  # keyboard page, usage 0 = "no event" (disabled)


def int_to_bytes(i):
    s = f"{i:x}"
    if len(s) % 2:
        s = "0" + s
    return list(bytes.fromhex(s))


def drain(fd):
    """Discard any pending input reports so reads stay in sync."""
    import select as _select
    while True:
        r, _, _ = _select.select([fd], [], [], 0)
        if not r:
            return
        try:
            os.read(fd, 64)
        except OSError:
            return


def do_map(fd, hwcode, usage_bytes):
    drain(fd)
    # An already-mapped key needs MAP sent twice: the 1st clears the old value
    # (ack 54 e4 07), the 2nd sets the new one (ack 54 e4 08). Retry until 08.
    acked = False
    last = None
    for _ in range(4):
        cmd(fd, ATTN)  # attention + discard
        r = cmd(fd, MAP + [hwcode] + usage_bytes)
        last = r
        if r is None or not r.startswith(OK):
            raise RuntimeError(f"map command not acknowledged: {r.hex() if r else 'timeout'}")
        st = r[2]
        print(f"  MAP ack: {r[:3].hex()} ({'set' if st == 0x08 else 'cleared, retrying'})")
        if st == 0x08:
            acked = True
            break
    if not acked:
        raise RuntimeError(f"MAP did not confirm set (last {last[:3].hex() if last else None})")
    r = cmd(fd, MAP_DONE)
    if r is None or not r.startswith(OK):
        raise RuntimeError(f"map-done not acknowledged: {r.hex() if r else 'timeout'}")
    print(f"  MAP_DONE ack: {r[:3].hex()}")


def snapshot(fd, hw_by_code, usage_by_hid):
    name = get_profile_name(fd)
    mapped = get_mapped_keys(fd, hw_by_code)
    lines = [f"active profile: {name!r}"]
    for code, kname in mapped:
        lines.append(f"  {kname} (0x{code:02x}) -> {get_key_mapping(fd, code, usage_by_hid)}")
    if not mapped:
        lines.append("  (no mappings)")
    return "\n".join(lines)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    action = sys.argv[1]

    if action == "list":
        print("Hardware keys:", " ".join(sorted(set(keys.HWKEY))))
        print()
        print("Targets:", " ".join(sorted(keys.USAGE)))
        return

    hw_by_code, usage_by_hid = load_key_tables()

    if action in ("map", "disable", "reset") and len(sys.argv) >= 3:
        hwname = sys.argv[2]
        if hwname not in keys.HWKEY:
            sys.exit(f"unknown hardware key {hwname!r} (try: kbd_write.py list)")
        hwcode = keys.HWKEY[hwname]
        if action == "map":
            if len(sys.argv) < 4:
                sys.exit("usage: kbd_write.py map <hwkey> <target>")
            target = sys.argv[3]
            if target not in keys.USAGE:
                sys.exit(f"unknown target {target!r} (try: kbd_write.py list)")
            usage_bytes = int_to_bytes(keys.USAGE[target][0])
            desc = f"{hwname} -> {target}"
        elif action == "disable":
            usage_bytes = int_to_bytes(DISABLE_USAGE)
            desc = f"{hwname} -> (disabled)"
        else:  # reset
            if hwname not in keys.USAGE:
                sys.exit(f"no default usage known for {hwname!r}; use 'map' explicitly")
            usage_bytes = int_to_bytes(keys.USAGE[hwname][0])
            desc = f"{hwname} -> (default {hwname})"
    else:
        print(__doc__)
        sys.exit(1)

    dev = find_hidraw()
    if not dev:
        sys.exit("keyboard config interface not found. Wired with power switch OFF?")
    print(f"device: {dev}")
    fd = os.open(dev, os.O_RDWR)
    try:
        print("\n=== BEFORE ===")
        before = snapshot(fd, hw_by_code, usage_by_hid)
        print(before)
        with open(os.path.join(HERE, "..", "captures", "kbd-snapshot-before.txt"), "w") as f:
            f.write(before + "\n")

        print(f"\n=== WRITING: {desc}  (usage bytes {bytes(usage_bytes).hex()}) ===")
        do_map(fd, hwcode, usage_bytes)
        print("write acknowledged (OK)")

        print("\n=== AFTER ===")
        print(snapshot(fd, hw_by_code, usage_by_hid))
        print(f"\nTo restore: python3 tools/kbd_write.py reset {hwname}")
    finally:
        os.close(fd)


if __name__ == "__main__":
    main()
