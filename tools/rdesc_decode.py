#!/usr/bin/env python3
"""Decode a hidraw report descriptor into Report IDs + byte sizes per type
(Input/Output/Feature). This tells us the exact 'envelope' (report id + length)
to read/write on each config interface. Read-only.

Usage: rdesc_decode.py hidraw0 hidraw3 hidraw4 ...
"""
import sys

TYPE_NAMES = {0x8: "Input", 0x9: "Output", 0xB: "Feature"}


def load(hidraw):
    path = f"/sys/class/hidraw/{hidraw}/device/report_descriptor"
    with open(path, "rb") as f:
        return f.read()


def decode(data):
    i = 0
    report_size = report_count = 0
    report_id = 0
    # per report_id -> {type: total_bits}
    reports = {}
    top_usage_page = None
    while i < len(data):
        b = data[i]
        i += 1
        if b == 0xFE:
            size = data[i] if i < len(data) else 0
            i += 2 + size
            continue
        bsize = b & 0x03
        bsize = 4 if bsize == 3 else bsize
        btype = (b >> 2) & 0x03
        btag = (b >> 4) & 0x0F
        val = 0
        for k in range(bsize):
            if i + k < len(data):
                val |= data[i + k] << (8 * k)
        i += bsize
        if btype == 1:  # Global
            if btag == 0x0:
                if top_usage_page is None:
                    top_usage_page = val
            elif btag == 0x7:
                report_size = val
            elif btag == 0x8:
                report_id = val
            elif btag == 0x9:
                report_count = val
        elif btype == 0:  # Main
            if btag in (0x8, 0x9, 0xB):  # Input/Output/Feature
                bits = report_size * report_count
                reports.setdefault(report_id, {}).setdefault(btag, 0)
                reports[report_id][btag] += bits
    return top_usage_page, reports


def main():
    targets = sys.argv[1:] or ["hidraw0", "hidraw3", "hidraw4"]
    for hidraw in targets:
        try:
            data = load(hidraw)
        except OSError as e:
            print(f"{hidraw}: error reading descriptor ({e})")
            continue
        top_up, reports = decode(data)
        up_s = f"0x{top_up:04X}" if top_up is not None else "?"
        print(f"\n=== {hidraw}  (top Usage Page {up_s}, {len(data)} bytes) ===")
        print("hex:", data.hex())
        if not reports:
            print("  (no report items)")
        for rid in sorted(reports):
            parts = []
            for t, bits in reports[rid].items():
                nbytes = (bits + 7) // 8
                wire = nbytes + (1 if rid != 0 else 0)  # +1 prefix byte if numbered
                parts.append(f"{TYPE_NAMES[t]}={nbytes}B (wire {wire}B)")
            rid_s = f"ID {rid}" if rid != 0 else "no ID"
            print(f"  Report {rid_s}: " + ", ".join(parts))


if __name__ == "__main__":
    main()
