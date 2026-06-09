// UI wiring for the 8BitDo keyboard configurator.
import { KeyboardDevice, HWKEY, USAGE, USAGE_DESC } from './kbd.js';

const $ = (s) => document.querySelector(s);
let kbd = null;

function log(msg) {
  const el = $('#log');
  const t = new Date().toLocaleTimeString();
  el.textContent += `[${t}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}
function setStatus(text, cls) {
  const s = $('#status');
  s.textContent = text;
  s.className = 'status ' + (cls || '');
}

function populateSelects() {
  const hwSel = $('#hwkey');
  const tgtSel = $('#target');
  const seenCode = new Set();
  Object.entries(HWKEY).sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, code]) => {
    if (seenCode.has(code)) return;
    seenCode.add(code);
    const o = document.createElement('option');
    o.value = name;
    o.textContent = `${name}  (0x${code.toString(16)})`;
    hwSel.appendChild(o);
  });
  const seenU = new Set();
  Object.entries(USAGE).sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, u]) => {
    if (seenU.has(u)) return;
    seenU.add(u);
    const o = document.createElement('option');
    o.value = name;
    o.textContent = `${name} — ${USAGE_DESC[name] || ''}`;
    tgtSel.appendChild(o);
  });
}

async function connect() {
  if (!('hid' in navigator)) {
    setStatus('WebHID not supported — use Chrome/Edge over http://localhost', 'err');
    return;
  }
  try {
    kbd = await KeyboardDevice.request();
    if (!kbd) {
      setStatus('No keyboard config interface selected (cable + power switch OFF).', 'err');
      return;
    }
    kbd.onlog = log;
    await kbd.open();
    setStatus('Connected: ' + kbd.productName, 'ok');
    log('connected to ' + kbd.productName);
    await refresh();
    $('#panel').hidden = false;
  } catch (err) {
    setStatus('Error: ' + err.message, 'err');
    log('error: ' + err.message);
  }
}

async function refresh() {
  if (!kbd) return;
  const { profile, maps } = await kbd.readAll();
  $('#profile').textContent = profile === null ? '(none)' : profile;
  const tb = $('#maps');
  tb.innerHTML = '';
  if (maps.length === 0) {
    tb.innerHTML = '<tr><td colspan="3" class="muted">No remaps — factory default</td></tr>';
  }
  for (const m of maps) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${m.hwName} <span class="muted">0x${m.code.toString(16)}</span></td>` +
      `<td>→ ${m.target}</td>` +
      `<td><button class="reset" data-code="${m.code}" data-name="${m.hwName}">reset</button></td>`;
    tb.appendChild(tr);
  }
  tb.querySelectorAll('button.reset').forEach((b) =>
    b.addEventListener('click', () => resetKey(b.dataset.name, Number(b.dataset.code))));
  log(`read: profile=${profile} maps=${maps.length}`);
}

async function applyMap() {
  if (!kbd) return;
  const hwName = $('#hwkey').value;
  const tgtName = $('#target').value;
  const hwcode = HWKEY[hwName];
  const usageInt = USAGE[tgtName];
  try {
    log(`map ${hwName} (0x${hwcode.toString(16)}) -> ${tgtName}`);
    await kbd.mapKey(hwcode, usageInt);
    await refresh();
    setStatus(`Mapped ${hwName} → ${tgtName}`, 'ok');
  } catch (err) {
    setStatus('Map failed: ' + err.message, 'err');
    log('map failed: ' + err.message);
  }
}

async function disableSel() {
  if (!kbd) return;
  const hwName = $('#hwkey').value;
  try {
    log(`disable ${hwName}`);
    await kbd.disableKey(HWKEY[hwName]);
    await refresh();
    setStatus(`Disabled ${hwName}`, 'ok');
  } catch (err) {
    setStatus('Disable failed: ' + err.message, 'err');
  }
}

async function resetKey(name, code) {
  try {
    log(`reset ${name}`);
    await kbd.resetKey(name, code);
    await refresh();
    setStatus(`Reset ${name}`, 'ok');
  } catch (err) {
    setStatus('Reset failed: ' + err.message, 'err');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  populateSelects();
  $('#connect').addEventListener('click', connect);
  $('#apply').addEventListener('click', applyMap);
  $('#disable').addEventListener('click', disableSel);
  $('#refresh').addEventListener('click', refresh);
  if (!('hid' in navigator)) {
    setStatus('WebHID not supported in this browser. Use Chrome/Edge.', 'err');
  }
});
