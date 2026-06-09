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
    await this._attn();
    let e = await this._send([0xfa, 0x03, 0x0c, 0x00, 0xaa, 0x09, 0x71, hwcode, ...ub]);
    if (!this._okAck(e)) throw new Error('MAP not acknowledged (' + fmt(e) + ')');
    this.log('MAP ack ' + fmt(e));
    e = await this._send([0x76, 0xa5]);
    if (!this._okAck(e)) throw new Error('MAP_DONE not acknowledged (' + fmt(e) + ')');
    this.log('MAP_DONE ack ' + fmt(e));
  }
  async disableKey(hwcode) { return this.mapKey(hwcode, 0x070000); }
  async resetKey(hwName, hwcode) {
    if (USAGE[hwName] === undefined) throw new Error('no default usage for ' + hwName);
    return this.mapKey(hwcode, USAGE[hwName]);
  }
}
