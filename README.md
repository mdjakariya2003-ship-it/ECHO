# ECHO – Offline-First Synchronization Prototype

ECHO is a small, beginner-friendly **prototype** of an offline-first notes app. Notes live in your browser (IndexedDB), the app reopens offline (Service Worker), and two devices sync by **exporting/importing a JSON file**. Conflicting edits are never silently overwritten.

Plain HTML/CSS/JavaScript. No build step, no server, no API keys, no paid services.

## What works (v0.1)
- Create, edit, delete, search notes (stored in IndexedDB)
- Every note has: unique ID, revision number, timestamp, device ID, SHA-256 hash, version history
- Export all notes + metadata to JSON; import with full validation before anything is changed
- Duplicate and conflict detection; conflicts are kept and shown for you to resolve
- Status bar: online/offline, offline-app readiness, last import, conflict count
- Demo mode: two simulated devices, deterministic
- Automated tests (`npm test`) and browser tests

## What is NOT included
- No automatic sync, no server, no WebRTC (planned later, not implemented)
- **No encryption.** Hashes detect accidental corruption, not a malicious file author. Export files are plain text.
- Not peer-to-peer. Sync = you move a file yourself.

## Run on your computer
Requirements: a modern browser. Node.js 18+ is only needed for tests; Python 3 (or any static server) serves the files.

```bash
git clone https://github.com/YOUR-NAME/echo.git
cd echo
python3 -m http.server 8080      # or: npm run serve
```
Open http://localhost:8080. (Do not open index.html by double-click: Service Worker, IndexedDB and Web Crypto need `http://localhost` or `https://`.)

Run tests: `npm test`

## Test sync with two browser profiles
1. Profile 1 (e.g. Chrome profile "A"): open http://localhost:8080, create a note, click **Export JSON**.
2. Profile 2 (a different Chrome profile, or a Firefox window): open the same address. Different profiles have separate storage, so this acts as a second device with its own device ID.
3. In Profile 2 click **Import JSON**, choose the file. The note appears.
4. Edit the same note in both profiles. Export from profile 2, import in profile 1. A **conflict** appears; choose *Keep this device*, *Keep imported* or *Keep both*.
5. Export from profile 1, import in profile 2: no new conflict, both match.

## Deploy to GitHub Pages
1. Create a public repository on GitHub and push these files (the repo root must contain `index.html`).
2. Repo → **Settings → Pages** → Source: *Deploy from a branch* → Branch `main`, folder `/ (root)` → Save.
3. After about a minute the site is at `https://YOUR-NAME.github.io/REPO-NAME/`. Open it once online; afterwards it reopens offline.
4. When you change cached files, bump `CACHE` in `sw.js` (e.g. `echo-shell-v2`) so users receive the update.

## Files
| File | Purpose |
|---|---|
| `js/core.js` | Data model, hashing, validation, import/export, conflicts (no UI) |
| `js/stores.js` | `IndexedDBStore` (real) and `MemoryStore` (tests/demo) |
| `js/app.js` | UI only |
| `js/demo.js` | Two-device demo |
| `sw.js` | App-shell cache |
| `tests/` | Automated tests |

## Known limitations
- Version history keeps the last 500 ancestors per note; extremely long histories could lose conflict detection accuracy.
- Whole file in memory: limits are 5,000 notes, 10 MB per file.
- Conflicts are per note, not per paragraph (no automatic text merging).
- Deleted notes are kept as tombstones forever (no cleanup).
- Duplicate detection is by note ID/version, not by similar text under different IDs.
- Clocks are only informational; ordering uses version history.
- Service Worker offline behaviour was tested in a normal browser; private windows may disable it.
- Browser storage can be cleared by the user or by the browser under storage pressure. Export backups regularly.

## Future improvements
QR/clipboard transfer, optional passphrase encryption (Web Crypto AES-GCM, only after tested), WebRTC DataChannel with manual signalling (copy/paste offer-answer), tombstone cleanup, text merge view, import preview before applying.

## Novelty: do not claim ECHO is unique
Before making any "first/unique" claim, research and record results for each project below (and others you find):

| Check | Examples to study |
|---|---|
| CRDT / local-first libraries | Automerge, Yjs, Loro |
| Sync engines | PouchDB/CouchDB, RxDB, ElectricSQL, Replicache, Jazz |
| Local-first apps | Obsidian Sync, Logseq, Anytype, Standard Notes |
| P2P transports | WebRTC data channel libs (PeerJS, simple-peer), libp2p, Hypercore/Holepunch, Syncthing |
| Questions to answer for each | Works offline? Needs server? Conflict handling? Encryption? Licence? Last activity? Maintained? |
| Then write | A comparison table with links and dates; claim only the specific, verified difference (e.g. "small, dependency-free teaching prototypeECHO|
Live site: https://mdjakariya2003-ship-it.github.io/ECHO
