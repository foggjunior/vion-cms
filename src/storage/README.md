# Storage boundary

IndexedDB adapter and repositories. UI code calls these interfaces only; nothing here touches the DOM
except image decoding during upload inspection.

- `idb.js` — database open/upgrade (`vion-cms-local`, version 3; 1 → 2 adds the site stores; 2 → 3 adds
  `taxonomyPublished` and `defaults` and gives existing terms a key, order and active flag inside the upgrade
  transaction), `runTransaction` (resolves only on the transaction's `complete` event, requested with strict
  durability), error mapping to actionable `StorageError`s (quota, blocked, closed, aborted…).
- `content-repository.js` — list/get/saveDraft/publish/unpublish/archive/restore/duplicate for destinations,
  accommodations, tours and day trips (kind `dayTrip`). Every mutation re-validates inside its own readwrite
  transaction: stale-version checks, schema and semantic draft rules, term references, publish minimums, route
  uniqueness, planned 308 redirects and published-dependency safeguards.
- `media-repository.js` + `media-validation.js` — local asset library (metadata and original Blobs in separate
  stores), content sniffing, SVG rejection, size limit, decode check, usage-aware deletion.
- `taxonomy-repository.js` — tour taxonomy terms (type/category/standard/tag) with stable IDs, keys, display order
  and active flag: create, update (key locked once published), setActive, move (stale-checked order) and `publish()`
  of the single published taxonomy snapshot. Terms are never deleted. See `docs/TAXONOMIES_AND_DAY_TRIPS.md`.
- `defaults-repository.js` — the day-trip defaults singleton (`day-trip-defaults`), stale-checked; never published and
  never applied to day trips automatically.
- `site-repository.js` — site settings singleton (`site-settings`), team profiles and the team lineup
  (`team-lineup`: display order + visibility). Same envelope/snapshot/stale-version conventions; profile publish
  and lineup publish are independent so reordering never publishes profile drafts. See
  `docs/SITE_SETTINGS_AND_TEAM.md`.
- `backup.js` — versioned JSON data backup (schemasVersion 3: day trips, terms with keys/order/active, the published
  taxonomy and the day-trip defaults, plus site records; no image binaries, stated in the file) and a separate media
  backup (base64 originals, schemasVersion 1). Imports are fully validated, then applied in one transaction.
  schemasVersion 2 and 1 backups are accepted: they keep the current day trips, defaults and the terms/images those
  use (version 1 also keeps the site records), and the merged result is validated before anything is written.
- `workspace.js` — wires the above together, loads `schemas/content.schema.json` and `schemas/site.schema.json`,
  cross-tab change events and the test-only fault injector.

Stores: `records` (envelope: working draft + workflow), `published` (immutable snapshots), `redirects`, `assets`,
`assetBlobs`, `taxonomies`, `meta`, (version 2) `siteRecords` / `sitePublished` for settings, team profiles and
the lineup, and (version 3) `taxonomyPublished` (published taxonomy snapshot) / `defaults` (day-trip defaults).
`CONTEXT_STORES` in `content-repository.js` lists every store `readContext()` reads; media deletion checks usage
inside that scope, so settings, profiles and day trips (drafts and published snapshots) protect their images.
