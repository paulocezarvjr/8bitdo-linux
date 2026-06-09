#!/usr/bin/env python3
"""READ-ONLY config reader for the 8BitDo Ultimate/Pro2 controller.

Ports Pro2/diReadPro2.sh (references/8bitdo-spec) to Python, using the envelope
we decoded: OUT report 0x81 / IN report 0x02 (64B) on the vendor interface
0xFFA0.

Sends ONLY the READ request (req type 0x0002). It never writes config.

Usage:
  tools/ctl_read.py                # probe: 1 packet (offset 0) + raw dump
  tools/ctl_read.py --full         # read all 1652 bytes and parse the header
  tools/ctl_read.py --full --out captures/ctl-config.bin
"""
import argparse
import glob
import os
import re
import select
import struct
import sys

VID = "2dc8"
USAGE_PAGE = 0xFFA0
CONFIG_BASE = 0x0674      # from diReadPro2.sh: bytes [11]=0x74 [12]=0x06
CONFIG_LEN = 1652
CHUNK = 45
RESP_DATA_OFFSET = 18     # from the script: data = response[18:18+size]


def find_config_hidraws():
    """All 8BitDo (VID 2dc8) hidraw nodes exposing the config interface
    (top-level Usage Page 0xFFA0). Works for the 2.4G dongle (PID 3109) and a
    cable-connected controller alike, whatever PID it enumerates as.
    Returns a list of (dev_path, pid)."""
    found = []
    for hr in sorted(glob.glob("/sys/class/hidraw/hidraw*")):
        dev = os.path.join(hr, "device")
        try:
            uevent = open(os.path.join(dev, "uevent")).read()
        except OSError:
            continue
        m = re.search(r"HID_ID=[0-9A-Fa-f]+:0*([0-9A-Fa-f]{4}):0*([0-9A-Fa-f]{4})", uevent)
        if not m or m.group(1).lower() != VID:
            continue
        pid = m.group(2).lower()
        try:
            rd = open(os.path.join(dev, "report_descriptor"), "rb").read()
        except OSError:
            rd = b""
        # Usage Page (0x06 LSB MSB) at the very start of the vendor descriptor
        if rd[:1] == b"\x06" and len(rd) >= 3 and (rd[1] | (rd[2] << 8)) == USAGE_PAGE:
            found.append(("/dev/" + os.path.basename(hr), pid))
    return found


def find_hidraw():
    """First config-capable controller hidraw, or None."""
    c = find_config_hidraws()
    return c[0][0] if c else None


def build_read_request(offset, size):
    p = bytearray(64)
    p[0] = 0x81            # OUT report id / header
    p[1] = size + 17       # response buffer size
    p[2] = 0x04            # operation on config
    p[3] = 0x02            # req type LE = 0x0002 (READ config)
    p[4] = 0x00
    p[5] = 0x00            # subreq
    p[6] = 0x00
    p[7] = size            # bytes to read
    # p[8..10] = 0
    p[11] = CONFIG_BASE & 0xFF        # 0x74
    p[12] = (CONFIG_BASE >> 8) & 0xFF  # 0x06
    # p[13..14] = 0
    p[15] = offset & 0xFF
    p[16] = (offset >> 8) & 0xFF
    return bytes(p)


def xfer(fd, packet, timeout=1.0):
    os.write(fd, packet)
    r, _, _ = select.select([fd], [], [], timeout)
    if not r:
        return None
    return os.read(fd, 64)


def hexdump(b, width=16):
    out = []
    for i in range(0, len(b), width):
        chunk = b[i:i + width]
        hx = " ".join(f"{x:02x}" for x in chunk)
        asc = "".join(chr(x) if 32 <= x < 127 else "." for x in chunk)
        out.append(f"{i:04x}  {hx:<{width*3}}  {asc}")
    return "\n".join(out)


def parse_header(blob):
    if len(blob) < 20:
        return "(blob too short to parse header)"
    flags = struct.unpack_from("<3I", blob, 0)
    crc = struct.unpack_from("<I", blob, 12)[0]
    mode, slot = struct.unpack_from("<HH", blob, 16)
    names = {0: "Disabled", 0x20200000: "Unenabled", 0x20200911: "Enabled"}
    fl = ", ".join(names.get(f, hex(f)) for f in flags)
    return (f"ProfileFlags: [{fl}]\n"
            f"CRC16(u32):   0x{crc:08x}\n"
            f"GamepadMode:  0x{mode:04x}\n"
            f"CurrentSlot:  {slot}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true", help="read all 1652 bytes")
    ap.add_argument("--out", help="save the raw blob")
    ap.add_argument("--dev", help="force /dev/hidrawN")
    ap.add_argument("--timeout", type=float, default=1.0)
    args = ap.parse_args()

    dev = args.dev or find_hidraw()
    if not dev:
        sys.exit("controller hidraw not found (VID 2dc8 PID 3109, UsagePage FFA0)")
    print(f"device: {dev}")

    try:
        fd = os.open(dev, os.O_RDWR)
    except PermissionError:
        sys.exit(f"no permission on {dev} (run with sudo or fix udev)")

    try:
        if not args.full:
            req = build_read_request(0, CHUNK)
            print("\n>> request (read config, offset 0):")
            print(hexdump(req[:20]) + "  ...")
            resp = xfer(fd, req, args.timeout)
            if resp is None:
                print("\n!! no response (timeout).")
                print("   The controller may be asleep in the dock. Take it off the")
                print("   dock / press a button to wake it, then run again.")
                return
            print("\n<< response (64B):")
            print(hexdump(resp))
            print(f"\n(useful data would be response[{RESP_DATA_OFFSET}:{RESP_DATA_OFFSET}+45])")
            return

        blob = bytearray()
        for offset in range(0, CONFIG_LEN, CHUNK):
            size = min(CHUNK, CONFIG_LEN - offset)
            resp = xfer(fd, build_read_request(offset, size), args.timeout)
            if resp is None:
                print(f"!! timeout at offset {offset}; aborting.")
                break
            blob += resp[RESP_DATA_OFFSET:RESP_DATA_OFFSET + size]
        print(f"read {len(blob)} bytes")
        print("\n=== Header ===")
        print(parse_header(blob))
        print("\n=== hexdump (first 96B) ===")
        print(hexdump(bytes(blob[:96])))
        if args.out:
            with open(args.out, "wb") as f:
                f.write(blob)
            print(f"\nsaved to {args.out}")
    finally:
        os.close(fd)


if __name__ == "__main__":
    main()
