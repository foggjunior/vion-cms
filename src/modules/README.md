# Module boundary

Record-specific UI and domain rules for the local content prototype.

- `destinations.js`, `accommodations.js`, `tours.js` — module definitions: editor sections, list columns, sorts.
- `editor-view.js` — shared editor: sticky title/actions, tabs, dirty state, save/publish/unpublish/archive/
  restore/duplicate, field-level errors with focus, stale-write and cross-tab warnings. Built-in Media, SEO and
  Preview sections.
- `list-view.js` — search, status filter, deterministic sorting, row actions (filters kept in the URL).
- `preview.js`, `preview-view.js`, `site-view.js` — escaped renderers for saved drafts and published snapshots,
  and the local preview site (published content only, planned redirects resolved).
- `media-library-view.js`, `tools.js` — media library, tour taxonomies, planned redirects, backup & import.
- `registry.js` — hash routes and which sidebar labels open working modules.
- `shared/` — pure, framework-free rules used by both UI and storage: schema validator (interprets
  `schemas/content.schema.json`), validation, routes/slugs/redirect planning, pricing, record helpers, formatting.
