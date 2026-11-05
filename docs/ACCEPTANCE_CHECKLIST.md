# Acceptance checklist

Status 29 October 2026: all items (phases 1, 2 and 3) verified in Chromium-based browsers. Evidence, test counts and limitations are in docs/IMPLEMENTATION_STATUS.md.

## Phase 1 — Destinations, Accommodations and Tours

- [x] Existing dashboard, gold branding, 15 navigation groups and mobile sidebar still work.
- [x] Destination/Accommodation/Tour list and Add links open the correct working modules; other modules stay honest placeholders.
- [x] Create a destination draft, reload, edit, select media, publish locally and preview the saved revision.
- [x] Save incomplete draft; publishing shows actionable errors and focuses the first invalid field.
- [x] Create accommodation linked to destination; no-destination reason works; phone remains hidden unless selected.
- [x] Create tour linked to destination/accommodation; add and reorder itinerary; day numbers remain contiguous.
- [x] Price-on-request and manual per-person/group/vehicle display correctly; zero and missing values differ.
- [x] Draft edits to published record do not modify published preview until republished.
- [x] Duplicate creates a draft with new ID/slug and no published snapshot.
- [x] Archive/restore retains data; referenced published dependencies cannot be removed silently.
- [x] Slug conflicts, reserved tour paths, invalid supplied URLs/numbers and stale saves are rejected.
- [x] Uploaded media and records survive browser reload; quota/database failures never show false success. (Quota exhaustion simulated by aborting the write transaction; see status.)
- [x] JSON export/import round-trip works; binary-asset exclusion or inclusion is explicitly described and tested.
- [x] Imported text/markup is escaped; malicious link schemes and invalid image files rejected.
- [x] Dirty-editor navigation warns; cancel keeps form; browser history/reload works.
- [x] No production network writes, real login claims, invented bookings or real customer fixtures.
- [x] Desktop and narrow mobile forms are usable with keyboard, visible focus and horizontal tables.
- [x] Record actual checks/results and unresolved limitations in docs/IMPLEMENTATION_STATUS.md.

## Phase 2 — Site settings and Team

- [x] Settings › Setting Options opens a working settings editor; a clearly labelled Settings › Team entry is added; all 15 groups, other placeholders and the content modules still work.
- [x] Exactly one site settings record exists; creating a second (in the UI, repository or an import) is rejected.
- [x] An empty or incomplete settings draft saves; unknown company details stay empty (only the default timezone is pre-filled); optional fields stay optional.
- [x] Invalid phone, email, timezone, maps, social and review values are rejected with field errors, a summary and focus on the first invalid field; edits are kept.
- [x] Duplicate visible social networks are rejected; other named networks work without code changes.
- [x] Publishing settings requires company name, valid email, primary phone, office address, a usable logo (bundled logo allowed) and a sharing image or explicit fallback.
- [x] No API keys, credentials, notification recipients, authentication settings, analytics IDs or integration secrets can be stored in settings.
- [x] Team profiles: searchable list; create/edit name, position, biography, portrait with alt text and https links; draft save; publish/unpublish; archive/restore; preview.
- [x] Move Up/Move Down work from the keyboard; order and visibility are published separately and never publish profile drafts.
- [x] Saving a published settings record or profile does not change its published preview until republished.
- [x] Images used by settings or team profiles (drafts or published snapshots) cannot be deleted.
- [x] Biographies, descriptions and labels render as text; unsafe link schemes never become links.
- [x] A populated version-1 database upgrades without losing records or media.
- [x] Data + media backup round-trip includes settings, profiles, order and portraits without orphaned references; version-1 backups still import (documented interpretation: site data kept).
- [x] Local preview shows company/contact summary, footer-style links, the team grid in published order and profile pages; missing settings show an explicit empty state; SEO metadata preview does not claim production changes.
- [x] Desktop and phone layouts, unsaved-changes guard, reload and Back/Forward work on the new screens.

## Phase 3 — Tour taxonomies and Day trips

