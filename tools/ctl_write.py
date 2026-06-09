#!/usr/bin/env python3
"""WRITE config to the 8BitDo Ultimate/Pro2 controller (port of diWritePro2.sh).

DANGER: this WRITES to the controller. It DEFAULTS to --dry-run (prints the
packets, sends nothing). Pass --commit to actually write. It always reads a
fresh backup first.

It writes the EXACT bytes of --in (a 1652-byte blob); it never synthesizes
config. You edit by editing a blob, then writing it. The config has no checksum
to recompute (verified: the spec's 'CRC16' field is not a CRC).

Transport (same envelope as the reader): cmd 0x04 / sub 0x01 (WRITE), 45-byte
chunks at increasing offsets, each acked '02 04 04 00 01 00 <wrote> <total>
<offset>'; then FINALIZE cmd 0x06 / sub 0x15, acked '02 04 04 00 06 00'.

Requires the config interface (Usage Page 0xFFA0): the 2.4G dongle with the
controller NOT in Xinput gamepad mode (turn the controller off/idle so the
dongle enumerates as PID 3109 and exposes config).

Usage:
  tools/ctl_write.py --in captures/ctl-config.bin              # DRY-RUN (default)
  tools/ctl_write.py --in captures/ctl-config.bin --commit     # actually write
"""
import argparse
import os
import select
import sys
import time

import ctl_read
from ctl_read import CONFIG_LEN, CHUNK, hexdump

WRITE_HDR = 19          # data bytes start at offset 19 in the 64-byte packet
CHUNK_ACK = bytes([0x02, 0x04, 0x04, 0x00, 0x01, 0x00])   # + wrote/total/offset
FINAL_ACK = bytes([0x02, 0x04, 0x04, 0x00, 0x06, 0x00])


def build_write_request(offset, chunk):
    size = len(chunk)
    p = bytearray(64)
    p[0] = 0x81            # OUT report id / header
    p[1] = size + 17       # payload size
    p[2] = 0x04            # operation on config
    p[3] = 0x01            # req type LE = 0x0001 (WRITE config)
    p[7] = size            # bytes in this chunk
    p[11] = 0x74           # CONFIG_BASE low  (0x0674)
    p[12] = 0x06           # CONFIG_BASE high
    p[15] = offset & 0xFF
    p[16] = (offset >> 8) & 0xFF
    p[WRITE_HDR:WRITE_HDR + size] = chunk
    return bytes(p)


def build_finalize():
    p = bytearray(64)
    p[0] = 0x81
    p[1] = 0x11            # payload size 17
    p[2] = 0x04
    p[3] = 0x06            # FINALIZE command
    p[5] = 0x15            # sub 0x15
    return bytes(p)


def read_resp(fd, timeout):
    r, _, _ = select.select([fd], [], [], timeout)
    if not r:
        return None
    return os.read(fd, 64)


def expect_chunk_ack(fd, size, offset, timeout=1.0, tries=8):
    """Read responses until the write ack for (size, offset) arrives."""
    for _ in range(tries):
        resp = read_resp(fd, timeout)
        if resp is None:
            return None
        if (resp[:6] == CHUNK_ACK and resp[6] == size
                and resp[14] == (offset & 0xFF) and resp[15] == ((offset >> 8) & 0xFF)):
            return resp
    return None


def expect_final_ack(fd, timeout=1.0, tries=8):
    for _ in range(tries):
        resp = read_resp(fd, timeout)
        if resp is None:
            return None
        if resp[:6] == FINAL_ACK:
            return resp
    return None


def read_full(fd, timeout=1.0):
    blob = bytearray()
    for off in range(0, CONFIG_LEN, CHUNK):
        size = min(CHUNK, CONFIG_LEN - off)
        resp = ctl_read.xfer(fd, ctl_read.build_read_request(off, size), timeout)
        if resp is None:
            return None
        blob += resp[ctl_read.RESP_DATA_OFFSET:ctl_read.RESP_DATA_OFFSET + size]
    return bytes(blob)


def chunks():
    for off in range(0, CONFIG_LEN, CHUNK):
        yield off, min(CHUNK, CONFIG_LEN - off)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", required=True, help="1652-byte blob to write")
    ap.add_argument("--commit", action="store_true", help="actually write (default: dry-run)")
    ap.add_argument("--dev", help="force /dev/hidrawN")
    ap.add_argument("--no-backup", action="store_true", help="skip the pre-write read backup")
    ap.add_argument("--timeout", type=float, default=1.0)
    args = ap.parse_args()

    blob = open(args.infile, "rb").read()
    if len(blob) != CONFIG_LEN:
        sys.exit(f"refusing: {args.infile} is {len(blob)} bytes, expected {CONFIG_LEN}")
    n = len(list(chunks()))
    print(f"source: {args.infile}  ({len(blob)} bytes, {n} chunks of <= {CHUNK})")

    # Always show what the first/last/finalize packets look like.
    first_off, first_size = 0, min(CHUNK, CONFIG_LEN)
    last_off = (n - 1) * CHUNK
    last_size = CONFIG_LEN - last_off
    print("\n>> first WRITE packet (offset 0):")
    print(hexdump(build_write_request(first_off, blob[first_off:first_off + first_size])))
    print(f"\n>> last WRITE packet (offset {last_off}, size {last_size}):")
    print(hexdump(build_write_request(last_off, blob[last_off:last_off + last_size])))
    print("\n>> FINALIZE packet:")
    print(hexdump(build_finalize()))

    if not args.commit:
        print("\n[dry-run] nothing was sent. Re-run with --commit to write.")
        return

    dev = args.dev or ctl_read.find_hidraw()
    if not dev:
        sys.exit("config interface not found (need the dongle at PID 3109, "
                 "controller OFF/idle so it isn't in Xinput gamepad mode).")
    print(f"\ndevice: {dev}")
    fd = os.open(dev, os.O_RDWR)
    try:
        if not args.no_backup:
            cur = read_full(fd, args.timeout)
            if cur is None:
                sys.exit("pre-write backup read failed (timeout) — aborting, nothing written.")
            ts = time.strftime("%Y%m%d-%H%M%S")
            bpath = f"captures/ctl-autobackup-{ts}.bin"
            with open(bpath, "wb") as f:
                f.write(cur)
            nz = sum(1 for x in cur if x)
            print(f"pre-write backup: {bpath} ({nz} non-zero bytes)")
            if nz < 50:
                sys.exit("backup looks empty/IDLE — controller not linked; aborting before write.")

        print("\nwriting...")
        for off, size in chunks():
            os.write(fd, build_write_request(off, blob[off:off + size]))
            ack = expect_chunk_ack(fd, size, off, args.timeout)
            if ack is None:
                sys.exit(f"\n!! no/!bad ack at offset {off} (size {size}) — STOPPED. "
                         f"Restore from backup if needed.")
            print(f"  offset {off:>4} size {size:>2}: ack ok")

        os.write(fd, build_finalize())
        if expect_final_ack(fd, args.timeout) is None:
            sys.exit("!! finalize not acked — config may not be committed.")
        print("finalize: ack ok")

        # verify
        back = read_full(fd, args.timeout)
        if back is None:
            print("(verify read timed out)")
        elif back == blob:
            print("verify: read-back IDENTICAL to written blob ✅")
        else:
            diff = [i for i in range(CONFIG_LEN) if back[i] != blob[i]]
            print(f"verify: differs at {len(diff)} byte(s); first offsets {diff[:8]}")
    finally:
        os.close(fd)


if __name__ == "__main__":
    main()
