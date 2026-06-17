// WebHID driver for the 8BitDo Retro Mechanical Keyboard config interface.
// Mirrors tools/kbd_read.py + kbd_write.py, but in the browser.
// Talks to the vendor collection (Usage Page 0x008C) via report 0x52 (out) /
// 0x54 (in). Verified protocol; see docs/protocol-findings.md.
import { HWKEY, USAGE, USAGE_DESC } from './keys.js';

export const VENDOR_ID = 0x2dc8;
export const CONFIG_USAGE_PAGE = 0x008c;
const OUT_REPORT = 0x52;
const IN_REPORTS = [0x54, 0xb1];

export const HW_BY_CODE = Object.fromEntries(
  Object.entries(HWKEY).map(([k, v]) => [v, k]));
export const USAGE_BY_INT = (() => {
  const m = {};
  for (const [k, v] of Object.entries(USAGE)) if (!(v in m)) m[v] = k;
  return m;
})();
export { HWKEY, USAGE, USAGE_DESC };

function usageToBytes(i) {
  let s = i.toString(16);
  if (s.length % 2) s = '0' + s;
  const out = [];
  for (let j = 0; j < s.length; j += 2) out.push(parseInt(s.substr(j, 2), 16));
  return out;
}

function hexData(d) {
  let s = '';
  for (let i = 0; i < d.byteLength; i++) s += d.getUint8(i).toString(16).padStart(2, '0');
  return s;
}
function fmt(e) {
  if (!e) return 'timeout';
  return e.reportId.toString(16).padStart(2, '0') + ':' + hexData(e.data).slice(0, 8);
}

export class KeyboardDevice {
  constructor(device) {
    this.device = device;
    this.onlog = () => {};
    this._q = [];
    this._waiters = [];
    this._listener = (e) => {
      if (!IN_REPORTS.includes(e.reportId)) return;
      const w = this._waiters.shift();
      if (w) { clearTimeout(w.t); w.resolve(e); }
      else this._q.push(e);
    };
  }
  log(...a) { this.onlog(a.join(' ')); }

  static async request() {
    // Filter to the vendor config collection so the picker shows only it.
    const devs = await navigator.hid.requestDevice({
      filters: [{ vendorId: VENDOR_ID, usagePage: CONFIG_USAGE_PAGE }],
    });
    return KeyboardDevice.pick(devs);
  }
  static async fromGranted() {
    const devs = await navigator.hid.getDevices();
    return KeyboardDevice.pick(devs.filter((d) => d.vendorId === VENDOR_ID));
  }
  static pick(devs) {
    for (const d of devs) {
      if (d.collections?.some((c) => c.usagePage === CONFIG_USAGE_PAGE)) return new KeyboardDevice(d);
    }
    return null;
  }

  get productName() { return this.device.productName || 'keyboard'; }
  async open() {
    if (!this.device.opened) await this.device.open();
    this.device.addEventListener('inputreport', this._listener);
  }
  async close() {
    this.device.removeEventListener('inputreport', this._listener);
    if (this.device.opened) await this.device.close();
  }

