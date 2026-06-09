#!/usr/bin/env python3
"""READ-ONLY scan of the keyboard's per-key mappings.

Probes get-key-mapping (report 0x83) across a range of hardware key codes and
prints the current target usage for each one that responds. Useful to discover
hardware codes that aren't in goncalor's table (e.g. the A/B Super Buttons).

Sends only ATTN + 0x83 queries; never writes. Keyboard wired, switch OFF.
"""
import os
import select
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from kbd_read import (  # noqa: E402
    ATTN, find_hidraw, load_key_tables, MAPPING, MAPPING_GET,
)

USAGE_7 = 0x070024  # HID usage for "7"
USAGE_8 = 0x070025  # HID usage for "8"


def drain(fd):
    while True:
        r, _, _ = select.select([fd], [], [], 0)
        if not r:
            return
        try:
            os.read(fd, 64)
        except OSError:
            return


def cmd(fd, data, timeout):
    os.write(fd, bytes(data) + bytes(33 - len(data)))
    r, _, _ = select.select([fd], [], [], timeout)
    return os.read(fd, 64) if r else None


def probe(fd, code, timeout=0.25):
    drain(fd)
    cmd(fd, ATTN, timeout)
    r = cmd(fd, MAPPING_GET + [code], timeout)
    if r is None or not r.startswith(MAPPING):
        return None
    return int.from_bytes(r[3:6], "big")


def main():
    lo = int(sys.argv[1], 0) if len(sys.argv) > 1 else 0x00
    hi = int(sys.argv[2], 0) if len(sys.argv) > 2 else 0xFF
    hw_by_code, usage_by_hid = load_key_tables()
    dev = find_hidraw()
    if not dev:
        sys.exit("keyboard config interface not found. Wired with switch OFF?")
    print(f"device: {dev}  scanning hw codes 0x{lo:02x}..0x{hi:02x}")
    fd = os.open(dev, os.O_RDWR)
    hits_78 = []
    try:
        for code in range(lo, hi + 1):
            hid = probe(fd, code)
            if hid is None:
                continue
            uname = usage_by_hid.get(hid, f"HID 0x{hid:06x}")
            hwname = hw_by_code.get(code, "?")
            mark = ""
            if hid in (USAGE_7, USAGE_8):
                mark = "   <<< maps to 7/8"
                hits_78.append((code, hwname, uname))
            print(f"  hw 0x{code:02x} ({hwname:>10s}) -> {uname}{mark}")
    finally:
        os.close(fd)
    print("\ncodes mapping to 7/8:")
    for code, hwname, uname in hits_78:
        print(f"  0x{code:02x} ({hwname}) -> {uname}")


if __name__ == "__main__":
    main()
