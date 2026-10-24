// UI layer only. All data logic lives in core.js / stores.js.
// Security: user and imported text is only ever written with textContent (never innerHTML).
import { Engine, EchoError } from './core.js';
import { IndexedDBStore } from './stores.js';
import { runDemo } from './demo.js';

const $ = (id) => document.getElementById(id);
let deviceId;
try {
  deviceId = localStorage.getItem('echo.deviceId');
  if (!deviceId) { deviceId = 'dev-' + crypto.randomUUID().slice(0, 8); localStorage.setItem('echo.deviceId', deviceId); }
} catch { deviceId = 'dev-' + Math.random().toString(36).slice(2, 10); }

let engine;
let editingId = null;
let swState = 'checking…';

function el(tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
function say(text, kind = 'ok') { const m = $('msg'); m.hidden = false; m.className = 'msg ' + kind; m.textContent = text; }
function fail(err) { say(err instanceof EchoError ? err.message : 'Something went wrong: ' + (err && err.message ? err.message : err), 'error'); }
const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : 'never');

async function renderStatus() {
  const s = await engine.status();
  const items = [
    navigator.onLine ? 'Network: online' : 'Network: offline',
    'Offline app: ' + swState,
    'Device: ' + s.deviceId,
    'Last import: ' + fmt(s.lastImportAt),
    'Conflicts: ' + s.conflictCount,
  ];
  if (s.lastImportSummary) {
    const x = s.lastImportSummary;
    items.push(`Last import result: +${x.added} new, ${x.updated} updated, ${x.duplicates} duplicate, ${x.conflicts} conflict`);
  }
  const ul = $('status'); ul.replaceChildren(...items.map((t) => el('li', t)));
}

async function renderList() {
  const notes = await engine.list($('search').value);
  const ul = $('list');
  if (!notes.length) { ul.replaceChildren(el('li', 'No notes yet.')); return; }
  ul.replaceChildren(...notes.map((n) => {
    const li = el('li');
    li.append(el('h3', n.title), el('pre', n.body), el('p', `rev ${n.rev} · ${fmt(n.updatedAt)} · device ${n.deviceId}`, 'meta'));
    const row = el('div', null, 'row');
    const e = el('button', 'Edit', 'secondary'); e.type = 'button'; e.setAttribute('aria-label', 'Edit ' + n.title);
    e.onclick = () => { editingId = n.id; $('title').value = n.title; $('body').value = n.body; $('cancel').hidden = false; $('save').textContent = 'Update note'; $('title').focus(); };
    const d = el('button', 'Delete', 'danger'); d.type = 'button'; d.setAttribute('aria-label', 'Delete ' + n.title);
    d.onclick = async () => { if (!confirm('Delete this note?')) return; try { await engine.remove(n.id); say('Note deleted.'); await refresh(); } catch (err) { fail(err); } };
    row.append(e, d); li.append(row); return li;
  }));
}

async function renderConflicts() {
  const list = await engine.getConflicts();
  $('conflicts-section').hidden = !list.length;
  $('conflicts').replaceChildren(...(await Promise.all(list.map(async (c) => {
    const local = await engine.store.getNote(c.noteId);
    const li = el('li');
    const show = (label, n) => { const d = el('div'); d.append(el('h3', `${label}: ${n.deleted ? '(deleted)' : n.title}`), el('pre', n.deleted ? '' : n.body), el('p', `rev ${n.rev} · ${fmt(n.updatedAt)} · device ${n.deviceId}`, 'meta')); return d; };
    li.append(show('This device', local), show('Imported', c.remote));
    const row = el('div', null, 'row');
    for (const [choice, label] of [['local', 'Keep this device'], ['remote', 'Keep imported'], ['both', 'Keep both']]) {
      const b = el('button', label, choice === 'both' ? '' : 'secondary'); b.type = 'button';
      b.onclick = async () => { try { await engine.resolve(c.id, choice); say('Conflict resolved.'); await refresh(); } catch (err) { fail(err); } };
      row.append(b);
    }
    li.append(row); return li;
  }))));
}

async function refresh() { await Promise.all([renderList(), renderConflicts(), renderStatus()]); }

function resetForm() { editingId = null; $('title').value = ''; $('body').value = ''; $('cancel').hidden = true; $('save').textContent = 'Save note'; }

$('save').onclick = async () => {
  try {
    if (editingId) await engine.update(editingId, $('title').value, $('body').value);
    else await engine.create($('title').value, $('body').value);
    resetForm(); say('Saved on this device.'); await refresh();
  } catch (err) { fail(err); }
};
$('cancel').onclick = resetForm;
$('search').oninput = () => renderList().catch(fail);

$('export').onclick = async () => {
  try {
    const blob = new Blob([await engine.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `echo-${deviceId}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    say('Export created. The file is not encrypted.'); await renderStatus();
  } catch (err) { fail(err); }
};

$('import').onchange = async (ev) => {
  const file = ev.target.files[0]; ev.target.value = '';
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new EchoError('Import rejected: file is too large (max 10 MB).');
    const s = await engine.importJSON(await file.text());
    say(`Import finished: ${s.added} new, ${s.updated} updated, ${s.duplicates} duplicate, ${s.keptLocal} older (ignored), ${s.conflicts} conflict(s).`, s.conflicts ? 'error' : 'ok');
    await refresh();
  } catch (err) { fail(err); }
};

$('demo').onclick = async () => {
  try {
    const log = await runDemo();
    $('demo-out').replaceChildren(...log.map((l) => el('li', `${l.step} — ${l.detail}`, l.ok ? 'pass' : 'fail')));
  } catch (err) { fail(err); }
};

window.addEventListener('online', () => renderStatus());
window.addEventListener('offline', () => renderStatus());

async function init() {
  if (!window.indexedDB || !window.crypto || !crypto.subtle) {
    say('This browser (or this page address) does not support what ECHO needs. Use https:// or http://localhost.', 'error'); return;
  }
  engine = new Engine(new IndexedDBStore(), { deviceId });
  try { await refresh(); } catch (err) { fail(err); }
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); await navigator.serviceWorker.ready; swState = 'ready (works offline)'; }
    catch { swState = 'not available'; }
  } else swState = 'not supported';
  renderStatus();
}
init();
