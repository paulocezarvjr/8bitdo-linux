#!/usr/bin/env python3
"""Parse an 8BitDo Ultimate/Pro2 controller config blob (1652 bytes).

Faithful port of references/8bitdo-spec/Pro2/config.hexpat. READ-ONLY: it only
decodes a blob (from a file, or read live from the device via ctl_read).

Usage:
  tools/ctl_parse.py                       # parse captures/ctl-config.bin
  tools/ctl_parse.py --in path/to.bin
  tools/ctl_parse.py --dev                 # read live from the controller first
  tools/ctl_parse.py --slot 0              # only show profile slot 0
"""
import argparse
import struct
import sys

CONFIG_LEN = 1652

ENABLE_FLAG = {0: "Disabled", 0x20200000: "Unenabled", 0x20200911: "Enabled"}

# SingleButton enum: Empty=0, the rest are single bits (1 << n).
SINGLE_BUTTON = {
    0: "Empty",
    1 << 0: "Start", 1 << 1: "L3", 1 << 2: "R3", 1 << 3: "Select",
    1 << 4: "X", 1 << 5: "Y", 1 << 6: "Right", 1 << 7: "Left",
    1 << 8: "Down", 1 << 9: "Up", 1 << 10: "L1", 1 << 11: "R1",
    1 << 12: "B", 1 << 13: "A", 1 << 14: "L2", 1 << 15: "R2",
    1 << 16: "Menu", 1 << 17: "Home", 1 << 18: "Bluetooth",
    1 << 22: "Screenshot", 1 << 23: "Turbo", 1 << 24: "TurboAuto",
    1 << 25: "P1", 1 << 26: "P2", 1 << 27: "DynamicSwap",
}

# The 20 physical source buttons, in the order they appear in ButtonMapping.
MAP_SOURCES = [
    "A", "B", "X", "Y", "L", "R", "L2", "R2", "L3", "R3",
    "Select", "Start", "Share", "Home", "Up", "Down", "Left", "Right", "P1", "P2",
]

SPECIAL_BITS = [
    ("LeftStickInvertX", 0), ("LeftStickInvertY", 1),
    ("RightStickInvertX", 2), ("RightStickInvertY", 3),
    ("SwapJoysticks", 4), ("SwapTriggers", 7),
    ("SwapDpadAndLeftStick", 8), ("SwapTriggersAndRightStick", 10),
    ("RumbleHighMotionSensitivity", 11),
]


def flag_name(v):
    return ENABLE_FLAG.get(v, f"0x{v:08x}")


def single_button(v):
    if v in SINGLE_BUTTON:
        return SINGLE_BUTTON[v]
    # value with multiple bits set, or unknown: list the bits we know
    parts = [n for bit, n in SINGLE_BUTTON.items() if bit and (v & bit)]
    return ("+".join(parts) if parts else "?") + f" (0x{v:08x})"


class Reader:
    def __init__(self, blob):
        self.b = blob
        self.o = 0

    def u8(self):
        v = self.b[self.o]; self.o += 1; return v

    def u16(self):
        v = struct.unpack_from("<H", self.b, self.o)[0]; self.o += 2; return v

    def u32(self):
        v = struct.unpack_from("<I", self.b, self.o)[0]; self.o += 4; return v

    def f32(self):
        v = struct.unpack_from("<f", self.b, self.o)[0]; self.o += 4; return v

    def skip(self, n):
        self.o += n

    def utf16(self, count):
        raw = self.b[self.o:self.o + count * 2]; self.o += count * 2
        s = raw.decode("utf-16-le", errors="replace")
        # fields are padded with NUL or 0xFFFF (uninitialized) — both terminate
        for term in ("\x00", "￿"):
            s = s.split(term, 1)[0]
        return s


def parse(blob):
    if len(blob) < CONFIG_LEN:
        raise ValueError(f"blob too short: {len(blob)} < {CONFIG_LEN}")
    r = Reader(blob)
    cfg = {}

    # Header
    cfg["profile_flags"] = [r.u32() for _ in range(3)]
    cfg["field_crc16"] = r.u32()          # spec calls this CRC16; really a struct field (= profile count here)
    cfg["gamepad_mode"] = r.u16()
    cfg["current_slot"] = r.u16()

    # Three profile slots, fields grouped by type (filenames, rumble, ...).
    cfg["filenames"] = [r.utf16(16) for _ in range(3)]

    cfg["rumble"] = [{"flag": r.u32(), "left": r.f32(), "right": r.f32()} for _ in range(3)]

    def analog():
        return {"flag": r.u32(), "left_start": r.u8(), "left_end": r.u8(),
                "right_start": r.u8(), "right_end": r.u8()}
    cfg["joysticks"] = [analog() for _ in range(3)]
    cfg["triggers"] = [analog() for _ in range(3)]

    sf = []
    for _ in range(3):
        flag = r.u32(); bits = r.u32()
        sf.append({"flag": flag, "bits": bits,
                   "on": [n for n, b in SPECIAL_BITS if bits & (1 << b)]})
    cfg["special"] = sf

    bm = []
    for _ in range(3):
        flag = r.u32()
        targets = [r.u32() for _ in range(20)]
        bm.append({"flag": flag, "map": dict(zip(MAP_SOURCES, targets))})
    cfg["buttons"] = bm

    macros = []
    for _ in range(3):
        flag = r.u32(); count = r.u8(); r.skip(3)
        ms = []
        for _ in range(4):
            assigned = r.u32()
            intervals = [r.u16() for _ in range(18)]
            button_sets = [r.u16() for _ in range(18)]
            joy_sets = [r.u8() for _ in range(18)]
            entry_size = r.u8(); r.skip(1)
            ms.append({"assigned": assigned, "entry_size": entry_size,
                       "intervals": intervals, "button_sets": button_sets,
                       "joy_sets": joy_sets})
        macros.append({"flag": flag, "count": count, "macros": ms})
    cfg["macro_sets"] = macros

    cfg["_consumed"] = r.o
    return cfg


