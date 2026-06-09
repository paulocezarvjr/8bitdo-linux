# 8bitdo-linux

Configure the **8BitDo** ecosystem on Linux, since the official *8BitDo Ultimate
Software* only exists for Windows/macOS. End goal: a **WebHID** configurator (in
the spirit of NuPhy Console / VIA) that runs in any Chromium browser with nothing
to install — plus Python command-line tools to prototype and validate the
protocol.

> Interoperability work on hardware I own. The HID protocol is reverse engineered
> from captures of the official software's traffic.

## Devices (USB vendor `2dc8`)

| Device | PID | Receiver/Adapter | Status |
|---|---|---|---|
| Retro Mechanical Keyboard | `5201` | Retro Keyboard Receiver | ✅ read + remap, verified (CLI + WebHID app) |
| Ultimate Wireless Controller | `3109` | "8BitDo IDLE" dongle + dock | 🟢 read working, write pending |
| Retro R8 Mouse | `5206` | Retro R8 Mouse Adapter | 🔴 from scratch |

## Discovered configuration interfaces

Mapped under `/sys/class/hidraw` by `tools/hidmap.py` and decoded by
`tools/rdesc_decode.py`. The vendor-defined interfaces (Usage Page `0xFF..`) are
where configuration traffic flows.

| Device | hidraw | Usage Page | Command channel |
|---|---|---|---|
| Controller `3109` | hidraw0 | `0xFFA0` | OUT `0x81` (64 B) → IN `0x02` (64 B) |
| Mouse `5206` | hidraw3 | `0xFF00` | OUT/IN 64 B (no report ID) |
| Mouse `5206` | hidraw4 | `0xFF0B` | Feature `0x14/0x2A/0x2B` … |
| Keyboard `5201` | hidraw6 | `0x008C` | OUT `0x51/0x52/0xB2` / IN `0x54/0xB1` (32 B) |

Full details and hex dumps in [`docs/protocol-findings.md`](docs/protocol-findings.md).

## Methodology

1. **Inventory / descriptors** on Linux (`tools/`) — done.
2. **Capture** the official software on Windows (USBPcap+Wireshark, or API Monitor
   hooking `HidD_SetFeature`/`HidD_GetFeature`), one action at a time (diffing).
3. **Decode** the packet format (opcode, offsets, checksum).
4. **Replicate** in Python (`hidapi`) and validate against the real device.
5. **WebHID app** once the protocol is mapped.

## Layout

```
tools/        diagnostic/prototype scripts (Python)
webapp/       browser configurator (WebHID) — the NuPhy/VIA-style app
captures/     descriptor dumps and USB captures
docs/         protocol documentation
references/   submodules with existing reverse engineering
```

## References

Submodules under `references/`:

- [`TheJayMann/8bitdo-spec`](https://github.com/TheJayMann/8bitdo-spec) —
  HID config protocol for 8BitDo controllers (Pro2, SN30Pro+, SwitchMode).
- [`goncalor/8bitdo-kbd-mapper`](https://github.com/goncalor/8bitdo-kbd-mapper) —
  Retro Mechanical Keyboard configurator for Linux (+ `protocol.txt`).

Others (not vendored):

- [VIA](https://usevia.app) and [makridi/Nuga](https://github.com/makridi/Nuga) —
  configurator architecture references (WebHID / desktop).

## Running the tools

```sh
python3 tools/hidmap.py                  # map hidraw -> device/interface
python3 tools/rdesc_decode.py hidraw0    # report IDs + sizes for one interface
python3 tools/ctl_read.py                # read-only probe of the controller
python3 tools/ctl_read.py --full --out captures/ctl-config.bin
python3 tools/kbd_read.py                # read keyboard profile + remaps
python3 tools/kbd_write.py map capslock esc   # remap a key
```

## Web app (WebHID)

```sh
cd webapp && python3 -m http.server 8000   # then open http://localhost:8000 in Chrome/Edge
```

See [`webapp/README.md`](webapp/README.md).
