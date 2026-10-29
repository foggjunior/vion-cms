# Implementation status

Updated 29 October 2026. Functional local prototype of the **Destinations, Accommodations and Tours** modules
(phase 1, 28 Oct) and **Site settings and Team** (phase 2, 29 Oct) is implemented and tested in the browser.
Everything below describes this local prototype only: data lives in one browser's IndexedDB, “publish” means
visible in the local preview, and nothing is connected to Firebase, Cloudinary, the live website, authentication,
email, bookings or payments.

## Phase 2 — Site settings and Team (29 Oct 2026)

Design, data model, publication rules and validation: `docs/SITE_SETTINGS_AND_TEAM.md`. All of it is proposed
replacement behaviour, not confirmed current-CMS behaviour; screenshots only establish the *Settings › Setting
Options* menu entry.

### What works

| Area | Implemented |
| --- | --- |
| Navigation | *Settings › Setting Options* opens the settings editor; a new *Settings › Team* entry opens the team list. The account menu's *Settings* opens the settings editor. All 15 groups and every other entry unchanged; other modules stay placeholders. Hash routes with reload and Back/Forward; the unsaved-changes guard covers both editors. |
| Site settings | One singleton record (`site-settings`) with Company, Contact, Branding, Social profiles, Review links and Default SEO tabs, a Preview tab with publish readiness, field errors, summary and focus on the first invalid field. Empty draft by default (only the specified timezone default). Save draft, Publish/Publish changes, Unpublish; draft saves never change the published snapshot. A second settings record cannot be created (repository, schema and import). |
| Branding | Light/dark-background logos from the shared media library or the bundled trusted logo (light backgrounds only, explicit choice), default sharing image from the library, explicit opt-in fallback to an uploaded light logo. SVG uploads remain rejected. |
| Social / reviews | Repeatable, keyboard-reorderable entries; Facebook/Instagram/TikTok suggestions plus any other named network; per-entry visibility; duplicate visible networks rejected; https-only links. Review links have platform, URL, optional description, button label, order and visibility. |
| Team | Searchable, filterable list in draft order; create/edit profile (name, position, plain-text biography, portrait with contextual alt text, optional https links); draft save, local publish/unpublish, archive/restore (read-only while archived), profile preview (draft/published). Profiles are not accounts. |
| Order & visibility | Separate team lineup record with its own draft and published snapshot. Keyboard Move up/Move down (focus stays on the moved profile, position announced) and Visible checkboxes write the draft lineup; the profile editor's *Team page* tab saves visibility/position with the profile. **Publish order & visibility** publishes order/visibility only; profile publish publishes content only. Draft and published team page previews. |
| Local preview | `#/site` shows the published company/contact summary (or an explicit “no published settings” state), the team grid in published order and a footer with logo, contact (tel:/mailto: links), maps, social and review links on every local site page (bundled-logo fallback when nothing is published). `#/site/team` and `#/site/team/<id>` show the team page and profile pages. Settings preview: summary, footer and default-SEO metadata, each stating that production SEO is not changed. |
| Storage | IndexedDB version 2 (additive upgrade: new `siteRecords`, `sitePublished`). Same envelope, snapshot, stale-version and transaction conventions as content; validation runs inside each write transaction. |
| Media | Usage tracking and delete protection now include logos, sharing images and portraits in drafts and published snapshots; usage links open the settings or profile editor. |
| Backup | Data backup schemasVersion 2 with `siteRecords`/`sitePublished`; full validation (singleton, lineup integrity, schemas, unsafe links, snapshots, media references) before one replace-all transaction. schemasVersion 1 backups still import: they replace content and keep current settings, team, lineup and the images they use. Media backup format unchanged and includes portraits and logos. |

### Checks actually run (29 Oct 2026, Windows 11)

Server: `python -m http.server 5173 --bind 127.0.0.1` (Python 3.14.7). Playwright 1.63 (`playwright-core`, not a
project dependency).

