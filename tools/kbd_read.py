#!/usr/bin/env python3
"""READ-ONLY reader for the 8BitDo Retro Mechanical Keyboard config.

Talks to the wired keyboard's vendor config interface (Usage Page 0x008C) over
hidraw. Sends only query commands (ATTN + 0x80/0x81/0x83); it never writes a
mapping. Protocol and key tables come from references/8bitdo-kbd-mapper
(goncalor), but here we use hidraw instead of detaching the kernel driver.

The keyboard must be connected by USB cable with the power switch OFF.
"""
import glob
import os
import re
import select
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
KEYS_PATH = os.path.join(HERE, "..", "references", "8bitdo-kbd-mapper", "src", "eightbdkbd")

VID = "2dc8"
PIDS = {"5200", "5209"}

ATTN            = [0x52, 0x76, 0xFF]
PROFILE_GETNAME = [0x52, 0x80]
PROFILE_GETMAP  = [0x52, 0x81]
MAPPING_GET     = [0x52, 0x83]

NAME    = bytes([0x54, 0x80, 0x10, 0x00])
NAME108 = bytes([0x54, 0x80, 0x0A, 0x00])
NONE    = bytes([0x54, 0x80, 0x00, 0x00])
MAPPED  = bytes([0x54, 0x81])
MAPPING = bytes([0x54, 0x83])


def load_key_tables():
    """Load HWKEY/USAGE from the goncalor submodule; return reverse lookups."""
    try:
        sys.path.insert(0, KEYS_PATH)
        import keys  # type: ignore
        hw_by_code = {v: k for k, v in keys.HWKEY.items()}
        usage_by_hid = {v[0]: k for k, v in keys.USAGE.items()}
        return hw_by_code, usage_by_hid
    except Exception as e:  # noqa
        print(f"(key tables unavailable: {e}; showing raw codes)", file=sys.stderr)
        return {}, {}


def find_hidraw():
    for hr in sorted(glob.glob("/sys/class/hidraw/hidraw*")):
        dev = os.path.join(hr, "device")
        try:
            uevent = open(os.path.join(dev, "uevent")).read()
        except OSError:
            continue
        m = re.search(r"HID_ID=[0-9A-Fa-f]+:0*([0-9A-Fa-f]{4}):0*([0-9A-Fa-f]{4})", uevent)
        if not m or m.group(1).lower() != VID or m.group(2).lower() not in PIDS:
            continue
        try:
            rd = open(os.path.join(dev, "report_descriptor"), "rb").read()
        except OSError:
            rd = b""
        if rd[:2] == b"\x05\x8c":  # Usage Page (vendor 0x8C) — the config interface
            return "/dev/" + os.path.basename(hr)
    return None


def read_raw(fd, timeout=1.0):
    r, _, _ = select.select([fd], [], [], timeout)
    if not r:
        return None
    return os.read(fd, 64)


def cmd(fd, data, timeout=1.0):
    """Write a 33-byte report (id + 32 data) and read one response."""
    os.write(fd, bytes(data) + bytes(33 - len(data)))
    return read_raw(fd, timeout)


def get_profile_name(fd):
    cmd(fd, ATTN)
    r = cmd(fd, PROFILE_GETNAME)
    if r is None:
        return "(no response)"
    if r.startswith(NONE):
        return None
    if r.startswith(NAME) or r.startswith(NAME108):
        return r.rstrip(b"\0")[4:].decode("utf-16-be", errors="replace")
    return f"(unexpected: {r[:8].hex()})"


def get_mapped_keys(fd, hw_by_code):
    cmd(fd, ATTN)
    r = cmd(fd, PROFILE_GETMAP)
    if r is None or not r.startswith(MAPPED):
        return []
    keymap = bytearray(r[2:-1])
    while r[-1] == 0x01:  # more chunks follow
        r = read_raw(fd)
        if r is None or not r.startswith(MAPPED):
            break
        keymap += r[2:-1]
    keys_found = []
    for i, kc in enumerate(keymap):
        if i % 2 == 1:      # 0x07 separator
            continue
        if kc == 0:         # terminator
            break
        keys_found.append((kc, hw_by_code.get(kc, f"0x{kc:02x}")))
    return keys_found


def get_key_mapping(fd, hwcode, usage_by_hid):
    cmd(fd, ATTN)
    r = cmd(fd, MAPPING_GET + [hwcode])
    if r is None or not r.startswith(MAPPING):
        return "(no response)"
    hid_int = int.from_bytes(r[3:6], "big")
    return usage_by_hid.get(hid_int, f"HID 0x{hid_int:06x}")


def main():
    hw_by_code, usage_by_hid = load_key_tables()
    dev = find_hidraw()
    if not dev:
        sys.exit("keyboard config interface not found "
                 "(VID 2dc8 PID 5200/5209, UsagePage 0x8C). "
                 "Is it wired with the power switch OFF?")
    print(f"device: {dev}")
    fd = os.open(dev, os.O_RDWR)
    try:
        name = get_profile_name(fd)
        print(f"active profile: {name!r}")
        mapped = get_mapped_keys(fd, hw_by_code)
        if not mapped:
            print("mapped keys: (none — factory default)")
            return
        print(f"mapped keys ({len(mapped)}):")
        for code, kname in mapped:
            target = get_key_mapping(fd, code, usage_by_hid)
            print(f"  {kname:>10s} (0x{code:02x})  ->  {target}")
    finally:
        os.close(fd)


if __name__ == "__main__":
    main()
