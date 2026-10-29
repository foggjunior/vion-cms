# Implementation status

Updated 28 October 2026. Functional local prototype of the **Destinations, Accommodations and Tours** modules is
implemented and tested in the browser. Everything below describes this local prototype only: data lives in one
browser's IndexedDB, “publish” means visible in the local preview, and nothing is connected to Firebase,
Cloudinary, the live website, authentication, email, bookings or payments.

## Evidence vs. assumptions

- **Confirmed by evidence (unchanged from the handoff):** navigation labels and the 15 sidebar groups (screenshots);
  observed public destination/accommodation fields and inferred tour fields (public audit, as summarised in
  `docs/IMPLEMENTATION_SPEC.md`).
- **Proposed behaviour implemented here (not confirmed current-CMS behaviour):** the draft/publish/archive
  lifecycle, field models in `schemas/content.schema.json`, validation and publish minimums, slug/route rules,
  planned redirects, image roles, taxonomies, pricing modes and everything under “Local assumptions” below.

## What works

| Area | Implemented |
| --- | --- |
| Shell | Gold dashboard, logo, 15 sidebar groups and mobile sidebar preserved. Tours List / Add Tour, Destinations List / Add Destination, Accommodations List / Add Accommodation and the **Add Tour** quick action open working modules. All other entries (including Activities / day trips, Bookings, Gallery…) remain labelled placeholders. Hash routes with stable record IDs; reload and back/forward work. |
| Lists | Heading, counts, search, status filter (active, draft, published, published-with-unpublished-changes, archived, all), deterministic sorts (updated, title; manual order for destinations; price with missing last and recommended rank for tours), empty states, edit, preview, duplicate, archive/restore. No permanent delete. Filters persist in the URL. |
| Editors | Sticky title/actions, tabbed sections, field-level errors with an error summary that links to fields, focus moves to the first invalid field (switching tab), save status (unsaved / saving / saved / error) in a live region, dirty tracking, unsaved-changes guard for in-app links, sidebar, browser Back/Forward and reload. Edits typed while a save is in flight are kept, never discarded. |
| Destinations | Title, display name, internal name, slug, order, overview, best time, wildlife, ordered activities, structured travel tips, read-only legacy tips with non-destructive conversion, cover + ordered gallery, SEO. |
| Accommodations | Name, slug, type/standard (audit examples as suggestions only), setting, destination link or no-destination reason, description, amenities, activities, public phone (hidden by default), website (http/https only), public-page toggle, media, SEO. |
| Tours | Title, slug, summary, duration, destinations, prototype type/category/standard/tags, featured, recommended rank, overview, inclusions/exclusions, itinerary (days with title, description, destinations, alternative accommodations, meals, activities; keyboard reorder; contiguous numbering; “add missing days”), provisional pricing, media, SEO. |
| Pricing | `request` (default) or `manualFrom` with ISO currency (validated against `Intl.supportedValuesOf`), decimal-string amount (no floating point; precision limited by the currency), basis per person / group / vehicle and a required public applicability note. “per person” only for `perPerson`; 0 renders as an amount; a missing amount is “incomplete”, never 0; request mode stores no amount. Provisional warning everywhere manual pricing appears. No totals, quotes or residency/season matrix. |
| Publication | Publishing saves the draft first, validates publish minimums inside the write transaction, and stores an immutable snapshot. Saving a draft never republishes; the list and editor flag “Unpublished changes”. Unpublish and archive need confirmation and are blocked while a published tour/accommodation depends on the record. Restore returns to draft and needs explicit republish. |
| Routes | Slug generated from the first title, then kept. Unique per full route across active **and archived** records, previously published routes and planned redirect sources. `/tours/day-trips`, `/tours/zanzibar-trips`, `/tours/climbing-trips` reserved. Changing a published slug and republishing records a local 308 redirect (chains flattened, loops prevented) shown on the Planned redirects page and resolved in the local preview site. |
| Media | One local library: upload (JPEG/PNG/WebP, 10 MB, content-sniffed, SVG rejected, must decode), low-resolution warning, reuse across records, default alt/credit/caption, usage list, delete only when unreferenced, contextual alt per placement, decorative gallery images, missing files shown as errors. Object URLs revoked when a view closes. |
| Previews | Saved-draft and published-snapshot previews (card + page + SEO block) with draft/published badges and price basis; local preview site lists published content only. Published pages resolve related records from published snapshots, so dependency drafts never leak into them. |
| Storage | IndexedDB stores for records, published snapshots, redirects, assets, image Blobs and taxonomy terms. Success is reported only after transaction `complete` (strict durability requested). Stale versions are rejected; other tabs are warned via BroadcastChannel. Quota/open/transaction errors produce “Not saved…” messages. |
| Backup | Data backup JSON (`format`, `schemasVersion: 1`, `binaryAssetsIncluded: false` plus a notice) and a separate media backup JSON with base64 originals. Imports are validated completely (format/version, schema, unsafe links, references, unique routes, snapshot consistency, redirect loops, image types; media decoded) before a single replace-all transaction. |
| Safety | All user and imported text rendered as text nodes; URL attributes allowlisted; Content-Security-Policy restricts scripts and network connections to the same origin. |

