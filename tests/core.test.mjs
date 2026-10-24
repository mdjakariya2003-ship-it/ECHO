import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDevice, runDemo } from '../js/demo.js';
import { Engine } from '../js/core.js';
import { MemoryStore } from '../js/stores.js';

const dev = (id, clock = { t: 0 }) => makeDevice(id, clock);
const view = async (e) => (await e.list()).map((n) => `${n.title}:${n.body}`).sort();

test('local persistence: data survives a new Engine on the same store', async () => {
  const store = new MemoryStore();
  const e1 = new Engine(store, { deviceId: 'd1' });
  const n = await e1.create('Hello', 'World');
  const e2 = new Engine(store, { deviceId: 'd1' });
  assert.deepEqual(await view(e2), ['Hello:World']);
  await e2.update(n.id, 'Hello', 'Changed');
  assert.equal((await e2.list())[0].rev, 2);
  assert.equal((await e2.list('chang')).length, 1);
  assert.equal((await e2.list('nothing')).length, 0);
});

test('export/import round trip keeps ids, revisions and hashes', async () => {
  const c = { t: 0 }; const A = dev('A', c); const B = dev('B', c);
  const n = await A.create('One', 'x'); await A.update(n.id, 'One', 'y'); await A.create('Two', 'z');
  const s = await B.importJSON(await A.exportJSON());
  assert.equal(s.added, 2);
  assert.deepEqual(await view(B), await view(A));
  assert.equal((await B.store.getNote(n.id)).hash, (await A.store.getNote(n.id)).hash);
});

test('duplicate import is detected and changes nothing', async () => {
  const c = { t: 0 }; const A = dev('A', c); const B = dev('B', c);
  await A.create('One', 'x');
  const file = await A.exportJSON();
  await B.importJSON(file);
  const s = await B.importJSON(file);
  assert.deepEqual([s.added, s.updated, s.duplicates, s.conflicts], [0, 0, 1, 0]);
});

test('newer remote versions fast-forward; stale files never overwrite', async () => {
  const c = { t: 0 }; const A = dev('A', c); const B = dev('B', c);
  const n = await A.create('T', 'v1');
  const old = await A.exportJSON();
  await B.importJSON(old);
  await A.update(n.id, 'T', 'v2');
  assert.equal((await B.importJSON(await A.exportJSON())).updated, 1);
  assert.deepEqual(await view(B), ['T:v2']);
  const s = await B.importJSON(old); // stale
  assert.equal(s.keptLocal, 1);
  assert.deepEqual(await view(B), ['T:v2']);
});

test('conflicting edits keep both versions and converge after resolution', async () => {
  const c = { t: 0 }; const A = dev('A', c); const B = dev('B', c);
  const n = await A.create('Plan', 'base');
  await B.importJSON(await A.exportJSON());
  await A.update(n.id, 'Plan', 'from A'); await B.update(n.id, 'Plan', 'from B');
  const s = await A.importJSON(await B.exportJSON());
  assert.equal(s.conflicts, 1);
  assert.deepEqual(await view(A), ['Plan:from A']);            // local untouched
  assert.equal((await A.getConflicts())[0].remote.body, 'from B'); // remote preserved
  assert.equal((await A.importJSON(await B.exportJSON())).conflicts, 0); // not re-added
  assert.equal((await A.getConflicts()).length, 1);
  await A.resolve((await A.getConflicts())[0].id, 'both');
  assert.equal((await A.getConflicts()).length, 0);
  assert.equal((await A.list()).length, 2);
  const s2 = await B.importJSON(await A.exportJSON());
  assert.equal(s2.conflicts, 0);
  assert.deepEqual(await view(B), await view(A));
});

test('resolve with remote / local choices', async () => {
  for (const [choice, expected] of [['remote', 'from B'], ['local', 'from A']]) {
    const c = { t: 0 }; const A = dev('A', c); const B = dev('B', c);
    const n = await A.create('P', 'base'); await B.importJSON(await A.exportJSON());
    await A.update(n.id, 'P', 'from A'); await B.update(n.id, 'P', 'from B');
    await A.importJSON(await B.exportJSON());
    await A.resolve((await A.getConflicts())[0].id, choice);
    assert.equal((await A.list())[0].body, expected);
    assert.equal((await A.list()).length, 1);
  }
});

