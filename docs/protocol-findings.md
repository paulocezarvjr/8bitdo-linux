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
- **Ack semantics (corrected):** the MAP ack is `54 e4 <st>`. `st = 0x08` means
  the new value was SET; `st = 0x07` means the key already had a mapping and this
  call only CLEARED it. **To remap an already-mapped key you must send MAP again
  until you get `0x08`** (1st call clears, 2nd sets). This is exactly what
  goncalor's "Maybe try again?" was working around (its strict `54 e4 08` check
  fails on the clearing pass). `MAP_DONE` (`52 76 a5`) just finalizes.
- Confirmed end-to-end: `map rightmeta capslock` → re-read shows
  `rightmeta -> capslock` with `menu -> nextsong` preserved.

### Keyboard — two remap layers (profile vs ★ star) — IMPORTANT
The bottom-row **B and A keys ARE the matrix keys `0x6c` and `0x6d`** (the
"rightmeta"/"menu" positions; the 87-key board has no separate right-Win/Menu).
There are TWO independent remap layers:
1. **Software / profile layer** — what our `0x52`/`0x83` protocol reads/writes
   (profile `standard`). These remaps apply only when the profile is engaged via
   the **8BitDo-logo key** (it lights a profile indicator). VERIFIED on hardware:
   our Linux write `0x6c -> capslock` makes the **B key** type Caps Lock once the
   profile is active.
2. **★ star on-board layer** — the keyboard's native `★ -> target -> key` remap,
   a SEPARATE store (a ★-map of `B -> space` did NOT change the software-read
   `0x6c` value). This is what's live in the base / wired-config behavior.

So in wired/switch-OFF config mode the profile layer is dormant (the software
remap doesn't show up when typing); press the 8BitDo key (normal mode) to make it
live. Earlier confusion ("B/A output 7/8", "no key does capslock") was simply the
profile layer being off. The unused report IDs `0x51`/`0xB1`/`0xB2` may still
drive the ★ layer / macros / firmware — not yet reversed.

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
- Write sequence: `0x0001` (write) per chunk → `0x2106` (finish).
- Validate first by doing read → write of the same blob (idempotent) before
  changing anything. **No-op write verified on hardware (37/37 acks).**

### CRC16 — reversed from 8BitDoAdvance.dll (`_ANSI_CRC_16_Ultimate2_4` etc.)
The DLL's `ANSI_CRC_16_*` wrappers all call one shared core (sub at 0x10407130)
that is plain **CRC-16/MODBUS**: init `0xFFFF`, reflected poly `0xA001`
(= 0x8005 reflected), refin/refout true, xorout `0x0000` (confirmed: the
2-entry table at `.data` 0x10c400a8 is `[0x0000, 0xA001]`).

```python
def crc16(data):            # CRC-16/MODBUS
    c = 0xFFFF
    for b in data:
        c ^= b
        for _ in range(8):
            c = (c >> 1) ^ 0xA001 if (c & 1) else c >> 1
    return c
```

The managed code computes it as: zero the record's `crc_value` field, then
`crc_value = crc16(whole record)`. **This belongs to the newer "Advance2"
record** (e.g. `Ultimate2_4Advance2`, ~2324-byte struct). The OLD Pro2-style
blob that `ctl_read/ctl_write` use (1652 B at base 0x0674) has **no** such CRC —
scanning `captures/ctl-config.bin` finds no CRC-16/MODBUS match in any
placement, matching the no-op-write result. So which protocol a given unit
speaks decides whether the CRC is needed; confirm by reading the device.

## Next steps

- [x] Controller: read config via OUT `0x81` / IN `0x02` (read-only). **Done.**
- [ ] Controller: full block parser (port `config.hexpat` to Python).
- [x] Controller: CRC16 reversed — it's **CRC-16/MODBUS** (for the newer
      Advance2 record; the old 1652 B blob has no checksum). See above.
- [x] Keyboard: read profile + mappings over hidraw (read-only). **Done.**
- [x] Keyboard: write/remap on Linux, **verified on hardware** (B/`0x6c` ->
      capslock types Caps Lock with the profile engaged via the 8BitDo key).
- [x] **WebHID web app** (`webapp/`): keyboard read + remap, **verified
      in-browser** (Chrome). The NuPhy/VIA-style configurator, on Linux.
- [ ] Keyboard (optional): reverse the ★ star layer + the unused
      `0x51`/`0xB1`/`0xB2` channel (macros/firmware); a Windows capture would
      make that safe.
- [ ] Mouse: identify which interface (hidraw3 vs hidraw4) the software uses;
      likely requires a Windows capture (USBPcap/API Monitor).

## Keyboard MACRO protocol — reversed from Ultimate Software V2 (no capture needed)

