// Storage adapters. Both implement the same small interface used by Engine.
// commit() must be ATOMIC: either everything is written or nothing is.

export class MemoryStore {
  constructor() { this.notes = new Map(); this.conflicts = new Map(); this.meta = new Map(); this.failNextCommit = false; }
  async getNote(id) { const n = this.notes.get(id); return n ? structuredClone(n) : undefined; }
  async getAllNotes() { return structuredClone([...this.notes.values()]); }
  async getConflicts() { return structuredClone([...this.conflicts.values()]); }
  async getMeta(k) { return structuredClone(this.meta.get(k)); }
  async commit({ notes = [], conflicts = [], removeConflicts = [], meta = {} }) {
    const N = new Map(this.notes), C = new Map(this.conflicts), M = new Map(this.meta);
    for (const n of notes) N.set(n.id, structuredClone(n));
    for (const c of conflicts) C.set(c.id, structuredClone(c));
    for (const id of removeConflicts) C.delete(id);
    for (const [k, v] of Object.entries(meta)) M.set(k, structuredClone(v));
    if (this.failNextCommit) { this.failNextCommit = false; throw new Error('Simulated interruption before commit'); }
    this.notes = N; this.conflicts = C; this.meta = M;
  }
}

export class IndexedDBStore {
  constructor(name = 'echo-db') { this.name = name; this._p = null; }
  _db() {
    if (!this._p) {
      this._p = new Promise((res, rej) => {
        const r = indexedDB.open(this.name, 1);
        r.onupgradeneeded = () => {
          r.result.createObjectStore('notes', { keyPath: 'id' });
          r.result.createObjectStore('conflicts', { keyPath: 'id' });
          r.result.createObjectStore('meta');
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(new Error('Could not open local database: ' + (r.error && r.error.message)));
        r.onblocked = () => rej(new Error('Local database is blocked by another tab. Close other ECHO tabs.'));
      });
    }
    return this._p;
  }
  async _req(store, fn) {
    const db = await this._db();
    return new Promise((res, rej) => {
      const req = fn(db.transaction(store, 'readonly').objectStore(store));
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  getNote(id) { return this._req('notes', (s) => s.get(id)); }
  getAllNotes() { return this._req('notes', (s) => s.getAll()); }
  getConflicts() { return this._req('conflicts', (s) => s.getAll()); }
  getMeta(k) { return this._req('meta', (s) => s.get(k)); }
  async commit({ notes = [], conflicts = [], removeConflicts = [], meta = {} }) {
    const db = await this._db();
    return new Promise((res, rej) => {
      const tx = db.transaction(['notes', 'conflicts', 'meta'], 'readwrite');
      notes.forEach((n) => tx.objectStore('notes').put(n));
      conflicts.forEach((c) => tx.objectStore('conflicts').put(c));
      removeConflicts.forEach((id) => tx.objectStore('conflicts').delete(id));
      Object.entries(meta).forEach(([k, v]) => tx.objectStore('meta').put(v, k));
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error || new Error('Write failed'));
      tx.onabort = () => rej(tx.error || new Error('Write aborted; no changes were saved'));
    });
  }
}
