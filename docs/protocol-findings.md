# Protocol findings

Reverse-engineering notes. Update as work progresses.

## Inventory (vendor `2dc8`)

| PID | Name | hidraw (config) |
|---|---|---|
| `5201` | Retro Keyboard Receiver | hidraw5/6/7 |
| `3109` | Ultimate controller dongle ("8BitDo IDLE") | hidraw0 |
| `5206` | Retro R8 Mouse Adapter | hidraw1/2/3/4 |

## Decoded report descriptors

Output of `tools/rdesc_decode.py` (see `captures/rdesc-config-interfaces.txt`).

### Controller `3109` — hidraw0 — Usage Page `0xFFA0`
```
06a0ff0901a1018502150026ff00190129027508953f81028581150026ff00190129027508953f9102c0
Report ID 0x02 : Input  63B (wire 64B)
Report ID 0x81 : Output 63B (wire 64B)
```
**Config channel:** send a command via Output `0x81` (64 B on the wire), read the
response via Input `0x02` (64 B). Same style as the controllers documented in
`references/8bitdo-spec` (Pro2/SN30Pro+ use 64 B packets). The interface is
exposed even while the controller sits "idle" in the dock.

### Mouse `5206` — hidraw3 — Usage Page `0xFF00`
```
0600ff0901a1010902150026ff007508954081020903150026ff00750895409102c0
Report (no ID) : Input 64B, Output 64B
```
Raw 64 B channel (no report ID), Input + Output. Likely the mouse's main
command/response channel.

### Mouse `5206` — hidraw4 — Usage Page `0xFF0B` / `0xFF02`
```
060bff0a0401a101...  (103 B, see captures)
Report 0x14 : Feature 20B
Report 0x2A : Input/Output/Feature 60B
Report 0x2B : Feature 60B
Report 0x2C : Input 16B
Report 0x2D : Input/Output 16B
```
Richer interface (Usage `0xFF0B`/`0x0104`). Candidate for advanced config
(macros, profiles, DPI, RGB). To be investigated.

### Keyboard `5201` — hidraw6 — Usage Page `0x008C`
```
058c0901a10185b1...  (82 B, see captures)
Report 0x51 : Output 32B
Report 0x52 : Output 32B
Report 0x54 : Input  32B
Report 0xB1 : Input  32B
Report 0xB2 : Output 32B
```
**Matches exactly** the protocol documented by `goncalor` (`protocol.txt`):
0xB1 input, 0xB2 output, 0x54 input, 0x51/0x52 output, all 32 B.

## Keyboard protocol (summary of `references/8bitdo-kbd-mapper/protocol.txt`)

- Report IDs: `0xB1`(in), `0xB2`(out), `0x54`(in), `0x51`(out), `0x52`(out), 32 B.
- Map a key: "attention" sequences, then a command with a fixed header +
  hardware key code + device type (`0x07` keyboard, `0x01` mouse) + target key.
- Read mappings: report `0x83`; the response lists mapped hw keys, terminated
  with `0x00`.
- Profiles: load/create/rename/delete; names in UTF-16. The protocol is
  timing-sensitive (delays between messages matter).
- Disabling a key = mapping it to `0x0000`. Only written to the active profile.
- **Important:** the official/goncalor tool configures with the keyboard **over a
  USB cable and the power switch OFF**. The cabled keyboard enumerates as a
  different PID (**`5200`**, vs receiver `5201`); its config interface is the
  `0x008C` one (e.g. `hidraw16`).

### Keyboard — READ WORKING (hidraw) — ✅
`tools/kbd_read.py` reads the active profile + mappings over **hidraw** (no
libusb / no kernel-driver detach — goncalor detaches only because it uses raw
libusb endpoints). Confirmed against the real keyboard:
```
device: /dev/hidraw16
active profile: 'standard'
mapped keys (2):
   rightmeta (0x6c)  ->  previoussong
        menu (0x6d)  ->  nextsong
```
Flow per query: write ATTN (`52 76 ff`) + read(discard) → write query
(`52 80` name / `52 81` mapped list / `52 83 <hwkey>` single mapping) + read
(`54 ..`). Multi-chunk mapped list ends when the last byte != `0x01`.

### Keyboard — WRITE WORKING (hidraw) — ✅
`tools/kbd_write.py` remaps a key on the active profile:
```
write ATTN (52 76 ff)            + read(discard)
write 52 fa 03 0c 00 aa 09 71 | <hwkey> | <usage bytes>   + read -> ack 54 e4 ..
write MAP_DONE (52 76 a5)        + read -> ack 54 e4 ..
```
- `<usage bytes>` = the target's HID usage big-endian, e.g. capslock `07 00 39`,
  esc `07 00 29`, previoussong `0c b6 00`. Disable = `07 00 00`.
