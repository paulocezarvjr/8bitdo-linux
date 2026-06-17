// UI for the 8BitDo keyboard configurator: a rendered TKL board you click to
// remap, capturing the target from a real keypress. Uses kbd.js (WebHID).
import { KeyboardDevice, HWKEY, USAGE, USAGE_BY_INT } from './kbd.js';

const $ = (s) => document.querySelector(s);

/* ---------- keyboard layout (87-key TKL, 8BitDo bottom row) ---------- */
const k = (hw, lbl, w = 1, cls = '') => ({ hw, lbl, w, cls });
const sp = (w) => ({ sp: w });

/* cls tags key GROUPS so edition themes can repaint them: mod (modifiers),
   nav (nav cluster + PrtSc row), frow (F1-F12), arrow, esc, ab (B/A keys). */
const LAYOUT = [
  [k('esc', 'Esc', 1, 'esc'), sp(1),
   k('f1', 'F1', 1, 'frow'), k('f2', 'F2', 1, 'frow'), k('f3', 'F3', 1, 'frow'), k('f4', 'F4', 1, 'frow'), sp(0.5),
   k('f5', 'F5', 1, 'frow'), k('f6', 'F6', 1, 'frow'), k('f7', 'F7', 1, 'frow'), k('f8', 'F8', 1, 'frow'), sp(0.5),
   k('f9', 'F9', 1, 'frow'), k('f10', 'F10', 1, 'frow'), k('f11', 'F11', 1, 'frow'), k('f12', 'F12', 1, 'frow'), sp(0.5),
   k('prtsc', 'PrtSc', 1, 'nav'), k('scrlk', 'ScrLk', 1, 'nav'), k('pause', 'Pause', 1, 'nav')],

  [k('grave', '`'), k('1', '1'), k('2', '2'), k('3', '3'), k('4', '4'), k('5', '5'),
   k('6', '6'), k('7', '7'), k('8', '8'), k('9', '9'), k('0', '0'),
   k('minus', '-'), k('equal', '='), k('backspace', 'Backspace', 2, 'mod'), sp(0.5),
   k('insert', 'Ins', 1, 'nav'), k('home', 'Home', 1, 'nav'), k('pageup', 'PgUp', 1, 'nav')],

  [k('tab', 'Tab', 1.5, 'mod'), k('q', 'Q'), k('w', 'W'), k('e', 'E'), k('r', 'R'), k('t', 'T'),
   k('y', 'Y'), k('u', 'U'), k('i', 'I'), k('o', 'O'), k('p', 'P'),
   k('leftbrace', '['), k('rightbrace', ']'), k('backslash', '\\', 1.5), sp(0.5),
   k('delete', 'Del', 1, 'nav'), k('end', 'End', 1, 'nav'), k('pagedown', 'PgDn', 1, 'nav')],

  [k('capslock', 'Caps', 1.75, 'mod'), k('a', 'A'), k('s', 'S'), k('d', 'D'), k('f', 'F'), k('g', 'G'),
   k('h', 'H'), k('j', 'J'), k('k', 'K'), k('l', 'L'),
   k('semicolon', ';'), k('apostrophe', '\''), k('enter', 'Enter', 2.25, 'mod'), sp(3.5)],

  [k('leftshift', 'Shift', 2.25, 'mod'), k('z', 'Z'), k('x', 'X'), k('c', 'C'), k('v', 'V'), k('b', 'B'),
   k('n', 'N'), k('m', 'M'), k('comma', ','), k('dot', '.'), k('slash', '/'),
   k('rightshift', 'Shift', 2.75, 'mod'), sp(1.5), k('up', '↑', 1, 'arrow'), sp(1)],

  [k('leftctrl', 'Ctrl', 1.25, 'mod'), k('leftmeta', 'Win', 1.25, 'mod'), k('leftalt', 'Alt', 1.25, 'mod'),
   k('space', '', 6.25), k('rightalt', 'Alt', 1.25, 'mod'),
   k('rightmeta', 'B', 1.25, 'ab'), k('menu', 'A', 1.25, 'ab'), k('rightctrl', 'Ctrl', 1.25, 'mod'), sp(0.5),
   k('left', '←', 1, 'arrow'), k('down', '↓', 1, 'arrow'), k('right', '→', 1, 'arrow')],
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

/* ---------- edition themes ----------
   Colors live in style.css as body[data-theme="…"] var blocks; this list only
   drives the picker. Adding an edition = one CSS block + one entry here. */
const THEMES = [
  { id: '',     label: 'Default',      sw: ['#efe9da', '#211e2a', '#ff2e3f'] },
  { id: 'n',    label: 'N Edition',    sw: ['#ece7da', '#53525e', '#dd4136'] },
  { id: 'fami', label: 'Fami Edition', sw: ['#f4edde', '#7c2b33', '#312c2a'] },
  { id: 'c64',  label: 'C64 Edition',  sw: ['#41382d', '#6e655a', '#ddd0b2'] },
  { id: 'xbox', label: 'Xbox Edition', sw: ['#5f8424', '#46641c', '#f2b705'] },
];
const THEME_KEY = '8bitdo-kbd-theme';

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
let macroKeys = new Set();  // hwcodes that carry a software macro
let macroRec = null;        // null = not recording; else array of {type,usage,label}

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
  try { macroKeys = new Set(await kbd.getMacroKeys()); } catch { macroKeys = new Set(); }
  paintMappings();
  log(`read: profile=${profile} maps=${maps.length} macros=${macroKeys.size}`);
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
    el.classList.toggle('has-macro', macroKeys.has(code));
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
  updateMacroUI();
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

/* ---------- macros (software / profile layer) ---------- */
/* USAGE encodes a 3-byte keyboard usage (page 0x07 | 16-bit id, big-endian).
   Ordinary keys keep the id in the low byte ('a' = 0x070004), but modifiers
   keep it in the high byte (leftctrl = 0x07e000 => 0xE0). The macro step wants
   the plain HID id (a=0x04, leftctrl=0xE0), so take whichever byte is non-zero. */
function hidUsageId(name) {
  const u = USAGE[name];
  if (u === undefined || (u >> 16) !== 0x07) return null;
  const u16 = u & 0xffff;
  const id = (u16 & 0xff) || (u16 >> 8);
  return id || null;
}

const KBD_USAGE_BY_LOW = (() => {
  const m = {};
  for (const name of Object.keys(USAGE)) {
    const id = hidUsageId(name);
    if (id && !(id in m)) m[id] = name;
  }
  return m;
})();

/* a recordable macro step uses only keyboard-page (0x07) usages */
function eventKbdUsage(code) {
  const name = CODE_TO_NAME[code];
  if (name === undefined) return null;
  const id = hidUsageId(name);
  return id ? { usage: id, name } : null;
}

function stepText(s) {
  if (s.type === 0x0f) return `⏱${s.usage | ((s.hi || 0) << 8)}ms`;
  const nm = KBD_USAGE_BY_LOW[s.usage] || ('0x' + s.usage.toString(16));
  return nm + (s.type === 0x81 ? '↓' : '↑');
}

async function updateMacroUI() {
  const cur = $('#macroCurrent');
  if (!selected) { cur.textContent = ''; return; }
  if (macroRec) return;                       // recording: keep the live view
  const has = macroKeys.has(selected.code);
  $('#macroClear').hidden = !has;
  $('#macroSteps').hidden = true;
  if (!has) { cur.textContent = 'no macro on this key'; return; }
  cur.textContent = 'reading…';
  try {
    const m = await kbd.getMacroSteps(selected.code);
    cur.textContent = (m && m.steps.length)
      ? 'macro: ' + m.steps.map(stepText).join(' ')
      : 'macro set';
  } catch { cur.textContent = 'macro set'; }
}

function startMacroRec() {
  if (!selected) return;
  stopListening();
  macroRec = [];
  $('#macroRec').hidden = true;
  $('#macroSave').hidden = false;
  $('#macroCancel').hidden = false;
  $('#macroClear').hidden = true;
  $('#macroSteps').hidden = false;
  $('#macroCurrent').textContent = 'recording — type a sequence, Esc to cancel';
  renderMacroSteps();
  window.addEventListener('keydown', onMacroKeydown, true);
  window.addEventListener('keyup', onMacroKeyup, true);
}

function endMacroRec() {
  window.removeEventListener('keydown', onMacroKeydown, true);
  window.removeEventListener('keyup', onMacroKeyup, true);
  macroRec = null;
  $('#macroRec').hidden = false;
  $('#macroSave').hidden = true;
  $('#macroCancel').hidden = true;
  $('#macroSteps').hidden = true;
}

function onMacroKeydown(e) {
  if (!macroRec) return;
  e.preventDefault(); e.stopPropagation();
  if (e.code === 'Escape') { endMacroRec(); startListening(); updateMacroUI(); return; }
  if (e.repeat) return;
  const u = eventKbdUsage(e.code);
  if (u) { macroRec.push({ type: 0x81, usage: u.usage }); renderMacroSteps(); }
}
function onMacroKeyup(e) {
  if (!macroRec || e.code === 'Escape') return;
  e.preventDefault(); e.stopPropagation();
  const u = eventKbdUsage(e.code);
  if (u) { macroRec.push({ type: 0x01, usage: u.usage }); renderMacroSteps(); }
}

function renderMacroSteps() {
  $('#macroSteps').textContent = (macroRec && macroRec.length)
    ? macroRec.map(stepText).join(' ') : '(press keys…)';
}

async function saveMacro() {
  if (!selected || !macroRec) return;
  const steps = macroRec.slice();
  if (!steps.length) { endMacroRec(); startListening(); return; }
  const bytes = [];
  for (const s of steps) bytes.push(s.type, s.usage, 0);
  endMacroRec();
  try {
    log(`macro ${selected.hw} (0x${selected.code.toString(16)}): ${steps.length} steps`);
    await kbd.writeMacro(selected.code, bytes, 1);
    await refresh();
    setStatus(`● macro saved to ${selected.hw}`, 'ok');
    closePanel();
  } catch (err) {
    setStatus('● ' + err.message, 'err'); log('macro write failed: ' + err.message);
    startListening();
  }
}

async function clearMacroOnKey() {
  if (!selected) return;
  stopListening();
  try {
    log(`clear macro ${selected.hw}`);
    await kbd.clearMacro(selected.code);
    await refresh();
    setStatus(`● macro cleared on ${selected.hw}`, 'ok');
    closePanel();
  } catch (err) {
    setStatus('● ' + err.message, 'err'); log('clear macro failed: ' + err.message);
    startListening();
  }
}

function closePanel() {
  if (macroRec) endMacroRec();
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

/* ---------- themes ---------- */
function applyTheme(id) {
  if (id) document.body.dataset.theme = id;
  else delete document.body.dataset.theme;
  try { localStorage.setItem(THEME_KEY, id); } catch { /* private mode etc */ }
  document.querySelectorAll('.titem').forEach((b) =>
    b.classList.toggle('active', b.dataset.theme === id));
}

function buildThemeMenu() {
  const menu = $('#themeMenu');
  for (const t of THEMES) {
    const b = document.createElement('button');
    b.className = 'titem';
    b.dataset.theme = t.id;
    b.innerHTML = `<span class="dots">${t.sw.map((c) => `<i style="background:${c}"></i>`).join('')}</span>${t.label}`;
    b.addEventListener('click', () => { applyTheme(t.id); $('#themeMenu').hidden = true; });
    menu.appendChild(b);
  }
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
  buildThemeMenu();
  let saved = '';
  try { saved = localStorage.getItem(THEME_KEY) || ''; } catch { /* private mode etc */ }
  applyTheme(THEMES.some((t) => t.id === saved) ? saved : '');
  $('#themeBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const m = $('#themeMenu');
    m.hidden = !m.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!$('#themeMenu').hidden && !e.target.closest('.themer')) $('#themeMenu').hidden = true;
  });
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
  $('#macroRec').addEventListener('click', startMacroRec);
  $('#macroSave').addEventListener('click', saveMacro);
  $('#macroCancel').addEventListener('click', () => { endMacroRec(); startListening(); updateMacroUI(); });
  $('#macroClear').addEventListener('click', clearMacroOnKey);
  window.addEventListener('keydown', testerFlash, false);
  if (!('hid' in navigator)) setStatus('● no WebHID — use Chrome/Edge', 'err');
});
