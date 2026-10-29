# Module boundary

Record-specific UI and domain rules for the local content prototype.

- `destinations.js`, `accommodations.js`, `tours.js`, `day-trips.js` — module definitions: editor sections, list
  columns, sorts. Day trips (Tour Packages › Activities / day trips, Add Activity) include the explicit “Copy defaults
  into this draft” action.
- `term-fields.js` — managed term selectors (tour type/category/standard, tags) shared by tours and day trips: active
  terms only for new selections, inactive saved selections kept and labelled, unresolved or wrong-group values shown
  explicitly. `pricing-section.js` — the provisional pricing editor shared by tours and day trips.
- `editor-view.js` — shared editor: sticky title/actions, tabs, dirty state, save/publish/unpublish/archive/
  restore/duplicate, field-level errors with focus, stale-write and cross-tab warnings. Built-in Media, SEO and
  Preview sections. Persistence and validation go through an adapter (`CONTENT_ADAPTER` by default; settings and
  team supply their own on `def.adapter`).
- `list-view.js` — search, status filter, deterministic sorting, row actions (filters kept in the URL).
- `preview.js`, `preview-view.js`, `site-view.js` — escaped renderers for saved drafts and published snapshots,
  and the local preview site (published content only, planned redirects resolved).
- `taxonomy-view.js` — Tour Packages › Taxonomies: per-group search, create/edit, keyboard ordering,
  activate/deactivate and “Publish taxonomy changes”.
- `day-trip-defaults-view.js` — the Day-trip defaults editor (default inclusions and what-to-bring items).
- `media-library-view.js`, `tools.js` — media library, planned redirects, backup & import (with a dry run that shows
  what an older backup keeps).
- `settings.js`, `team.js` — Settings › Setting Options (singleton editor) and team profile editor definitions with
  their adapters.
- `team-list-view.js` — team list with search/status filter, draft order (keyboard Move up/down), visibility and
  “Publish order & visibility”.
- `site-preview.js`, `site-preview-view.js` — escaped renderers and previews for settings (company summary, footer,
  SEO metadata), team cards, the team page and profile pages. `site-view.js` also renders the local day-trip listing
  (`#/site/tours/day-trips`, optional `?filter=tag&value=<tag key>`).
- `registry.js` — hash routes and which sidebar labels open working modules.
- `shared/` — pure, framework-free rules used by both UI and storage: schema validator (interprets
  `schemas/content.schema.json` and `schemas/site.schema.json`), validation, routes/slugs/redirect planning (and the
  local route registry), pricing, record helpers, formatting, `site.js`/`site-validation.js` for settings, profiles
  and the lineup, `taxonomy.js` (term normalisation, uniqueness, ordering, legacy upgrade, publication snapshot) and
  `day-trips.js` (duration, schedule, defaults copying, listing order and the tag filter).