- **Gotcha:** the ack is `54 e4 <nn>` where the 3rd byte VARIES (seen `07` and
  `08`). goncalor checks for exactly `54 e4 08`; that is too strict — match the
  `54 e4` prefix instead. If you bail before sending MAP_DONE, the old mapping is
  cleared but the new one is NOT committed (MAP_DONE commits it).
- Confirmed end-to-end: `map rightmeta capslock` → re-read shows
  `rightmeta -> capslock` with `menu -> nextsong` preserved.

### Keyboard — A/B Super Buttons (separate channel, NOT yet reversed)
The big round **A/B Super Buttons** are configured through a different mechanism
than the main matrix. `tools/kbd_scan.py` (read-only sweep of report `0x83` over
hw codes 0x00..0xff) finds ONLY the matrix remaps (`rightmeta`, `menu`); nothing
maps to the buttons' current output (observed: A→`7`, B→`8`). goncalor lists the
external Super Buttons as unsupported.
- Leads: the config interface exposes report IDs `0x51`(out), `0xB1`(in),
  `0xB2`(out) that goncalor never uses (it only uses `0x52`/`0x54`). The firmware
  note in protocol.txt (`b2 aa 55 03 ...`) is a `0xB2` command — so the Super
  Button / macro / firmware features likely live on the `0x51`/`0xB1`/`0xB2`
  channel.
- A default Super Button can't be located via `0x83` (unmapped keys return
  `0x000000`), so reversing this reliably needs a **Windows capture** of the
  official software configuring A/B (diff one button at a time).

## `references/8bitdo-spec` (controllers) — files

```
Pro2/README.md, Pro2/config.hexpat, Pro2/diReadPro2.sh, Pro2/diWritePro2.sh
SN30ProPlus/README.md, SN30ProPlus/diReadSNProPlus.sh
SwitchMode/README.md, SwitchMode/swChangeDinput.sh, swExitDinput.sh, swGetVer.sh
```
`config.hexpat` (an ImHex pattern) describes the Pro2 config blob layout — a great
starting point for the Ultimate. The `.sh` files show real read/write packets.

## Ultimate controller — protocol (Pro2-compatible) — ✅ READ WORKING

Per `references/8bitdo-spec/Pro2/README.md`, analysis of `8BitDoAdvance.dll` shows
that **Pro2, Ultimate2_4, UltimateBT and Ultimate_PC share the same protocol**
(read/write/slot/CRC). Confirmed in practice: our `3109` controller responded to
the Pro2 protocol.

### Request format (port of `diReadPro2.sh`, see `tools/ctl_read.py`)
64 B packet on OUT report `0x81`:
```
[0]  0x81            report id / header
[1]  size + 17       response buffer size
[2]  0x04            operation = config
[3:5] req type LE    0x0002 = READ, 0x0001 = WRITE, 0x2106 = finish write
[5:7] subreq         0x0000
[7]  size            bytes to read (<=45)
[11:13] 0x0674       config block base address (LE)
[15:17] offset LE    offset within the block
rest 0x00
```
64 B response on IN report `0x02`: 18 B header (echoes req type/size/addr) +
`size` data bytes at `response[18:18+size]`. Total block = **1652 B**, read in
45-byte chunks.

### Real dump (factory-default controller) — `captures/ctl-config.bin`
```
Header: ProfileFlag[3] = [Enabled, Enabled, Enabled]   (0x20200911 each — matches the hexpat)
        then CRC16(u32), GamepadMode(u16), CurrentSlot(u16)
rest of the block = 0xff (empty profiles/slots)
```
The full block layout (profiles, dead zones, swaps, per-button remap) is in
`references/8bitdo-spec/Pro2/config.hexpat`.

### Pending for WRITE (careful — destructive)
- Recompute **CRC16** (the function exists in the dll; see spec) before writing.
- Write sequence: `0x0001` (write) per chunk → `0x2106` (finish).
- Validate first by doing read → write of the same blob (idempotent) before
  changing anything.

## Next steps

- [x] Controller: read config via OUT `0x81` / IN `0x02` (read-only). **Done.**
- [ ] Controller: full block parser (port `config.hexpat` to Python).
- [ ] Controller: figure out/implement CRC16 to enable safe writes.
- [x] Keyboard: read profile + mappings over hidraw (read-only). **Done.**
- [x] Keyboard: write/remap on Linux. **Done** (`map rightmeta capslock` applied
      and verified; menu->nextsong preserved).
- [ ] Keyboard: reverse the A/B Super Buttons (likely the `0x51`/`0xB1`/`0xB2`
      channel; needs a Windows capture to do safely).
- [ ] Mouse: identify which interface (hidraw3 vs hidraw4) the software uses;
      likely requires a Windows capture (USBPcap/API Monitor).
