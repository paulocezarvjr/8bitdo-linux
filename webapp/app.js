// UI for the 8BitDo keyboard configurator: a rendered TKL board you click to
// remap, capturing the target from a real keypress. Uses kbd.js (WebHID).
import { KeyboardDevice, HWKEY, USAGE, USAGE_BY_INT } from './kbd.js';

const $ = (s) => document.querySelector(s);

/* ---------- keyboard layout (87-key TKL, 8BitDo bottom row) ---------- */
const k = (hw, lbl, w = 1, cls = '') => ({ hw, lbl, w, cls });
const sp = (w) => ({ sp: w });

const LAYOUT = [
  [k('esc', 'Esc'), sp(1),
   k('f1', 'F1'), k('f2', 'F2'), k('f3', 'F3'), k('f4', 'F4'), sp(0.5),
   k('f5', 'F5'), k('f6', 'F6'), k('f7', 'F7'), k('f8', 'F8'), sp(0.5),
   k('f9', 'F9'), k('f10', 'F10'), k('f11', 'F11'), k('f12', 'F12'), sp(0.5),
   k('prtsc', 'PrtSc'), k('scrlk', 'ScrLk'), k('pause', 'Pause')],

  [k('grave', '`'), k('1', '1'), k('2', '2'), k('3', '3'), k('4', '4'), k('5', '5'),
   k('6', '6'), k('7', '7'), k('8', '8'), k('9', '9'), k('0', '0'),
   k('minus', '-'), k('equal', '='), k('backspace', '⌫', 2), sp(0.5),
   k('insert', 'Ins'), k('home', 'Home'), k('pageup', 'PgUp')],

  [k('tab', 'Tab', 1.5), k('q', 'Q'), k('w', 'W'), k('e', 'E'), k('r', 'R'), k('t', 'T'),
   k('y', 'Y'), k('u', 'U'), k('i', 'I'), k('o', 'O'), k('p', 'P'),
   k('leftbrace', '['), k('rightbrace', ']'), k('backslash', '\\', 1.5), sp(0.5),
   k('delete', 'Del'), k('end', 'End'), k('pagedown', 'PgDn')],

  [k('capslock', 'Caps', 1.75), k('a', 'A'), k('s', 'S'), k('d', 'D'), k('f', 'F'), k('g', 'G'),
   k('h', 'H'), k('j', 'J'), k('k', 'K'), k('l', 'L'),
   k('semicolon', ';'), k('apostrophe', '\''), k('enter', 'Enter', 2.25), sp(3.5)],

  [k('leftshift', 'Shift', 2.25), k('z', 'Z'), k('x', 'X'), k('c', 'C'), k('v', 'V'), k('b', 'B'),
   k('n', 'N'), k('m', 'M'), k('comma', ','), k('dot', '.'), k('slash', '/'),
   k('rightshift', 'Shift', 2.75), sp(1.5), k('up', '↑'), sp(1)],

  [k('leftctrl', 'Ctrl', 1.25), k('leftmeta', 'Win', 1.25), k('leftalt', 'Alt', 1.25),
   k('space', '', 6.25), k('rightalt', 'Alt', 1.25),
   k('rightmeta', 'B', 1.25, 'ab'), k('menu', 'A', 1.25, 'ab'), k('rightctrl', 'Ctrl', 1.25), sp(0.5),
   k('left', '←'), k('down', '↓'), k('right', '→')],
];

/* browser KeyboardEvent.code -> our canonical name (works for HWKEY and USAGE) */
const CODE_TO_NAME = {
  Escape: 'esc', Backquote: 'grave', Minus: 'minus', Equal: 'equal', Backspace: 'backspace',
  Tab: 'tab', BracketLeft: 'leftbrace', BracketRight: 'rightbrace', Backslash: 'backslash',
  CapsLock: 'capslock', Semicolon: 'semicolon', Quote: 'apostrophe', Enter: 'enter',
  ShiftLeft: 'leftshift', Comma: 'comma', Period: 'dot', Slash: 'slash', ShiftRight: 'rightshift',
  ControlLeft: 'leftctrl', MetaLeft: 'leftmeta', AltLeft: 'leftalt', Space: 'space',
  AltRight: 'rightalt', ContextMenu: 'menu', ControlRight: 'rightctrl', MetaRight: 'rightmeta',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Insert: 'insert', Home: 'home', PageUp: 'pageup', Delete: 'delete', End: 'end', PageDown: 'pagedown',
  PrintScreen: 'prtsc', ScrollLock: 'scrlk', Pause: 'pause',
};
for (const c of 'abcdefghijklmnopqrstuvwxyz') CODE_TO_NAME['Key' + c.toUpperCase()] = c;
for (const d of '1234567890') CODE_TO_NAME['Digit' + d] = d;
for (let i = 1; i <= 12; i++) CODE_TO_NAME['F' + i] = 'f' + i;

/* modifier keys fire their own keydown — don't grab them on press, or you can
   never reach the key in a combo. The keyboard remaps one key to ONE usage, so
   chords (Ctrl+C) aren't supported; a lone modifier is assignable on release. */
const MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
]);

const MEDIA = ['previoussong', 'playpause', 'nextsong', 'mute', 'volumedown', 'volumeup'];
const MOUSE = ['btn_left', 'btn_right', 'btn_middle', 'btn_extra', 'btn_side'];
const MEDIA_LBL = { previoussong: '⏮ Prev', playpause: '⏯ Play', nextsong: '⏭ Next', mute: '🔇 Mute', volumedown: '🔉 Vol−', volumeup: '🔊 Vol+' };
const MOUSE_LBL = { btn_left: 'L click', btn_right: 'R click', btn_middle: 'M click', btn_extra: 'Btn 4', btn_side: 'Btn 5' };

/* ---------- state ---------- */
let kbd = null;
let mappings = new Map();   // hwcode -> { usageInt, target }
let selected = null;        // { hw, code, lbl, cls }
let listening = false;
let pendingMod = null;      // code of a lone modifier held while listening

/* ---------- helpers ---------- */
function log(msg) {
  const el = $('#log');
  el.textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}
function setStatus(text, cls = '') { const s = $('#status'); s.textContent = text; s.className = 'pill ' + cls; }
function targetName(usageInt) { return USAGE_BY_INT[usageInt] || ('HID ' + (usageInt || 0).toString(16)); }

/* ---------- connect ---------- */
async function connect() {
  if (!('hid' in navigator)) { setStatus('● no WebHID — use Chrome/Edge', 'err'); return; }
  try {
    kbd = await KeyboardDevice.request();
    if (!kbd) { setStatus('● no keyboard selected', 'err'); return; }
    kbd.onlog = log;
    await kbd.open();
    setStatus('● connected', 'ok');
    log('connected to ' + kbd.productName);
    $('#hero').hidden = true;
    $('#workspace').hidden = false;
    renderBoard();
    await refresh();
  } catch (err) { setStatus('● ' + err.message, 'err'); log('error: ' + err.message); }
}

async function refresh() {
  if (!kbd) return;
  const { profile, maps } = await kbd.readAll();
  $('#profile').textContent = profile === null ? '(none)' : profile;
  mappings = new Map(maps.map((m) => [m.code, { usageInt: m.usage, target: m.target }]));
  paintMappings();
  log(`read: profile=${profile} maps=${maps.length}`);
}

/* ---------- render ---------- */
function renderBoard() {
  const board = $('#board');
  board.innerHTML = '';
  for (const row of LAYOUT) {
    const r = document.createElement('div');
    r.className = 'krow';
    for (const item of row) {
      const div = document.createElement('div');
      if (item.sp) {
        div.className = 'spacer';
        div.style.width = `calc(var(--u) * ${item.sp})`;
      } else {
        div.className = 'key ' + item.cls;
        div.style.width = `calc(var(--u) * ${item.w})`;
        div.dataset.hw = item.hw;
        div.innerHTML = `<span class="legend">${item.lbl}</span><span class="target"></span>`;
        div.addEventListener('click', () => selectKey(item));
      }
      r.appendChild(div);
    }
    board.appendChild(r);
  }
}

function paintMappings() {
  for (const el of document.querySelectorAll('.key')) {
    const code = HWKEY[el.dataset.hw];
    const tEl = el.querySelector('.target');
    if (mappings.has(code)) {
      el.classList.add('mapped');
      tEl.textContent = mappings.get(code).target;
    } else {
      el.classList.remove('mapped');
      tEl.textContent = '';
    }
  }
}

/* ---------- remap flow ---------- */
function selectKey(item) {
  if (!kbd) return;
  selected = { ...item, code: HWKEY[item.hw] };
  document.querySelectorAll('.key.listening').forEach((e) => e.classList.remove('listening'));
  [...document.querySelectorAll('.key')].find((e) => e.dataset.hw === item.hw)?.classList.add('listening');

  const cap = $('#panelCap');
  cap.textContent = item.lbl || item.hw;
  cap.className = 'big-cap ' + (item.cls || '');
  $('#panelName').textContent = item.hw;
  const cur = mappings.get(selected.code);
  $('#panelNow').innerHTML = cur ? `currently → <b>${cur.target}</b>` : 'currently → default';
  $('#listenText').textContent = 'Press any key to assign…';
  $('#panel').hidden = false;
  expandPanel();
}

/* collapse to a slim bar so the board behind stays visible; pause listening so
   keypresses don't assign while the user is just looking at the board. */
function collapsePanel() {
  stopListening();
  $('#panel').classList.add('collapsed');
  $('#panelToggle').setAttribute('aria-label', 'expand panel');
}
function expandPanel() {
  $('#panel').classList.remove('collapsed');
  $('#panelToggle').setAttribute('aria-label', 'minimize panel');
  if (selected && !listening) {
    $('#listenText').textContent = 'Press any key to assign…';
    startListening();
  }
}