  _drain() { this._q = []; }
  _take(timeout = 1000) {
    if (this._q.length) return Promise.resolve(this._q.shift());
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this._waiters = this._waiters.filter((x) => x.resolve !== resolve);
        resolve(null);
      }, timeout);
      this._waiters.push({ resolve, t });
    });
  }
  async _send(payload, timeout = 1000) {
    const data = new Uint8Array(32);
    data.set(payload.slice(0, 32));
    await this.device.sendReport(OUT_REPORT, data);
    return this._take(timeout);
  }
  async _attn() { await this._send([0x76, 0xff]); }
  _okAck(e) { return e && e.reportId === 0x54 && e.data.getUint8(0) === 0xe4; }

  async getProfileName() {
    await this._attn();
    const e = await this._send([0x80]);
    if (!e) return '(no response)';
    const d = e.data;
    if (d.getUint8(0) !== 0x80) return '(unexpected ' + hexData(d).slice(0, 8) + ')';
    if (d.getUint8(1) === 0x00) return null; // no profile
    const bytes = [];
    for (let i = 3; i < d.byteLength; i++) bytes.push(d.getUint8(i));
    while (bytes.length && bytes[bytes.length - 1] === 0) bytes.pop();
    let s = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return s;
  }

  async getMappedCodes() {
    await this._attn();
    let e = await this._send([0x81]);
    if (!e || e.data.getUint8(0) !== 0x81) return [];
    const collect = (d) => {
      const a = [];
      for (let i = 1; i < d.byteLength - 1; i++) a.push(d.getUint8(i));
      return a;
    };
    let bytes = collect(e.data);
    let last = e.data.getUint8(e.data.byteLength - 1);
    while (last === 0x01) {
      e = await this._take();
      if (!e || e.data.getUint8(0) !== 0x81) break;
      bytes = bytes.concat(collect(e.data));
      last = e.data.getUint8(e.data.byteLength - 1);
    }
    const codes = [];
    for (let i = 0; i < bytes.length; i++) {
      if (i % 2 === 1) continue;       // 0x07 separator
      const kc = bytes[i];
      if (kc === 0) break;             // terminator
      codes.push(kc);
    }
    return codes;
  }

  async getMapping(code) {
    await this._attn();
    const e = await this._send([0x83, code]);
    if (!e || e.data.getUint8(0) !== 0x83) return null;
    return (e.data.getUint8(2) << 16) | (e.data.getUint8(3) << 8) | e.data.getUint8(4);
  }

  async readAll() {
    this._drain();
    const profile = await this.getProfileName();
    const codes = await this.getMappedCodes();
    const maps = [];
    for (const code of codes) {
      const hid = await this.getMapping(code);
      maps.push({
        code,
        hwName: HW_BY_CODE[code] || ('0x' + code.toString(16)),
        usage: hid,
        target: USAGE_BY_INT[hid] || ('HID 0x' + (hid || 0).toString(16).padStart(6, '0')),
      });
    }
    return { profile, maps };
  }

  async mapKey(hwcode, usageInt) {
    this._drain();
    const ub = usageToBytes(usageInt);
    // An already-mapped key needs MAP sent twice: the 1st clears the old value
    // (ack e4 07), the 2nd sets the new one (ack e4 08). Retry until 08.
    let acked = false;
    let last = null;
    for (let i = 0; i < 4 && !acked; i++) {
      await this._attn();
      const e = await this._send([0xfa, 0x03, 0x0c, 0x00, 0xaa, 0x09, 0x71, hwcode, ...ub]);
      last = e;
      if (!this._okAck(e)) throw new Error('MAP not acknowledged (' + fmt(e) + ')');
      const st = e.data.getUint8(1);
      this.log('MAP ack ' + fmt(e) + (st === 0x08 ? ' (set)' : ' (cleared, retrying)'));
      if (st === 0x08) acked = true;
    }
    if (!acked) throw new Error('MAP did not confirm set (last ' + fmt(last) + ')');
    const e = await this._send([0x76, 0xa5]);
    if (!this._okAck(e)) throw new Error('MAP_DONE not acknowledged (' + fmt(e) + ')');
    this.log('MAP_DONE ack ' + fmt(e));
  }
  async disableKey(hwcode) { return this.mapKey(hwcode, 0x070000); }
  async resetKey(hwName, hwcode) {
    if (USAGE[hwName] === undefined) throw new Error('no default usage for ' + hwName);
    return this.mapKey(hwcode, USAGE[hwName]);
  }

  // ---- software macros (profile layer; protocol reversed from Ultimate
  // Software V2, see docs/protocol-findings.md). Step = 3 bytes:
  // down 81 <usage> 00, up 01 <usage> 00, delay 0F <ms lo> <ms hi>.
  // Reads use NO attention prefix; commands are on report 0x52.
  _macroAck(e) { return e && e.reportId === 0x54 && e.data.getUint8(0) === 0xe4 && e.data.getUint8(1) === 0x08; }

  // keys that currently carry a software macro (52 82 -> 54 82 <key> <attr> … 00)
  async getMacroKeys() {
    this._drain();
    const e = await this._send([0x82]);
    if (!e || e.data.getUint8(0) !== 0x82) return [];
    const keys = [];
    for (let i = 1; i + 1 < e.data.byteLength; i += 2) {
      const k = e.data.getUint8(i);
      if (k === 0) break;
      keys.push(k);
    }
    return keys;
  }

  // steps of the macro on `key` (52 86 <key>). Short macros fit one report.
  async getMacroSteps(key) {
    this._drain();
    const e = await this._send([0x86, key]);
    if (!e || e.data.getUint8(0) !== 0x86) return null;
    const d = e.data;
    const nsteps = d.getUint8(9);
    const raw = [];
    for (let i = 10; i < d.byteLength; i++) raw.push(d.getUint8(i));
    const steps = [];
    for (let i = 0; i + 2 < raw.length && steps.length < nsteps; i += 3) {
      if (raw[i] === 0) break;
      steps.push({ type: raw[i], usage: raw[i + 1], hi: raw[i + 2] });
    }
    return { cycles: d.getUint8(7), nsteps, steps };
  }

  // write `stepBytes` (flat [type,usage,0, …]) as the macro on `key`. Mirrors
  // native writeMacroJP: single packet for <=21 bytes, else 19/18 chunking.
  async writeMacro(key, stepBytes, cycles = 1) {
    this._drain();
    const n = stepBytes.length;
    const numSteps = Math.floor(n / 3);
    if (n <= 21) {
      const p = new Array(32).fill(0);
      p[0] = 0x76; p[1] = key; p[5] = 0x1a; p[6] = 0x01;
      if (cycles === 0xff) p[8] = 0x20; else p[7] = cycles;
      p[9] = numSteps;
      for (let i = 0; i < n; i++) p[10 + i] = stepBytes[i];
      const e = await this._send(p);
      if (!this._macroAck(e)) throw new Error('macro write not acked (' + fmt(e) + ')');
      this.log('macro write ack ' + fmt(e));
      return;
    }
    let off = 0, first = true, last = null;
    while (off < n) {
      const rem = n - off;
      const p = new Array(32).fill(0);
      p[0] = 0x76; p[1] = key; p[2] = 0x01;
      let take;
      if (first) {
        p[5] = 0x19; p[6] = 0x01;
        if (cycles === 0xff) p[8] = 0x20; else p[7] = cycles;
        p[9] = numSteps;
        take = Math.min(20, rem);
        first = false;
      } else {
        const addr = off + 4;
        p[3] = addr & 0xff; p[4] = (addr >> 8) & 0xff;
        take = Math.min(24, rem);
        p[5] = rem > 24 ? 0x18 : rem;
      }
      for (let i = 0; i < take; i++) p[10 + i] = stepBytes[off + i];
      last = await this._send(p);
      off += take;
    }
    if (!this._macroAck(last)) throw new Error('macro write not acked (' + fmt(last) + ')');
    this.log('macro write ack ' + fmt(last));
  }

  // remove the macro on `key` (52 77 <key> <count>)
  async clearMacro(key, count = 200) {
    this._drain();
    const e = await this._send([0x77, key, count & 0xff]);
    if (!this._macroAck(e)) throw new Error('clear macro not acked (' + fmt(e) + ')');
    this.log('clear macro ack ' + fmt(e));
  }
}
