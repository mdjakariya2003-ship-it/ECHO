# ARCHITECTURE

## Layers
```
UI (app.js, index.html)  ->  Engine (core.js)  ->  Store (stores.js)
                                  |                 IndexedDBStore (browser)
                              hashing/validation    MemoryStore (tests, demo)
```
`core.js` never touches the DOM or IndexedDB directly; it talks to a store with `getNote, getAllNotes, getConflicts, getMeta, commit`. `commit` is atomic (one IndexedDB transaction).

## Note record
`id, title, body, deleted, rev, deviceId, updatedAt, parent, lineage[], hash`
- `hash` = SHA-256 of `[id,title,body,deleted,rev,deviceId,updatedAt,parent]` → identifies one exact version.
- `parent` = hash of the version this edit was made from. `lineage` = hashes of all ancestors (max 500).
- Delete = new revision with `deleted: true` (tombstone), so deletions can sync.

## Data flow
Edit: UI → Engine.update → new version (rev+1, parent=old hash) → store.commit.
Export: all records (including tombstones) → JSON (`format: echo-export`, `formatVersion: 1`).
Import: read file → **validate everything** (size, JSON, types, lengths, counts, duplicate ids, hash integrity) → compare each record with local → build a plan → **one atomic commit**. Any validation failure = nothing changes.

## Conflict resolution
Compare local version L and incoming version R of the same note:
| Situation | Result |
|---|---|
| `L.hash == R.hash` | duplicate, skipped |
| R's lineage contains L.hash | R is newer → fast-forward |
| L's lineage contains R.hash | L is newer → ignored |
| neither | **conflict**: L stays untouched, R is saved in a conflicts list |

Timestamps are NOT used to decide (device clocks are unreliable). The user chooses *keep this device / keep imported / keep both*. Resolution creates a new revision whose lineage contains both sides, so the other device later fast-forwards instead of conflicting again. "Keep both" stores the other text as a new note "(conflicted copy)".

## Security
- Imported text is rendered with `textContent` only; never `innerHTML`, never `eval`.
- Unknown fields in imports are dropped.
- Hash check detects corruption/tampering of a record's content, but an attacker can recompute hashes: this is integrity, not authentication or encryption.
- No network requests for user data; the Service Worker only caches same-origin files.

## Interrupted sync
All changes of one import are applied in a single transaction. If it fails (power loss, error), the database stays in its previous state and the same file can be imported again safely (idempotent).