## Checks actually run (28 Oct 2026, Windows 11)

Server: `python -m http.server 5173 --bind 127.0.0.1` (Python 3.14.7). Playwright 1.63 (`playwright-core`, not a
project dependency) drove the browsers.

1. **Repository/validation tests** — `tests/index.html` (runs in the browser against real IndexedDB, temporary
   databases): **34 passed, 0 failed** in bundled Chromium 153, Google Chrome 156 and Microsoft Edge 156.
   Covers schema shapes, slugs/reserved routes/archived uniqueness, redirect planning (chains/loops), pricing
   formatting and decimal comparison, draft vs. publish rules per kind, persistence across reconnects, stale writes,
   simulated `QuotaExceededError` rollback, snapshot isolation, dependency blocking, archive/restore, duplicate,
   media sniffing/decoding/size, referenced-asset deletion, taxonomies, backup round-trip and rejected imports.
2. **End-to-end UI checks** — `tests/e2e.mjs` in Chromium: **32 passed, 0 failed**, each in fresh isolated
   browser profiles, including desktop (1400×900) and narrow mobile (390×844). Covers every checklist item below.
3. **Visual review** of dashboard, lists, editors, itinerary, pricing, media, picker, previews and mobile screens via
   screenshots. Opening `index.html` from `file://` shows a message explaining how to serve it.

Defects found by these checks and fixed: edits typed during an in-flight save were discarded; save errors were
overwritten by “Unsaved changes”; the Back-button guard left duplicate history entries; dialogs could outlive their
view; a hidden table label widened mobile pages; hidden file inputs had no visible keyboard focus; “activitys”
pluralisation; imports now report all record-level problems at once.

## Acceptance checklist results

| Checklist item | Result | Evidence |
| --- | --- | --- |
| Dashboard, gold branding, 15 groups, mobile sidebar | Pass | E2E 1, mobile check, screenshots |
| List/Add links open modules; others honest placeholders | Pass | E2E 2–3 |
| Destination draft → reload → edit → media → publish → preview saved revision | Pass | E2E 4, 6 |
| Incomplete draft saves; publish shows actionable errors and focuses first invalid field | Pass | E2E 4–5 |
| Accommodation linked to destination; no-destination reason; phone hidden unless selected | Pass | E2E 8–9 |
| Tour linked to destination/accommodation; itinerary add/reorder; contiguous days | Pass | E2E 10 (stored day numbers verified) |
| Request and manual per person/group/vehicle display; zero vs missing | Pass | E2E 13, unit pricing tests |
| Draft edits to a published record do not change preview until republished | Pass | E2E 7, 13; unit snapshot test |
| Duplicate: new ID/slug, draft, no snapshot | Pass | E2E 14; unit test |
| Archive/restore retains data; referenced published dependencies protected | Pass | E2E 15; unit test |
| Slug conflicts, reserved tour paths, invalid URLs/numbers, stale saves rejected | Pass | E2E 8, 11, 16, 17 (planned redirect: 21); unit tests |
| Media and records survive reload; quota/database failures never show false success | Pass (quota simulated) | E2E 18, 22; unit fault-injection test |
| JSON export/import round-trip; binary exclusion/inclusion described and tested | Pass | E2E 24–26; unit backup tests |
| Imported text/markup escaped; malicious links and invalid images rejected | Pass | E2E 20, 25–27; unit tests |
| Dirty-editor navigation warns; cancel keeps form; history/reload work | Pass | E2E 19, 30 |
| No production network writes, login claims, invented bookings or customer fixtures | Pass | E2E final check (zero non-local requests), CSP, code review |
| Desktop and mobile usable with keyboard, visible focus, horizontal tables | Pass | E2E 28, 29, 31 |
| Checks and limitations recorded | Done | This document |

