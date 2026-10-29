# Storage boundary

IndexedDB adapter and repositories. UI code calls these interfaces only; nothing here touches the DOM
except image decoding during upload inspection.

- `idb.js` — database open/upgrade (`vion-cms-local`, version 1), `runTransaction` (resolves only on the
  transaction's `complete` event, requested with strict durability), error mapping to actionable `StorageError`s
  (quota, blocked, closed, aborted…).
- `content-repository.js` — list/get/saveDraft/publish/unpublish/archive/restore/duplicate for destinations,
  accommodations and tours. Every mutation re-validates inside its own readwrite transaction: stale-version
  checks, schema and semantic draft rules, publish minimums, route uniqueness, planned 308 redirects and
  published-dependency safeguards.
- `media-repository.js` + `media-validation.js` — local asset library (metadata and original Blobs in separate
  stores), content sniffing, SVG rejection, size limit, decode check, usage-aware deletion.
- `taxonomy-repository.js` — prototype tour taxonomy terms with stable IDs; referenced terms cannot be deleted.
- `backup.js` — versioned JSON data backup (no image binaries, stated in the file) and a separate media backup
  (base64 originals). Imports are fully validated, then applied in one transaction (replace-all).
- `workspace.js` — wires the above together, loads `schemas/content.schema.json`, cross-tab change events and the
  test-only fault injector.

Stores: `records` (envelope: working draft + workflow), `published` (immutable snapshots), `redirects`, `assets`,
`assetBlobs`, `taxonomies`, `meta`.