test('corrupted or malicious files are rejected and local data is untouched', async () => {
  const c = { t: 0 }; const A = dev('A', c); const B = dev('B', c);
  await A.create('One', 'x'); await B.create('Mine', 'm');
  const good = JSON.parse(await A.exportJSON());
  const before = JSON.stringify(await B.store.getAllNotes());
  const mutate = (fn) => { const d = structuredClone(good); fn(d); return JSON.stringify(d); };
  const bad = {
    truncated: (await A.exportJSON()).slice(0, 60),
    notJson: 'hello <script>alert(1)</script>',
    wrongFormat: JSON.stringify({ hello: 1 }),
    wrongVersion: mutate((d) => { d.formatVersion = 99; }),
    notesNotList: mutate((d) => { d.notes = 'x'; }),
    tampered: mutate((d) => { d.notes[0].body = 'evil'; }),
    badRev: mutate((d) => { d.notes[0].rev = -1; }),
    badId: mutate((d) => { d.notes[0].id = '../x'; }),
    hugeTitle: mutate((d) => { d.notes[0].title = 'a'.repeat(5000); }),
    dupIds: mutate((d) => { d.notes.push(structuredClone(d.notes[0])); }),
    tooMany: mutate((d) => { d.notes = Array(5001).fill(d.notes[0]); }),
  };
  for (const [name, text] of Object.entries(bad)) {
    await assert.rejects(() => B.importJSON(text), /Import rejected/, name);
  }
  assert.equal(JSON.stringify(await B.store.getAllNotes()), before);
});

test('deleted records: tombstone, revision bump, sync of deletion, edit-vs-delete conflict', async () => {
  const c = { t: 0 }; const A = dev('A', c); const B = dev('B', c);
  const n = await A.create('Gone', 'x');
  await B.importJSON(await A.exportJSON());
  const t = await A.remove(n.id);
  assert.equal(t.deleted, true); assert.equal(t.rev, 2);
  assert.equal((await A.list()).length, 0);
  assert.equal((await A.store.getAllNotes()).length, 1); // tombstone kept
  await B.importJSON(await A.exportJSON());
  assert.equal((await B.list()).length, 0);
  await assert.rejects(() => B.update(n.id, 'x', 'y'), /no longer exists/);

  const m = await A.create('Contested', '1'); await B.importJSON(await A.exportJSON());
  await A.remove(m.id); await B.update(m.id, 'Contested', 'edited');
  const s = await B.importJSON(await A.exportJSON());
  assert.equal(s.conflicts, 1);
  assert.deepEqual((await view(B)).filter((x) => x.startsWith('Contested')), ['Contested:edited']); // edit not lost
});

test('interrupted synchronization leaves data intact and retry succeeds', async () => {
  const c = { t: 0 }; const A = dev('A', c); const B = dev('B', c);
  await A.create('One', 'x'); await A.create('Two', 'y');
  const file = await A.exportJSON();
  await B.create('Mine', 'm');
  const before = JSON.stringify(await B.store.getAllNotes());
  B.store.failNextCommit = true;
  await assert.rejects(() => B.importJSON(file), /Simulated interruption/);
  assert.equal(JSON.stringify(await B.store.getAllNotes()), before);
  assert.equal((await B.status()).lastImportAt, null);
  const s = await B.importJSON(file);
  assert.equal(s.added, 2);
  assert.equal((await B.list()).length, 3);
});

test('status reports conflict count and last import', async () => {
  const c = { t: 0 }; const A = dev('A', c); const B = dev('B', c);
  const n = await A.create('P', 'b'); await B.importJSON(await A.exportJSON());
  await A.update(n.id, 'P', 'a'); await B.update(n.id, 'P', 'b2');
  await A.importJSON(await B.exportJSON());
  const st = await A.status();
  assert.equal(st.conflictCount, 1); assert.ok(st.lastImportAt);
});

test('demo mode scenario passes every step', async () => {
  const log = await runDemo();
  assert.equal(log.length, 5);
  for (const l of log) assert.ok(l.ok, l.step);
  assert.deepEqual(JSON.stringify(await runDemo()), JSON.stringify(log)); // reproducible
});

test('offline app shell: every file the app needs is listed in sw.js and exists', async () => {
  const { readFile, access } = await import('node:fs/promises');
  const root = new URL('../', import.meta.url);
  const sw = await readFile(new URL('sw.js', root), 'utf8');
  const shell = [...sw.match(/const SHELL = \[(.*?)\];/s)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(shell.length > 0, 'SHELL list not found in sw.js');
  for (const f of shell) if (f !== './') await access(new URL(f, root)); // throws if missing
  const html = await readFile(new URL('index.html', root), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="(\.?\/?[^"#:]+\.(?:js|css))"/g)].map((m) => './' + m[1].replace(/^\.?\//, ''));
  for (const r of refs) assert.ok(shell.includes(r), `${r} is used by index.html but missing from the SHELL cache list`);
  // every static import between app modules must be cached too
  for (const f of shell.filter((s) => s.endsWith('.js'))) {
    const src = await readFile(new URL(f, root), 'utf8');
    for (const m of src.matchAll(/from '(\.[^']+)'/g)) {
      const dir = f.split('/').slice(0, -1).join('/');
      const target = './' + new URL(m[1], 'http://x/' + dir.replace('./', '') + '/').pathname.slice(1);
      assert.ok(shell.includes(target), `${target} (imported by ${f}) is missing from SHELL`);
    }
  }
});