- [x] Tour Packages keeps Tours List, Add Tour, Activities / day trips and Add Activity, and adds a clearly labelled Taxonomies entry; Activities / day trips and Add Activity open working Day Trips screens; all other groups, placeholders, the dashboard, account menu and mobile navigation still work.
- [x] Four separate namespaces (types, categories, standards, tags); each term has a stable ID, namespace, label, key, display order, active state, timestamps and version. Nothing is seeded; each group explains that its values await owner confirmation.
- [x] Labels and keys are unique within a namespace after documented normalisation; blank labels, malformed keys and cross-namespace references are rejected; IDs never change on rename; published keys are locked; terms cannot be permanently deleted.
- [x] Searchable management screen with create/edit, keyboard Move up / Move down that keeps focus, and activate/deactivate.
- [x] Deactivating a term changes no record; inactive terms are not offered for new selections, stay (with a warning) on records already using them, survive unrelated saves and remain displayed on published pages.
- [x] Tour selectors use the managed terms; saved references are preserved and unresolved legacy values are shown explicitly, never silently replaced.
- [x] Taxonomy changes follow a documented local publication step that never publishes content drafts; public previews show no management controls.
- [x] Day trips: list search, status filter, deterministic sorting, create/edit, duplicate, archive/restore, draft save, local publish/unpublish and preview, with the proposed fields only (no accommodation, category, standard or type fields).
- [x] Day-trip publication minimum (title, unique valid slug, overview, published destination, cover with alt, inclusion, explicit pricing); optional duration validated when supplied and never tied to the schedule count.
- [x] Day-trip defaults editor; “Copy defaults into this draft” is explicit, warns before changing populated lists and never alters other records; editing defaults never changes day trips; nothing is seeded.
- [x] Pricing reuses the decimal-safe implementation; per person / group / vehicle display correctly; missing differs from zero.
- [x] Additive database upgrade (version 3) tested on a populated version-2 database with every existing module; records, snapshots, settings, team and image Blobs kept; existing terms keep their IDs.
- [x] Drafts never republish; a destination used by a published day trip cannot be unpublished or archived; media used by day-trip drafts or published snapshots cannot be deleted; stale writes and failed transactions never report success.
- [x] Local routes /tours/day-trips and /tours/day-trips/{slug} (hash equivalents documented) with no collision with tour slugs or hubs; listing shows published records only, destination and tag labels, correct price basis, optional schedule, inclusions/exclusions/what to bring and the shared footer; ?filter=tag&value= validated with readable empty states.
- [x] Backup schemasVersion 3 round-trip (day trips, defaults, terms, published taxonomy, media); older v2 and v1 backups import with documented replace/keep rules, kept records validated against the imported content first, missing image files reported.
- [x] After publishing a team profile, “Review team visibility” opens the existing order/visibility panel without publishing the order or other drafts.
- [x] Desktop and phone layouts of the new screens, keyboard focus, unsaved-changes guard on the day-trip and defaults editors.

Use meaningful repository/validation tests for persistence, publication snapshots, slug/dependency rules and import safety. Browser-check the critical create/edit/save/reload flow if browser tooling is available. Do not claim unperformed checks.

## Costing and bookings verification, 2 November 2026

- [x] Park/general STO and room-specific rates stay outside public records.
- [x] General fallback/room selection copies rates; room and vehicle quantities remain explicit.
- [x] STO profit example and adult/child/vehicle/room calculations tested exactly.
- [x] Booking list/detail, manual entry, standalone/booking-linked quotation work.
- [x] Local tour cost template copies into requested-tour quotation and recalculates crew-based lines.
- [x] Booking/quotation PDF downloads; guest projection excludes STO/profit.
- [x] Separate private backup and merge-import; existing content import unaffected.
- [x] Website field mapper, stable source identity, skip-existing import and staff read guard tested with mocks.
- [x] Messages/Email Subscribers/Vehicles removed from sidebar; text strengthened.
- [ ] Live staff sign-in and Firestore permissions/import verification (requires authorised user).
- [ ] Explicit live-tour-ID to local-tour-ID catalogue mapping/migration.
