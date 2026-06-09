#!/usr/bin/env python3
"""Map every /dev/hidraw to its USB device + HID interface and decode the
top-level Usage Page/Usage of its report descriptor.

Goal: identify which HID interface of each 8BitDo device is the
vendor-defined (Usage Page 0xFF00+) one — that's where configuration
feature reports get written. No root required for sysfs reads.
"""
import glob
import os
import re

VENDOR_FILTER = None  # set to e.g. "2dc8" to filter; None = show all


def read(path):
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return None


def read_text(path):
    b = read(path)
    return b.decode(errors="replace") if b is not None else None


def usage_page_name(up):
    names = {
        0x01: "Generic Desktop",
        0x02: "Simulation",
        0x06: "Generic Device",
        0x07: "Keyboard/Keypad",
        0x08: "LED",
        0x09: "Button",
        0x0C: "Consumer",
    }
    if up in names:
        return names[up]
    if up >= 0xFF00:
        return f"VENDOR-DEFINED (0x{up:04X})  <-- likely CONFIG interface"
    return f"0x{up:04X}"


def parse_rdesc(data):
    """Return list of (usage_page, usage) for each top-level collection."""
    i = 0
    cur_up = None
    cur_usage = None
    depth = 0
    tops = []
    while i < len(data):
        b = data[i]
        i += 1
        if b == 0xFE:  # long item
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
        if btype == 1 and btag == 0x0:  # Global: Usage Page
            cur_up = val
        elif btype == 2 and btag == 0x0:  # Local: Usage
            cur_usage = val
        elif btype == 0 and btag == 0xA:  # Main: Collection
            if depth == 0:
                tops.append((cur_up, cur_usage))
            depth += 1
        elif btype == 0 and btag == 0xC:  # Main: End Collection
            depth = max(0, depth - 1)
    return tops


def main():
    rows = []
    for hr in sorted(glob.glob("/sys/class/hidraw/hidraw*")):
        name = os.path.basename(hr)
        devlink = os.path.realpath(os.path.join(hr, "device"))
        uevent = read_text(os.path.join(hr, "device", "uevent")) or ""
        hid_id = hid_name = ""
        for line in uevent.splitlines():
            if line.startswith("HID_ID="):
                hid_id = line.split("=", 1)[1]
            elif line.startswith("HID_NAME="):
                hid_name = line.split("=", 1)[1]
        # HID_ID = BUS:VENDOR:PRODUCT (hex, 8 digits each)
        vid = pid = ""
        m = re.match(r"[0-9A-Fa-f]+:0*([0-9A-Fa-f]{4}):0*([0-9A-Fa-f]{4})", hid_id)
        if m:
            vid, pid = m.group(1).lower(), m.group(2).lower()
        # interface number from path token like ":1.3"
        iface = ""
        mi = re.search(r":\d+\.(\d+)/", devlink + "/")
        if mi:
            iface = mi.group(1)
        rdesc = read(os.path.join(hr, "device", "report_descriptor"))
        tops = parse_rdesc(rdesc) if rdesc else []
        rows.append((vid, pid, name, iface, hid_name, len(rdesc) if rdesc else -1, tops))

    rows.sort(key=lambda r: (r[0] != "2dc8", r[0], r[1], r[3]))
    for vid, pid, name, iface, hid_name, rlen, tops in rows:
        if VENDOR_FILTER and vid != VENDOR_FILTER:
            continue
        tag = " <<< 8BitDo" if vid == "2dc8" else ""
        print(f"\n{name:9s}  {vid}:{pid}  iface={iface or '?'}  rdesc={rlen}B{tag}")
        print(f"           name: {hid_name}")
        if rlen == -1:
            print("           (report_descriptor unreadable without root)")
        for up, usage in tops:
            up_s = usage_page_name(up) if up is not None else "?"
            print(f"           collection: UsagePage={up_s}  Usage=0x{(usage or 0):04X}")


if __name__ == "__main__":
    main()
