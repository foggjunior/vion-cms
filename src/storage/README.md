# Storage boundary

IndexedDB adapter and repositories. UI code calls these interfaces only; nothing here touches the DOM
except image decoding during upload inspection.

- `idb.js` — database open/upgrade (`vion-cms-local`, version 2; the 1 → 2 upgrade only adds the site stores), `runTransaction` (resolves only on the
  transaction's `complete` event, requested with strict durability), error mapping to actionable `StorageError`s
  (quota, blocked, closed, aborted…).
- `content-repository.js` — list/get/saveDraft/publish/unpublish/archive/restore/duplicate for destinations,
  accommodations and tours. Every mutation re-validates inside its own readwrite transaction: stale-version
  checks, schema and semantic draft rules, publish minimums, route uniqueness, planned 308 redirects and
  published-dependency safeguards.
- `media-repository.js` + `media-validation.js` — local asset library (metadata and original Blobs in separate
  stores), content sniffing, SVG rejection, size limit, decode check, usage-aware deletion.
- `taxonomy-repository.js` — prototype tour taxonomy terms with stable IDs; referenced terms cannot be deleted.
- `site-repository.js` — site settings singleton (`site-settings`), team profiles and the team lineup
  (`team-lineup`: display order + visibility). Same envelope/snapshot/stale-version conventions; profile publish
  and lineup publish are independent so reordering never publishes profile drafts. See
  `docs/SITE_SETTINGS_AND_TEAM.md`.
- `backup.js` — versioned JSON data backup (schemasVersion 2, including site records; no image binaries, stated in
  the file) and a separate media backup (base64 originals, schemasVersion 1). Imports are fully validated, then
  applied in one transaction (replace-all). schemasVersion 1 backups are accepted and keep the current site records
  and the images they use.
- `workspace.js` — wires the above together, loads `schemas/content.schema.json` and `schemas/site.schema.json`,
  cross-tab change events and the test-only fault injector.

Stores: `records` (envelope: working draft + workflow), `published` (immutable snapshots), `redirects`, `assets`,
`assetBlobs`, `taxonomies`, `meta`, and (version 2) `siteRecords` / `sitePublished` for settings, team profiles and
the lineup. `CONTEXT_STORES` in `content-repository.js` lists every store `readContext()` reads; media deletion
checks usage inside that scope, so settings and profiles protect their images.
