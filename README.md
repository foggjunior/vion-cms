# Vion Africa CMS — local content prototype

Gold dashboard shell plus working **Destinations**, **Accommodations**, **Tours**, **Day trips**, **Tour
taxonomies**, **Site settings** and **Team** modules. Everything runs in the browser with no build step, no dependencies and no backend: records and images
are stored in this browser's IndexedDB, and “publish” makes content visible in a **local preview only**. Nothing is
sent to Firebase, Cloudinary or the live website; there is no real login, booking, payment or email.

Field models, validation and the draft/publish/archive workflow are **proposed** behaviour from
`docs/IMPLEMENTATION_SPEC.md`, `docs/SITE_SETTINGS_AND_TEAM.md` and `docs/TAXONOMIES_AND_DAY_TRIPS.md`, not
confirmed rules of the current CMS.

## Run

From `D:\CMS\vion-cms`:

    python tools/serve.py

Open <http://127.0.0.1:5173>. The CMS uses ES modules, so it must be served over HTTP; opening `index.html`
directly from disk shows a message explaining this. Use a current Chrome, Edge, Firefox or Safari.

`tools/serve.py` (Python standard library only) is `python -m http.server` plus `Cache-Control: no-cache`, so the
browser re-checks every file on each load. With plain `python -m http.server 5173 --bind 127.0.0.1` (still works)
the browser may reuse older cached copies of some files after an update; the modules then fail to load and the
page shows “The CMS scripts did not load” with the underlying error and a **Refresh CMS files and reload** button
(or press Ctrl+F5). Local records and images are not affected.

The first visit after this update upgrades the local database to version 3. The upgrade is additive: it adds two
stores and gives existing taxonomy terms a key, display order and active flag (IDs and labels unchanged); those
terms become the first published taxonomy so the local preview looks the same. Records, snapshots, settings, team
and images are kept. Close other open CMS tabs first (they are asked to reload).

## Use

- Sidebar **Tour Packages › Tours List / Add Tour / Activities / day trips / Add Activity / Taxonomies**,
  **Destinations › …**, **Accommodations › …**, **Settings › Setting Options**, **Settings › Team** and the **Add Tour**
  quick action open the working modules. All other entries are labelled placeholders.
- Only a title (or, for a team profile, a name) is needed to save a draft; site settings can be saved empty.
  **Publish** saves the draft, checks the publication minimum (errors are listed and the first problem is focused)
  and stores a separate published snapshot. Later draft saves do not change the published version until you
  choose **Publish changes**.
- **Setting Options** — one settings record: company, contact, branding (logos, sharing image), social profiles,
  review-platform links and default SEO. Unknown details stay empty. The bundled Vion logo can be chosen
  explicitly for light backgrounds. There are no fields for keys, credentials or other secrets.