## Local assumptions (conservative, reversible)

- Route prefixes `/destinations/`, `/accommodations/`, `/tours/`; slug pattern `a-z0-9` with single hyphens, max 96.
- Public name = display name if set, otherwise title (destinations).
- Cover alt text is always required to publish (no decorative cover); gallery images need alt unless marked decorative.
- Fewer than three images and images narrower than 1200 px are warnings only.
- Day numbers are derived from itinerary order on every save. Meals offer Breakfast/Lunch/Dinner; other imported
  values are preserved.
- Exact duplicate list entries are removed on save; entries differing only by capitalisation are kept and flagged.
- Choosing a destination clears the no-destination reason; switching to price on request discards manual-price fields.
- Archiving a published record also removes its snapshot (blocked while published dependents exist). Archived
  records are read-only and keep their slug and route history reserved.
- Accommodation `publicPageEnabled` defaults to true for new local records; when false the record is hidden from the
  local site listing and tours show its name without a link (A3 unresolved).
- Taxonomy terms start empty; labels unique per namespace (case-insensitive), ≤ 80 characters; rename keeps the ID.
- Data import replaces all local content (no merge). Media backup is a separate base64 JSON file.
- The Media Library › Gallery entry stays a placeholder (E1 unresolved) and links to the local media library.
- Test hooks: `window.__vionApp` (workspace access, fault injection, current view) and `data-rendered-route` /
  `data-ready` on `#moduleRoot`. They do not bypass any rule.

## Limitations

- Single-browser, single-origin storage; clearing site data deletes everything. Not secure, not multi-user, no
  authentication or roles. Use **Backup & import** and optionally “Request persistent storage”.
- Real storage exhaustion was not reproduced; quota failure was simulated by aborting the write transaction with a
  `QuotaExceededError`. Strict durability is honoured by Chromium; other engines may ignore the hint.
- Tested in Chromium-based browsers only (bundled Chromium, Chrome, Edge). Firefox and Safari were not available
  here. No screen-reader session was run; accessibility relies on semantic HTML/ARIA and keyboard checks.
- Only the current published snapshot is kept (with a revision counter), not a history of earlier snapshots.
- Redirects are planned entries resolved one hop in the local preview; query-preset aliases are not handled.
- Previews approximate a public page layout; they are not the live site's templates.
- Images are shown from originals (no resizing/thumbnails); large media backups are held in memory while exported or
  imported.
- Opening `index.html` directly from disk is no longer supported (ES modules); serve over HTTP.
- Dashboard figures remain sample data.

## Deferred (production-dependent, per specification)

A1 full module scope · A2 hidden tour inventory · A3 accommodation visibility · A4 camps and itinerary links ·
B1 exact tour editor · B2 price matrix · B3 private commercial data · B4 taxonomy definitions · C1 lifecycle/deletion ·
C2 legacy slugs and real redirects · D1/D2 publication and cache/live update · E1 media ownership · F1 authentication ·
G1/G2 enquiries and notifications · J1 copy corrections. Also: Firebase/Next.js adoption, data migration and
deployment, all intentionally not started.