Reversed by **static analysis of the official app** instead of a USB capture:
download `8BitDo_Ultimate_Software_V2_Windows_V*.zip`, extract the .NET
single-file bundle (the app DLL is stored uncompressed), and decompile
`8BitDo Ultimate Software V2.dll` (managed, ILSpy) + disassemble
`8BitDoAdvance.dll` (native, `objdump`). In the code the **Retro Mechanical
Keyboard is the "JP" device** (`VIDPID.PID_JP = 0x5200`, `PID_JPUSB = 0x5201`;
the Retro 108 = `108JP` 0x5209; the R8 mouse = `PID_Mouse/RR` 0x5205/0x5206).

### Two independent macro stores (important)
- **★ star / base layer** — where an on-device star-recorded macro lives. Active
  when the software profile is OFF. **Not exposed** by `GetMacro` (read back
  empty even with a live star macro), and the official app does not touch it.
- **Software / profile layer** — what Ultimate Software V2 reads/writes (and what
  we can fully control). Active when the profile is engaged (the 8BitDo-logo
  key). Up to **8 macro slots**, each bound to a key, with a UTF-16 name.

### Transport
Same vendor interface as the rest (report `0x52` out / `0x54` in, UsagePage
`0x008C`). Native `WriteHidJP(buf,len)` prepends report id `0x52` then `buf`;
`ReadHidJP(buf,33)` reads a `0x54` report. Reads use **no ATTN**, a `Sleep(5ms)`
between write and read, and may span multiple chunks.

### Macro step encoding (3 bytes/step) — from C# `KeyBoardTools.getdata` + `getMacroData`
| step | bytes |
|---|---|
| key **down** | `81 <hid_usage> 00` |
| key **up**   | `01 <hid_usage> 00` |
| **modifier down** (Ctrl/Shift/Alt/Win, usage 0xe0–0xe7) | `83 <hid_usage> 00` |
| **modifier up** | `03 <hid_usage> 00` |
| **delay**    | `0F <ms_lo> <ms_hi>` (u16 LE) |

Modifiers MUST use type `0x83`/`0x03` (not `0x81`/`0x01`) so the firmware sets the
modifier bit instead of emitting a plain keycode the host ignores. A full save
must be wrapped to commit, or the key won't fire the macro:
`SwitchReport(0xff)` = ATTN (`52 76 ff`) → `writeMacroName` (`52 74 …`) →
`writeMacro` steps (`52 76 …`) → `SwitchReport(0xa5)` = finalize (`52 76 a5`,
the same MAP_DONE the remap path uses).

`num_event` (the u16 after the type byte) = the HID usage for down/up, or the ms
for a delay. Steps are concatenated (`getbuffer`), terminated by action `Null`.
e.g. typing `abcd` = `81 04 00 · 01 04 00 · 81 05 00 · 01 05 00 · 81 06 00 ·
01 06 00 · 81 07 00 · 01 07 00`.

### Read (READ-ONLY, verified on device)
- `GetMacro`      → send `52 82`            → resp `54 82 …` = macro list / slots
- `GetMacroName(i)` → send `52 84 <i>`      → resp `54 84 …` = name of slot i
- `GetMacroValue(i)`→ send `52 86 <i>`      → resp `54 86 …` = steps of slot i
  (`i` = slot index 0..7, NOT a key code; bad index acks `54 e4 0a`).

In-memory struct the app parses the read into (`JP_macro_fun_record_t`, 8 of
them): `{ u8 count; u8 cycles_num; u16 interval_ms; u8 key; u8 name[61];
JP_macro_record_t macrorecord[200]; }` where `JP_macro_record_t =
{ u8 reserve; u8 type; u16 num_event; }`.

### Write (decoded from native `_writeMacroJP@20`; round-trip TBD on hardware)
C# recipe (`JPAdvance.writestruct`): per slot →
`writeMacroName(key, nameUtf16, len)` then
`writeMacro(key, stepBytes, stepBytes.Length, interval_ms /*Loop*/, cycles_num /*count*/)`
(EntryPoint `writeMacroJP`); `ClearMacro(key, count)` removes a slot.

`writeMacroJP` builds a `0x76`-family packet (sent via `WriteHidJP`, so wire =
`52 76 …`). For a short macro (`stepBytes.length ≤ 21`, ≤7 steps, one report):
```
52 76 <key> 00 00 00 1a 01 <cycles> 00 <num_steps> <step bytes…>
```
(`pkt[8]=0x20` instead of `pkt[7]=cycles` when cycles==0xff). Longer macros use
multi-chunk: first packet `… 19 01 <cycles> .. <num_steps> <first 20 step bytes>`,
then data chunks `pkt[2]=01, pkt[3..4]=offset+4 (LE), pkt[5]=0x18, <24 bytes>`,
final chunk `pkt[5]=remaining`. Sub-opcodes: `1a`=single, `19`=start, `18`=chunk.
