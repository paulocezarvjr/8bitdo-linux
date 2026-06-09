#!/usr/bin/env python3
"""Generate webapp/keys.js from goncalor's keys.py (single source of truth).

HWKEY:  hardware key name -> scan code
USAGE:  target name -> HID usage int (description kept in USAGE_DESC)
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "references", "8bitdo-kbd-mapper", "src", "eightbdkbd"))
import keys  # type: ignore

OUT = os.path.join(HERE, "..", "webapp", "keys.js")


def main():
    hw = dict(keys.HWKEY)
    usage = {k: v[0] for k, v in keys.USAGE.items()}
    usage_desc = {k: v[1] for k, v in keys.USAGE.items()}
    with open(OUT, "w") as f:
        f.write("// AUTO-GENERATED from references/8bitdo-kbd-mapper keys.py\n")
        f.write("// by tools/gen_keys_js.py. Do not edit by hand.\n")
        f.write("export const HWKEY = " + json.dumps(hw, indent=2) + ";\n\n")
        f.write("export const USAGE = " + json.dumps(usage, indent=2) + ";\n\n")
        f.write("export const USAGE_DESC = " + json.dumps(usage_desc, indent=2) + ";\n")
    print(f"wrote {OUT} ({len(hw)} hw keys, {len(usage)} targets)")


if __name__ == "__main__":
    main()
