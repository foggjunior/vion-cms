# Acceptance checklist

Status 28 October 2026: all items verified in Chromium-based browsers. Evidence, test counts and limitations are in docs/IMPLEMENTATION_STATUS.md.

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

Use meaningful repository/validation tests for persistence, publication snapshots, slug/dependency rules and import safety. Browser-check the critical create/edit/save/reload flow if browser tooling is available. Do not claim unperformed checks.
