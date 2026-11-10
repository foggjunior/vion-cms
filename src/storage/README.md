> 7 November 2026: the new server application is documented in [Cloud implementation](../../docs/CLOUD_IMPLEMENTATION.md). This document retains the approved browser-preview/history context.

# Local persistence

IndexedDB version 3 stores catalogue, site, media and taxonomy records. Operational and editorial namespaces share the existing meta store. Transactions commit before success, and stale writes are rejected. The optional reviewVersion:1 backup extension includes editorial documents/profile/activity; old imports retain editorial records and required media. Private costing/bookings have their separate export. See ../../docs/REVIEW_BUILD.md for the full backup and integration rules.
