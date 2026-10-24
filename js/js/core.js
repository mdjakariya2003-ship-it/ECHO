// ECHO core: data model, hashing, validation, import/export, conflict logic.
// No DOM access here. Storage is injected (see stores.js).

export const FORMAT = 'echo-export';
export const FORMAT_VERSION = 1;
export const LIMITS = {
  fileChars: 10 * 1024 * 1024,
  notes: 5000,
  title: 200,
  body: 100000,
  lineage: 500,
};
const HEX64 = /^[0-9a-f]{64}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export class EchoError extends Error {}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Hash covers content + metadata + parent hash, so it identifies one exact version.
export function noteHash(n) {
  return sha256Hex(JSON.stringify([n.id, n.title, n.body, n.deleted, n.rev, n.deviceId, n.updatedAt, n.parent]));
}

// How do two versions of the same note relate? Uses version history, never clocks.
export function relation(local, remote) {
  if (local.hash === remote.hash) return 'same';
  if (remote.lineage.includes(local.hash)) return 'remote-newer';
  if (local.lineage.includes(remote.hash)) return 'local-newer';
  return 'conflict';
}

export function filterNotes(notes, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return notes;
  return notes.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
}

function checkText(title, body) {
  if (typeof title !== 'string' || typeof body !== 'string') throw new EchoError('Title and body must be text.');
  if (!title.trim()) throw new EchoError('Title cannot be empty.');
  if (title.length > LIMITS.title) throw new EchoError(`Title is too long (max ${LIMITS.title} characters).`);
  if (body.length > LIMITS.body) throw new EchoError(`Body is too long (max ${LIMITS.body} characters).`);
}

function validateNote(n, i) {
  const where = `notes[${i}]`;
  const bad = (m) => { throw new EchoError(`Import rejected: ${where} ${m}. Nothing was imported.`); };
  if (!n || typeof n !== 'object' || Array.isArray(n)) bad('is not an object');
  if (typeof n.id !== 'string' || !ID_RE.test(n.id)) bad('has an invalid id');
  if (typeof n.title !== 'string' || n.title.length > LIMITS.title) bad('has an invalid title');
  if (typeof n.body !== 'string' || n.body.length > LIMITS.body) bad('has an invalid body');
  if (typeof n.deleted !== 'boolean') bad('has an invalid deleted flag');
  if (!Number.isInteger(n.rev) || n.rev < 1 || n.rev > 1e9) bad('has an invalid revision number');
  if (typeof n.deviceId !== 'string' || !ID_RE.test(n.deviceId)) bad('has an invalid deviceId');
  if (typeof n.updatedAt !== 'string' || n.updatedAt.length > 40 || Number.isNaN(Date.parse(n.updatedAt))) bad('has an invalid timestamp');
  if (typeof n.hash !== 'string' || !HEX64.test(n.hash)) bad('has an invalid hash');
  if (n.parent !== null && (typeof n.parent !== 'string' || !HEX64.test(n.parent))) bad('has an invalid parent');
  if (!Array.isArray(n.lineage) || n.lineage.length > LIMITS.lineage || !n.lineage.every((h) => typeof h === 'string' && HEX64.test(h))) bad('has an invalid lineage');
  // copy known fields only; unknown fields are dropped
  return { id: n.id, title: n.title, body: n.body, deleted: n.deleted, rev: n.rev, deviceId: n.deviceId,
    updatedAt: n.updatedAt, parent: n.parent, lineage: [...n.lineage], hash: n.hash };
}

export async function parseAndValidate(text) {
  if (typeof text !== 'string') throw new EchoError('Import rejected: no file content.');
  if (text.length > LIMITS.fileChars) throw new EchoError('Import rejected: file is too large (max 10 MB).');
  let data;
  try { data = JSON.parse(text); }
  catch { throw new EchoError('Import rejected: the file is not valid JSON (it may be corrupted or cut off). Nothing was imported.'); }
  if (!data || typeof data !== 'object' || data.format !== FORMAT) throw new EchoError('Import rejected: this is not an ECHO export file.');
  if (data.formatVersion !== FORMAT_VERSION) throw new EchoError(`Import rejected: unsupported format version ${String(data.formatVersion)}.`);
  if (typeof data.deviceId !== 'string' || !ID_RE.test(data.deviceId)) throw new EchoError('Import rejected: invalid deviceId in file header.');
  if (!Array.isArray(data.notes)) throw new EchoError('Import rejected: "notes" must be a list.');
  if (data.notes.length > LIMITS.notes) throw new EchoError(`Import rejected: too many notes (max ${LIMITS.notes}).`);
  const notes = data.notes.map(validateNote);
  const seen = new Set();
  for (const [i, n] of notes.entries()) {
    if (seen.has(n.id)) throw new EchoError(`Import rejected: duplicate note id inside the file (notes[${i}]). Nothing was imported.`);
    seen.add(n.id);
    if ((await noteHash(n)) !== n.hash) throw new EchoError(`Import rejected: integrity check failed for notes[${i}] (content does not match its hash). Nothing was imported.`);
  }
  return { deviceId: data.deviceId, notes };
}

