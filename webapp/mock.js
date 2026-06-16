// DEV-ONLY mock — NOT for commit. Lets the configurator reach the workspace
// (rendered board + remap panel) with no real keyboard attached, so the UI can
// be screenshotted. Activate by adding `?mock` to the URL, e.g.
//   http://localhost:8000/?mock
// Optional `?theme=n|fami|c64|xbox` skins the board for the shot.
//
// How it works: ES module imports share one object, so overriding the static
// KeyboardDevice.request() here is seen by app.js's import too. We also stub
// navigator.hid so connect()'s WebHID guard passes (e.g. in headless Chrome),
// and auto-click Connect so the board appears with no interaction.
import { KeyboardDevice, HWKEY, USAGE, USAGE_BY_INT, HW_BY_CODE } from './kbd.js';

const params = new URLSearchParams(location.search);

// A realistic profile + a spread of remaps so highlighting, media, mouse and a
// disabled key are all visible in a screenshot.
const SAMPLE = [
  ['capslock', 'esc'],        // the classic Caps→Esc
  ['rightmeta', 'playpause'], // the 'B' key → media
  ['menu', 'mute'],           // the 'A' key → media
  ['f12', 'volumeup'],
  ['prtsc', 'btn_left'],      // mouse
  ['grave', 'none'],          // disabled
];

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const targetLabel = (usageInt) =>
  USAGE_BY_INT[usageInt] || ('HID 0x' + (usageInt || 0).toString(16).padStart(6, '0'));

// Duck-types the surface app.js uses: onlog, productName, open, readAll, mapKey,
// disableKey, resetKey. Holds mappings in memory so remaps persist across the
// app's refresh() and show up live — good for "after remap" screenshots too.
class MockKeyboardDevice {
  constructor() {
    this.onlog = () => {};
    this.productName = '8BitDo Retro Keyboard (mock)';
    this.profile = 'RETRO';
    this._maps = new Map(); // hwcode -> usageInt
    for (const [hw, u] of SAMPLE) this._maps.set(HWKEY[hw], USAGE[u]);
  }
  log(...a) { this.onlog(a.join(' ')); }
  static async request() { return new MockKeyboardDevice(); }
  static async fromGranted() { return new MockKeyboardDevice(); }
  async open() { this.log('mock: device open (no hardware)'); }
  async close() {}
  async readAll() {
    const maps = [];
    for (const [code, usage] of this._maps) {
      maps.push({
        code,
        hwName: HW_BY_CODE[code] || ('0x' + code.toString(16)),
        usage,
        target: targetLabel(usage),
      });
    }
    return { profile: this.profile, maps };
  }
  async mapKey(code, usageInt) {
    await delay(150); // simulate the device round-trip (shows the "assigning…" state)
    this._maps.set(code, usageInt);
    this.log('mock: map 0x' + code.toString(16) + ' -> ' + targetLabel(usageInt));
  }
  async disableKey(code) { return this.mapKey(code, USAGE.none); }
  async resetKey(hwName, code) {
    await delay(150);
    this._maps.delete(code);
    this.log('mock: reset ' + hwName + ' to default');
  }
}

if (params.has('mock')) {
  // Make connect()'s `('hid' in navigator)` guard pass even without WebHID.
  if (!('hid' in navigator)) {
    try { Object.defineProperty(navigator, 'hid', { value: {}, configurable: true }); } catch { /* ignore */ }
  }

  const theme = params.get('theme');
  const validTheme = theme && ['n', 'fami', 'c64', 'xbox'].includes(theme) ? theme : null;
  if (validTheme) {
    try { localStorage.setItem('8bitdo-kbd-theme', validTheme); } catch { /* private mode */ }
  }

  // Swap in the fake. Same class object app.js imported, so this takes effect.
  KeyboardDevice.request = MockKeyboardDevice.request;
  KeyboardDevice.fromGranted = MockKeyboardDevice.fromGranted;

  // Auto-connect so the board appears with no click (frictionless + headless),
  // and apply the theme directly on <body> so it doesn't depend on whether
  // app.js read localStorage before this module finished loading.
  const autoConnect = () => {
    document.querySelector('#connect2')?.click();
    if (validTheme) document.body.dataset.theme = validTheme;
  };
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => setTimeout(autoConnect, 0));
  } else {
    setTimeout(autoConnect, 0);
  }
  console.info('[mock] in-memory 8BitDo keyboard active (no hardware).');
}