def dump(cfg, only_slot=None):
    out = []
    pf = ", ".join(flag_name(f) for f in cfg["profile_flags"])
    out.append("=== Header ===")
    out.append(f"ProfileFlags : [{pf}]")
    out.append(f"field@12     : 0x{cfg['field_crc16']:08x}  (spec labels 'CRC16'; not a checksum)")
    out.append(f"GamepadMode  : 0x{cfg['gamepad_mode']:04x}")
    out.append(f"CurrentSlot  : {cfg['current_slot']}")

    for s in range(3):
        if only_slot is not None and s != only_slot:
            continue
        name = cfg["filenames"][s] or "(unnamed)"
        out.append(f"\n=== Profile slot {s}  '{name}'  ({flag_name(cfg['profile_flags'][s])}) ===")

        ru = cfg["rumble"][s]
        out.append(f"Rumble   : {flag_name(ru['flag'])}  L={ru['left']:.3f} R={ru['right']:.3f}")

        jo = cfg["joysticks"][s]; tr = cfg["triggers"][s]
        out.append(f"Sticks   : {flag_name(jo['flag'])}  L[{jo['left_start']}-{jo['left_end']}] R[{jo['right_start']}-{jo['right_end']}]")
        out.append(f"Triggers : {flag_name(tr['flag'])}  L[{tr['left_start']}-{tr['left_end']}] R[{tr['right_start']}-{tr['right_end']}]")

        sp = cfg["special"][s]
        on = ", ".join(sp["on"]) if sp["on"] else "(none)"
        out.append(f"Special  : {flag_name(sp['flag'])}  bits=0x{sp['bits']:08x}  on=[{on}]")

        bm = cfg["buttons"][s]
        out.append(f"Buttons  : {flag_name(bm['flag'])}")
        remapped = [(src, tgt) for src, tgt in bm["map"].items()
                    if tgt != 0 and single_button(tgt) != src]
        if remapped:
            for src, tgt in remapped:
                out.append(f"           {src:>6} -> {single_button(tgt)}")
        else:
            out.append("           (all default / none remapped)")

        mc = cfg["macro_sets"][s]
        active = [(i, m) for i, m in enumerate(mc["macros"]) if m["assigned"] != 0 or m["entry_size"]]
        out.append(f"Macros   : {flag_name(mc['flag'])}  count={mc['count']}")
        for i, m in active:
            out.append(f"           #{i} on {single_button(m['assigned'])}: {m['entry_size']} steps")

    out.append(f"\n(parsed {cfg['_consumed']} / {CONFIG_LEN} bytes)")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", default="captures/ctl-config.bin")
    ap.add_argument("--dev", action="store_true", help="read live from the controller first")
    ap.add_argument("--slot", type=int, choices=[0, 1, 2], help="only this profile slot")
    args = ap.parse_args()

    if args.dev:
        import ctl_read
        dev = ctl_read.find_hidraw()
        if not dev:
            sys.exit("controller hidraw not found")
        import os
        fd = os.open(dev, os.O_RDWR)
        blob = bytearray()
        try:
            for off in range(0, CONFIG_LEN, ctl_read.CHUNK):
                size = min(ctl_read.CHUNK, CONFIG_LEN - off)
                resp = ctl_read.xfer(fd, ctl_read.build_read_request(off, size))
                if resp is None:
                    sys.exit(f"timeout at offset {off} (controller asleep? wake it)")
                blob += resp[ctl_read.RESP_DATA_OFFSET:ctl_read.RESP_DATA_OFFSET + size]
        finally:
            os.close(fd)
        print(f"read {len(blob)} bytes live from {dev}\n")
    else:
        blob = open(args.infile, "rb").read()

    cfg = parse(blob)
    print(dump(cfg, only_slot=args.slot))


if __name__ == "__main__":
    main()
