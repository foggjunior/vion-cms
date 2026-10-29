# Vion Africa CMS — local content prototype

Gold dashboard shell plus working **Destinations**, **Accommodations** and **Tours** modules. Everything runs in
the browser with no build step, no dependencies and no backend: records and images are stored in this browser's
IndexedDB, and “publish” makes content visible in a **local preview only**. Nothing is sent to Firebase, Cloudinary
or the live website; there is no real login, booking, payment or email.

Field models, validation and the draft/publish/archive workflow are **proposed** behaviour from
`docs/IMPLEMENTATION_SPEC.md`, not confirmed rules of the current CMS.

## Run

From `D:\CMS\vion-cms`:

    python -m http.server 5173 --bind 127.0.0.1

Open <http://127.0.0.1:5173>. The CMS uses ES modules, so it must be served over HTTP; opening `index.html`
directly from disk shows a message explaining this. Use a current Chrome, Edge, Firefox or Safari.

## Use

- Sidebar **Tour Packages › Tours List / Add Tour**, **Destinations › …**, **Accommodations › …** and the
  **Add Tour** quick action open the working modules. All other entries are labelled placeholders.
- Only a title is needed to save a draft. **Publish** saves the draft, checks the publication minimum (errors are
  listed and the first problem is focused) and stores a separate published snapshot. Later draft saves do not
  change the published version until you choose **Publish changes**.
- Each list page links to the local tools: **Local preview site** (published content only), **Media library**,
  **Tour taxonomies**, **Planned redirects** and **Backup & import**.
- Tour pricing is either *price on request* (default) or a provisional manual *“from”* price with currency,
  amount, basis and a public explanation. No price matrix, totals or quotes.
- Back up regularly from **Backup & import**: the data backup (JSON) does not contain image files; download the
  separate media backup to keep the images. Imports replace all local content after full validation.

## Test

- In the browser: open <http://127.0.0.1:5173/tests/> — repository, validation and import tests run against real
  IndexedDB using temporary databases (your CMS data is untouched).
- Headless (optional; Playwright is not a project dependency — point `PLAYWRIGHT_MODULE` at an existing
  `playwright` or `playwright-core` install):

      PLAYWRIGHT_MODULE=/path/to/playwright-core node tests/run-headless.mjs
      PLAYWRIGHT_MODULE=/path/to/playwright-core node tests/e2e.mjs

  `BROWSER_CHANNEL=msedge` or `chrome` runs the unit suite in an installed browser. `tests/e2e.mjs` walks the
  acceptance checklist through the real UI in fresh browser profiles and fails on any non-local network request.

Latest results (28 Oct 2026): 34/34 unit tests in Chromium, Chrome and Edge; 32/32 end-to-end checks in Chromium.
Details, assumptions and limitations: `docs/IMPLEMENTATION_STATUS.md`.

## Files

- `index.html`, `styles.css`, `app.js` — dashboard shell (unchanged layout and gold tokens), hash router and
  unsaved-changes guard. `modules.css` — styles for the content modules.
- `src/storage/` — IndexedDB adapter and repositories (records, published snapshots, redirects, media, taxonomies,
  backup/import).
- `src/modules/` — module definitions, list/editor/preview/site/tool views, and `shared/` domain rules (schema
  validator, validation, slugs/routes/redirects, pricing).
- `src/components/` — accessible fields, tabs, repeaters, relation picker, media picker, dialogs.
- `schemas/content.schema.json` — draft record shapes (interpreted at runtime for every save and import).
- `docs/` — specification, acceptance checklist and implementation status. `tests/` — browser tests.
- `assets/` — logo and favicon copied from `../assets` (originals untouched).

## Not in this prototype

Authentication and roles, enquiries, day-trip editor, commercial price matrix, supplier rates, camp conversion,
email, content migration, real redirects, deployment, homepage builder, bookings and quotations. Production
decisions A1–J1 listed in the specification remain open; see `docs/IMPLEMENTATION_STATUS.md`.
