# Acceptance checklist

Status 29 October 2026: all items (phase 1 and phase 2) verified in Chromium-based browsers. Evidence, test counts and limitations are in docs/IMPLEMENTATION_STATUS.md.

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

Use meaningful repository/validation tests for persistence, publication snapshots, slug/dependency rules and import safety. Browser-check the critical create/edit/save/reload flow if browser tooling is available. Do not claim unperformed checks.