export class Engine {
  constructor(store, { deviceId, now = () => new Date().toISOString(), newId = () => crypto.randomUUID() }) {
    if (!ID_RE.test(deviceId)) throw new EchoError('Invalid device id.');
    Object.assign(this, { store, deviceId, now, newId });
  }

  async _seal(fields) {
    const n = { ...fields };
    n.hash = await noteHash(n);
    return n;
  }

  async create(title, body = '') {
    checkText(title, body);
    const n = await this._seal({ id: this.newId(), title: title.trim(), body, deleted: false, rev: 1,
      deviceId: this.deviceId, updatedAt: this.now(), parent: null, lineage: [] });
    await this.store.commit({ notes: [n] });
    return n;
  }

  async _next(old, changes) {
    return this._seal({ ...old, ...changes, rev: old.rev + 1, deviceId: this.deviceId, updatedAt: this.now(),
      parent: old.hash, lineage: [...old.lineage, old.hash].slice(-LIMITS.lineage) });
  }

  async update(id, title, body) {
    checkText(title, body);
    const old = await this.store.getNote(id);
    if (!old || old.deleted) throw new EchoError('That note no longer exists.');
    const n = await this._next(old, { title: title.trim(), body });
    await this.store.commit({ notes: [n] });
    return n;
  }

  // Deleting keeps a "tombstone" (deleted: true) so the deletion can sync to other devices.
  async remove(id) {
    const old = await this.store.getNote(id);
    if (!old || old.deleted) throw new EchoError('That note no longer exists.');
    const n = await this._next(old, { deleted: true });
    await this.store.commit({ notes: [n] });
    return n;
  }

  async list(query = '') {
    const all = (await this.store.getAllNotes()).filter((n) => !n.deleted);
    all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    return filterNotes(all, query);
  }

  async exportJSON() {
    const notes = (await this.store.getAllNotes()).sort((a, b) => (a.id < b.id ? -1 : 1));
    const exportedAt = this.now();
    await this.store.commit({ meta: { lastExportAt: exportedAt } });
    return JSON.stringify({ format: FORMAT, formatVersion: FORMAT_VERSION, deviceId: this.deviceId, exportedAt, notes }, null, 2);
  }

  // Validate everything first, plan all changes, then apply them in ONE atomic commit.
  async importJSON(text) {
    const parsed = await parseAndValidate(text);
    const s = { added: 0, updated: 0, duplicates: 0, keptLocal: 0, conflicts: 0 };
    const notes = [];
    const conflicts = [];
    const known = new Set((await this.store.getConflicts()).map((c) => c.id));
    for (const r of parsed.notes) {
      const l = await this.store.getNote(r.id);
      if (!l) { notes.push(r); s.added++; continue; }
      const rel = relation(l, r);
      if (rel === 'same') s.duplicates++;
      else if (rel === 'remote-newer') { notes.push(r); s.updated++; }
      else if (rel === 'local-newer') s.keptLocal++;
      else {
        const cid = `${r.id}:${r.hash}`;
        if (known.has(cid)) s.duplicates++;
        else { known.add(cid); conflicts.push({ id: cid, noteId: r.id, remote: r, detectedAt: this.now() }); s.conflicts++; }
      }
    }
    await this.store.commit({ notes, conflicts, meta: { lastImportAt: this.now(), lastImportSummary: s } });
    return s;
  }

  getConflicts() { return this.store.getConflicts(); }

  // choice: 'local' | 'remote' | 'both'. Nothing is lost: 'both' keeps the other version as a new note.
  async resolve(conflictId, choice) {
    if (!['local', 'remote', 'both'].includes(choice)) throw new EchoError('Unknown choice.');
    const c = (await this.store.getConflicts()).find((x) => x.id === conflictId);
    if (!c) throw new EchoError('That conflict no longer exists.');
    const local = await this.store.getNote(c.noteId);
    const r = c.remote;
    const lineage = [...new Set([...local.lineage, ...r.lineage, local.hash, r.hash])].slice(-LIMITS.lineage);
    const pick = choice === 'remote' ? r : local;
    const merged = await this._seal({ id: local.id, title: pick.title, body: pick.body, deleted: pick.deleted,
      rev: Math.max(local.rev, r.rev) + 1, deviceId: this.deviceId, updatedAt: this.now(), parent: local.hash, lineage });
    const notes = [merged];
    if (choice === 'both' && !r.deleted) {
      const suffix = ' (conflicted copy)';
      notes.push(await this._seal({ id: this.newId(), title: r.title.slice(0, LIMITS.title - suffix.length) + suffix, body: r.body,
        deleted: false, rev: 1, deviceId: this.deviceId, updatedAt: this.now(), parent: null, lineage: [] }));
    }
    await this.store.commit({ notes, removeConflicts: [conflictId] });
    return merged;
  }

  async status() {
    return {
      deviceId: this.deviceId,
      conflictCount: (await this.store.getConflicts()).length,
      lastImportAt: (await this.store.getMeta('lastImportAt')) || null,
      lastImportSummary: (await this.store.getMeta('lastImportSummary')) || null,
      lastExportAt: (await this.store.getMeta('lastExportAt')) || null,
    };
  }
}