1. **Baseline before changes:** 34/34 unit tests; end-to-end 30/32 and then 31/32 — intermittent failures from two
   test races (a check read the previous page's heading; another matched a stale error summary). Both checks
   now wait for the specific rendered state; the application was behaving correctly.
2. **Unit tests** (`tests/index.html`, 53 tests = 34 existing + 19 new in `tests/site.test.js`): **53 passed, 0 failed**
   in bundled Chromium 153.0.8010.12, Google Chrome 156.0.8078.48 and Microsoft Edge 156.0.4314.50. New coverage:
   schema shapes and rejected secret-like fields; lineup helpers; phone/email/timezone/link rules and tel/mailto
   building; settings draft vs publish rules (optional fields optional, bundled logo, sharing fallback, missing
   files); profile rules; escaped rendering and unsafe links; singleton creation/duplicate/stale/reconnect; draft vs
   published isolation for settings; simulated quota/unknown/abort failures for settings, profiles, moves and lineup
   publish (nothing written, no success); ordering/visibility isolation from profile content; editor placement with
   lineup stale check; unpublish/archive/restore; media protection for portraits/logos/sharing images including
   published-only references; **upgrade of a populated version-1 database**; v2 data+media round-trip with no
   orphaned references and content kept; **v1 backup compatibility** (site data and its images kept); rejection of
   duplicate settings, broken lineups, unsafe links and inconsistent snapshots with nothing changed; content
   regression (publish, duplicate, usage).
3. **End-to-end** (`tests/e2e.mjs`, fresh browser profiles, desktop 1400×900 and phone 390×844): **44 passed,
   0 failed** in two consecutive runs (32 existing + 12 new). New checks: Settings submenu and account menu; empty
   settings draft, invalid values with field errors/summary/focus, edits kept, reload; publication minimum, bundled
   logo, sharing image upload, publish, footer tel/social/review links, draft vs published preview, local site
   unchanged by drafts; duplicate/unsafe social links; unsaved-changes guard with Stay/Back/Leave on the settings
   editor; three profiles with portraits, reload, publish; keyboard Move up/down with focus retention and
   published page unchanged until the order is published; visibility; draft profile edits not published by order
   publication; unpublish/archive/restore; unsafe profile link with focus and escaped markup; media delete
   protection; data+media backup round-trip into a fresh profile and a v1 import keeping site data; phone-width
   settings, team list (button activation) and local site without horizontal page scroll.
4. **Visual review** of screenshots at 1400 px and 390 px (settings branding tab, team list, profile *Team page* tab,
   local site with company summary/team grid/footer, settings preview, profile preview, draft team page): no
   horizontal page overflow at either width (measured).

Defects found by these checks and fixed: a literal “null” in the team-order panel (native `append` of `null`); the
publish-order button read “Order published” before any order existed; Chromium's `Intl` accepted the abbreviation
`EAT` as a timezone (now IANA Area/Location names only); links in the company summary and profile pages were not
visibly styled as links.

Not run: Firefox and Safari/WebKit (not installed here); screen-reader testing; real storage exhaustion (simulated
by aborting the transaction); multi-tab editing of the same team order beyond the stale-version tests.

### Local assumptions (conservative, reversible)

- Display order and visibility are a separate lineup record published on its own (see design notes). New profiles
  join the end of the draft order and are visible by default; nothing shows publicly until both the profile and the
  order are published.
- Unpublishing a profile keeps its place in the order; archiving removes it from the draft order and remembers its
  visibility for restore (restored profiles go to the end).
- Settings have no archive; Unpublish removes the published settings from the local site.
- The bundled `assets/logo-dark.svg` (near-black wordmark, orange mark) is offered for light backgrounds only and is
  never pre-selected. No bundled logo suits dark backgrounds. It cannot be the sharing image (SVG).
- The sharing image is one field shown in Branding and referenced from Default SEO. Its alt text is optional.
- Logo alt text is required to publish. Social profile and review link entries must be complete to publish (or be
  removed); hidden duplicate networks are allowed.
- Telephone uses the existing international rule (7–15 digits), not a Tanzania-only format. Email is a conservative
  plain-address subset. The Google Maps link must be a Google Maps host.
- The settings timezone is public information only; CMS timestamps are still displayed in EAT.
- The title suffix is appended after a space (“Page title | Site name” in the preview); no production title
  template is assumed.
- Team profiles have no slug or public URL; the local preview addresses them by ID (`#/site/team/<id>`).
- A schemasVersion 1 backup keeps current site data (it has no information about it); a schemasVersion 2 backup with
  empty site lists clears it.

### Limitations

- The team page and footer are approximations for local review, not the live site's templates.
- Order changes on the Team list are saved immediately as a draft (there is no batch “Save order” step); the
  published team page changes only when the order is published.
- Only the current published snapshot of the settings, each profile and the lineup is kept, not a history.
- Placement edits in the profile editor are rejected as stale if the order changed anywhere since the editor loaded;
  reload to continue.
- Older CMS tabs still running the version-1 code must be reloaded after the database upgrade.

### Acceptance checklist results (phase 2)

| Checklist item | Result | Evidence |
| --- | --- | --- |
| Settings submenu keeps Setting Options, adds Team; 15 groups, placeholders and content modules unchanged | Pass | E2E Settings submenu check; all 32 phase-1 checks still pass |
| One settings record; duplicates rejected; empty draft; optional fields optional | Pass | Unit singleton/validation tests; E2E settings draft check; import rejection test |
| Supplied values validated (phone, email, timezone, https links, maps host, duplicate visible networks); errors, summary, focus | Pass | Unit rule tests; E2E settings invalid-values and social checks |
| Settings publication minimum; bundled logo and explicit sharing fallback | Pass | Unit publish-rule test; E2E publish check |
| Team profiles: create/edit, portrait + alt, links, draft save, publish/unpublish, archive/restore, preview | Pass | E2E team checks; unit archive/unpublish test |
| Keyboard Move up/down; order/visibility published separately; reordering never publishes profile drafts | Pass | E2E keyboard ordering and draft-isolation checks; unit lineup tests |
| Draft vs published isolation for settings, profiles and team page | Pass | Unit snapshot tests; E2E preview checks |
| Stale writes and simulated storage failures never report success | Pass (failures simulated) | Unit stale and fault-injection tests |
| Media used by settings/profiles (drafts or published snapshots) cannot be deleted | Pass | Unit media test; E2E media check |
| Escaped text and unsafe links in profiles and settings | Pass | Unit rendering test; E2E unsafe-link/markup check |
| Populated version-1 database upgrades additively | Pass | Unit upgrade test |
| Backup v2 round-trip with media and no orphans; v1 backups import and keep site data | Pass | Unit backup tests; E2E round-trip and legacy import |
| Desktop and phone layouts, unsaved-changes guard, reload and Back/Forward | Pass | E2E guard and mobile checks; visual review |

---

## Phase 1 — Destinations, Accommodations and Tours (28 Oct 2026)

### Evidence vs. assumptions (phase 1)

- **Confirmed by evidence (unchanged from the handoff):** navigation labels and the 15 sidebar groups (screenshots);
  observed public destination/accommodation fields and inferred tour fields (public audit, as summarised in
  `docs/IMPLEMENTATION_SPEC.md`).
- **Proposed behaviour implemented here (not confirmed current-CMS behaviour):** the draft/publish/archive
  lifecycle, field models in `schemas/content.schema.json`, validation and publish minimums, slug/route rules,
  planned redirects, image roles, taxonomies, pricing modes and everything under “Local assumptions” below.

### What works (phase 1)

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

### Checks actually run (phase 1, 28 Oct 2026)

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

### Acceptance checklist results (phase 1)

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

### Local assumptions (phase 1)

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

### Limitations (phase 1)

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

Phase 2 additions: the real Setting Options fields and validation of the existing CMS (only the menu entry is
evidenced), the production team page template and whether profiles have public URLs, the confirmed company and
contact details (all entered values are local drafts), staff accounts and permissions (F1), notification recipients
and any integration settings (G2 and production configuration — deliberately not stored in public settings), and
how production SEO defaults are applied (D1/D2).