function startListening() {
  listening = true; pendingMod = null;
  window.addEventListener('keydown', onKeydown, true);
  window.addEventListener('keyup', onKeyup, true);
}
function stopListening() {
  listening = false; pendingMod = null;
  window.removeEventListener('keydown', onKeydown, true);
  window.removeEventListener('keyup', onKeyup, true);
}

function onKeydown(e) {
  if (!listening) return;
  e.preventDefault(); e.stopPropagation();
  if (e.code === 'Escape') { closePanel(); return; }

  // A modifier on its own: wait — the user may be reaching for a combo, or may
  // want the modifier itself (assigned on keyup). Don't grab it now.
  if (MODIFIER_CODES.has(e.code)) {
    pendingMod = e.code;
    $('#listenText').textContent = 'Tap a modifier alone to assign it, or press a single key…';
    return;
  }

  // A real key while a modifier is held = a combo. One key maps to one usage,
  // so chords like Ctrl+C aren't supported — tell the user instead of guessing.
  if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) {
    pendingMod = null;
    $('#listenText').textContent = 'Combos like Ctrl+C aren’t supported — one key maps to one key. Release modifiers, then press a single key.';
    return;
  }

  pendingMod = null;
  const name = CODE_TO_NAME[e.code];
  if (name && USAGE[name] !== undefined) {
    applyTarget(name);
  } else {
    $('#listenText').textContent = `“${e.code}” isn't mappable — try another key or use the buttons below`;
  }
}

// Lone modifier pressed and released with no other key in between -> assign it.
function onKeyup(e) {
  if (!listening || pendingMod !== e.code) return;
  e.preventDefault(); e.stopPropagation();
  pendingMod = null;
  const name = CODE_TO_NAME[e.code];
  if (name && USAGE[name] !== undefined) applyTarget(name);
}

async function applyTarget(usageName) {
  if (!selected) return;
  const { code, hw } = selected;
  stopListening();
  $('#listenText').textContent = `assigning ${usageName}…`;
  try {
    log(`map ${hw} (0x${code.toString(16)}) -> ${usageName}`);
    await kbd.mapKey(code, USAGE[usageName]);
    await refresh();
    closePanel();
    setStatus(`● ${hw} → ${usageName}`, 'ok');
  } catch (err) {
    setStatus('● ' + err.message, 'err'); log('map failed: ' + err.message);
    $('#listenText').textContent = 'failed: ' + err.message;
    startListening();
  }
}

async function doAction(action) {
  if (!selected) return;
  const { code, hw } = selected;
  stopListening();
  try {
    if (action === 'disable') { log(`disable ${hw}`); await kbd.disableKey(code); }
    else if (action === 'reset') { log(`reset ${hw}`); await kbd.resetKey(hw, code); }
    await refresh();
    closePanel();
    setStatus(`● ${hw} ${action === 'disable' ? 'disabled' : 'reset'}`, 'ok');
  } catch (err) {
    setStatus('● ' + err.message, 'err'); log(action + ' failed: ' + err.message);
    startListening();
  }
}

function closePanel() {
  stopListening();
  $('#panel').hidden = true;
  $('#panel').classList.remove('collapsed');
  document.querySelectorAll('.key.listening').forEach((e) => e.classList.remove('listening'));
  selected = null;
}

/* tester flash: light the matching key on a physical press (when not remapping) */
function testerFlash(e) {
  if (listening) return;
  const name = CODE_TO_NAME[e.code];
  if (!name) return;
  const el = [...document.querySelectorAll('.key')].find((x) => x.dataset.hw === name);
  if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
}

/* ---------- chips ---------- */
function buildChips() {
  const media = $('#mediaChips'); const mouse = $('#mouseChips');
  MEDIA.forEach((u) => media.appendChild(chip(MEDIA_LBL[u], () => applyTarget(u))));
  MOUSE.forEach((u) => mouse.appendChild(chip(MOUSE_LBL[u], () => applyTarget(u))));
}
function chip(label, onClick) {
  const b = document.createElement('button');
  b.className = 'chip'; b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/* ---------- init ---------- */
window.addEventListener('DOMContentLoaded', () => {
  buildChips();
  $('#connect').addEventListener('click', connect);
  $('#connect2').addEventListener('click', connect);
  $('#refresh').addEventListener('click', refresh);
  $('#panelToggle').addEventListener('click', (e) => {
    e.stopPropagation();   // the panel's own click handler would re-expand
    if ($('#panel').classList.contains('collapsed')) expandPanel();
    else collapsePanel();
  });
  $('.panel-inner').addEventListener('click', () => {
    if ($('#panel').classList.contains('collapsed')) expandPanel();
  });
  $('#logToggle').addEventListener('click', () => {
    const l = $('#log'); l.hidden = !l.hidden;
    $('#logToggle').textContent = (l.hidden ? '› ' : '⌄ ') + 'log';
  });
  document.querySelectorAll('.chip[data-action]').forEach((b) =>
    b.addEventListener('click', () => doAction(b.dataset.action)));
  window.addEventListener('keydown', testerFlash, false);
  if (!('hid' in navigator)) setStatus('● no WebHID — use Chrome/Edge', 'err');
});
