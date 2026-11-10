> 7 November 2026: the new server application is documented in [Cloud implementation](../../docs/CLOUD_IMPLEMENTATION.md). This document retains the approved browser-preview/history context.

<!-- CURRENT_REVIEW_BUILD -->
> Current as of 6 November 2026: the complete local review build and current route/backup rules are documented in [Review build](../../docs/REVIEW_BUILD.md). Earlier phase-specific scope and test counts below are historical unless explicitly updated.

# Complete review modules

model.js defines editorial/staff fields, structural rules, publication minimums, routes and backup validation. repository.js persists version-checked envelopes and snapshots in the existing meta store. views.js provides complete list/editor/preview workflows. public.js renders published editorial records and FAQ/menu/migration behaviour. workspace-views.js renders actual dashboard summaries, reports, itinerary library, profile, activity and guide screens.

Data backups include the optional reviewVersion:1 extension; old backups retain these records and their assets. Media references participate in src/modules/shared/records.js assetUsage checks. See ../../docs/REVIEW_BUILD.md for current scope and limitations.
