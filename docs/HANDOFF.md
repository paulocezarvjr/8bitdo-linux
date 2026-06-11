# Session Handoff — 2026-06-11

State snapshot for continuing work in a fresh session. Read this together with
`docs/protocol-findings.md` (full protocol details) and `README.md`.

## Project

Linux configurator for 8BitDo gear (official Ultimate Software is Windows/macOS
only). Vision: a WebHID browser app like VIA/NuPhy. Repo is public at
**https://github.com/paulocezarvjr/8bitdo-linux** (branch `main`, all content in
English).

Devices (VID `2dc8`): Retro Mechanical Keyboard 87-key TKL (receiver PID 5201,
wired PID 5200), Ultimate 2.4G controller (dongle PID 3109, wired Xinput 3106,
wired Dinput 3012), Retro R8 mouse (PID 5206).

## What is DONE and hardware-verified

### Keyboard — complete (CLI + WebHID app)
- `tools/kbd_read.py` / `kbd_write.py`: read profile/maps, remap/disable/reset
  over hidraw (wired, power switch OFF, Usage Page `0x008C`, report 0x52 out /
  0x54 in).
- Protocol nuance: MAP ack is `54 e4 <st>` — st=0x08 means SET, st=0x07 means it
  only CLEARED an existing map → **resend MAP until 0x08** (done in both Python
  and JS).
- Remaps live in the software/profile layer — press the **8BitDo-logo key** on
  the board to activate the profile. The ★ star key is a SEPARATE on-board layer
  that can record real macros/combos (Ctrl+C); its protocol is NOT reversed yet
  (likely needs a Windows USB capture).
- `webapp/` — static WebHID app (Chrome/Edge, `python3 -m http.server 8000` in
  `webapp/`, open http://localhost:8000). Rendered TKL board, click a key →
  press the target to assign; media/mouse/disable/reset chips. Lone modifiers
  are assigned on keyup-alone; chords are rejected (one key = one HID usage).

### Controller — read + parse + WRITE all working
- `tools/ctl_read.py` — reads the 1652-byte config blob (canonical copy:
  `captures/ctl-config.bin`, 274 non-zero bytes).
- `tools/ctl_parse.py` — full decode (port of Pro2/config.hexpat): 3 profile
  slots, 20-button remaps, stick/trigger calibration, special-feature bits,
  macros. The header field the spec calls "CRC16" is NOT a checksum (value 3 =
  profile count; no standard CRC matches) → **writes need no checksum**.
- `tools/ctl_write.py` — port of diWritePro2.sh. Defaults to `--dry-run`;
  `--commit` does: auto pre-write backup → 45-byte chunks (cmd 0x04 sub 0x01,
  data at packet byte 19, ack `02 04 04 00 01 00 …`) → finalize (cmd 0x06 sub
  0x15, ack `02 04 04 00 06 00`) → read-back verify. **No-op write verified on
  hardware: 37/37 acks, read-back identical.**

### Connection model (learned the hard way — trust this)
- The config interface (Usage Page `0xFFA0`) exists **ONLY on the 2.4G dongle
  (PID 3109)**, and only exposes real data when the controller is linked but
  **NOT in Xinput gamepad mode**. With the controller in Xinput, the dongle
  re-enumerates as 3106 (gamepad, no config iface). With the controller off,
  dongle = 3109 "IDLE" and reads return all zeros (1 non-zero byte). Validate a
  read has ~274 non-zero bytes before trusting it.
- Wired USB exposes NO config interface at all: Xinput (3106) has no hidraw;
  Dinput (3012) has one hidraw but it's plain gamepad+FF (no vendor page).
  Cable = charge/play only.
- Low battery on cable causes a ~5s connect/disconnect loop (brownout) — looks
  scary, it's just charge. All our tools are read-only except ctl_write.

## Where we stopped

The user chose between next steps; the recommendation was **(A) then (B)**:

- **(A) Real reversible controller edit** — edit the blob (e.g. remap paddle
  P1/P2 or invert a stick axis), `ctl_write.py --commit`, user switches the
  controller to Xinput to feel the change, then restore from backup. Proves
  semantic (not just transport) writes. Needs the mode dance: config via dongle
  3109 state ↔ test via Xinput.
- **(B) Controller in the WebHID app** — the dongle's 0xFFA0 interface should be
  reachable via WebHID like the keyboard. Build read/parse/write in JS + a
  controller UI (profiles, button remaps, calibration, special features).
- Backlog: ★ star/macro protocol (Windows capture), mouse protocol (from
  scratch, Windows capture), profile management UI, GitHub Pages deploy.

## Environment / workflow notes

- `gh` CLI at `~/.local/bin/gh` (not on default PATH), authed as
  **paulocezarvjr** (personal account; the machine's SSH key is the WORK
  account `paulo-cvj` — don't use SSH for this repo). HTTPS push works via the
  gh credential helper. Commit identity for this repo:
  `Paulo Cezar <165974769+paulocezarvjr@users.noreply.github.com>`.
- NEVER add Co-Authored-By/AI trailers to commits (user's global CLAUDE.md).
- All repo content and commits in English; conversation with the user in pt-BR.
- Webapp server: `cd webapp && python3 -m http.server 8000` (background).
- `/dev/hidraw*` is user-accessible via seat ACL (no sudo).
- Transient capture blobs (`captures/ctl-config-2*.bin`, `ctl-backup-*`,
  `ctl-autobackup-*`) are gitignored; the canonical blob stays tracked.
