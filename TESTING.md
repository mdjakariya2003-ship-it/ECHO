# TESTING

## Automated (Node 18+)
`npm test` (or `node --test tests/core.test.mjs`) runs `tests/core.test.mjs` (uses the in-memory store; logic identical to the IndexedDB path).

| Requirement | Test |
|---|---|
| Local persistence | "local persistence…" |
| Export/import round trip | "export/import round trip…" |
| Duplicate imports | "duplicate import…" |
| Conflicting edits | "conflicting edits…", "resolve with remote / local" |
| Corrupted JSON | "corrupted or malicious files…" (11 bad inputs) |
| Deleted records & revisions | "deleted records…" |
| Interrupted synchronization | "interrupted synchronization…" |
| Offline app-shell files | "offline app shell…" (checks sw.js list; real offline reload is manual below) |
| Demo reproducibility | "demo mode scenario…" |

## Browser tests (real IndexedDB + Service Worker)
1. `python3 -m http.server 8080`
2. Open http://localhost:8080 once (this installs the Service Worker).
3. Open http://localhost:8080/tests/browser-tests.html – all lines should be PASS.

## Manual: offline app shell
1. Open the app, wait for status "Offline app: ready".
2. DevTools → Network → "Offline" (or stop the server). Reload.
3. Expected: app loads, notes visible, create/edit works, status shows "offline".

## Manual: two profiles
See README "Test sync with two browser profiles".

## Manual: corrupted file
Open an export in a text editor, delete the last 20 characters, import it. Expected: red message "not valid JSON", notes unchanged. Change a note's text but not its hash: message "integrity check failed".