- **Team** — profiles with name, position, biography, portrait and optional links. Order and visibility are a
  separate draft: **Move up / Move down** and **Visible** on the Team list (or the profile's *Team page* tab) change
  the draft order; **Publish order & visibility** publishes order and visibility only. Publishing a profile
  publishes its content only. The local team page shows published, visible profiles in the published order.
  After publishing a profile, **Review team visibility** opens the order and visibility panel (nothing else is
  published).
- **Taxonomies** — tour types, categories, standards and tags (nothing pre-filled; definitions await the owner).
  Each term has a stable ID, label, key, display order and active state. Search, add, edit, **Move up / Move down**
  and **Deactivate / Activate**; terms are never deleted. Edits change working terms only; **Publish taxonomy
  changes** publishes labels, keys, order and activation to the local preview without publishing any tour or day
  trip. Inactive terms stay on records that use them (with a warning) but cannot be newly chosen.
- **Day trips** (headings say Day Trips) — title, slug (`/tours/day-trips/{slug}`), summary, overview, several
  destinations, tags, optional duration (hours/days) and schedule, cover and gallery, inclusions, exclusions, what
  to bring, provisional pricing, featured/display order and SEO. **Day-trip defaults** (default inclusions and
  what-to-bring items, empty until you add them) are copied into a draft only with **Copy defaults into this
  draft**, which warns before changing populated lists.
- Each list page links to the local tools: **Local preview site** (published content, day-trip listing with
  `#/site/tours/day-trips?filter=tag&value=<tag key>`, company/contact summary, team grid and footer), **Media
  library**, **Taxonomies**, **Planned redirects** and **Backup & import**.
- Tour and day-trip pricing is either *price on request* (default) or a provisional manual *“from”* price with
  currency, amount, basis and a public explanation. No price matrix, totals or quotes.
- Back up regularly from **Backup & import**: the data backup (JSON, schemasVersion 3) includes day trips,
  defaults, terms and the published taxonomy, settings, team profiles and order but not image files; download the
  separate media backup to keep the images. Imports replace all local content after full validation. Older
  backups still import: schemasVersion 2 keeps the current day trips, defaults and the terms/images they use;
  schemasVersion 1 also keeps the current settings and team. The import dialog lists what is kept.

## Test

- In the browser: open <http://127.0.0.1:5173/tests/> — repository, validation, upgrade and import tests run
  against real IndexedDB using temporary databases (your CMS data is untouched).
- Headless (optional; Playwright is not a project dependency — point `PLAYWRIGHT_MODULE` at an existing
  `playwright` or `playwright-core` install):

      PLAYWRIGHT_MODULE=/path/to/playwright-core node tests/run-headless.mjs
      PLAYWRIGHT_MODULE=/path/to/playwright-core node tests/e2e.mjs

  `BROWSER_CHANNEL=msedge` or `chrome` runs the unit suite in an installed browser. `tests/e2e.mjs` walks the
  acceptance checklist through the real UI in fresh browser profiles and fails on any non-local network request.

Latest results (29 Oct 2026, phase 3): 70/70 unit tests in Chromium, Chrome and Edge; 55/55 end-to-end checks in
Chromium (served by `tools/serve.py`, two consecutive runs). Details, assumptions and limitations:
`docs/IMPLEMENTATION_STATUS.md`.

## Files

- `index.html`, `styles.css`, `app.js` — dashboard shell (unchanged layout and gold tokens), hash router and
  unsaved-changes guard. `modules.css` — styles for the content modules. `src/boot-check.js` — explains load
  failures (file://, stale cached modules) and offers a cache-bypassing refresh.
- `tools/serve.py` — local no-cache static server (standard library only).
- `src/storage/` — IndexedDB adapter and repositories (records, published snapshots, redirects, media, taxonomies,
  site settings/team, backup/import).
- `src/modules/` — module definitions, list/editor/preview/site/tool views (including Taxonomies and Day-trip
  defaults), and `shared/` domain rules (schema validator, validation, slugs/routes/redirects, pricing, site
  settings/team rules, taxonomy and day-trip rules).
- `src/components/` — accessible fields, tabs, repeaters, relation picker, media picker, dialogs.
- `schemas/content.schema.json`, `schemas/site.schema.json` — draft record shapes (interpreted at runtime for every
  save and import).
- `docs/` — specification, design notes (`SITE_SETTINGS_AND_TEAM.md`, `TAXONOMIES_AND_DAY_TRIPS.md`), acceptance
  checklist and implementation status. `tests/` — browser tests.
- `assets/` — logo and favicon copied from `../assets` (originals untouched).

## Not in this prototype

Authentication and roles, staff accounts, enquiries, commercial price matrix (residency/season/child/group size),
supplier rates, quote totals, availability, payments and checkout, camp conversion, email and notifications,
analytics or other integrations, content migration, real redirects, deployment, homepage builder, bookings and
quotations. Production decisions A1–J1 listed in the specification
remain open; see `docs/IMPLEMENTATION_STATUS.md`.
