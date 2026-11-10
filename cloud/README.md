# Approved UI cloud adapter

`tools/prepare-cloud.mjs` copies the approved UI into ignored `public/approved/` and swaps its workspace implementation for authenticated server repositories. It also replaces the old browser Firebase connector and backup screen. The original source/preview is retained for comparison and exporting existing browser records.

Do not edit generated files. Change the approved UI source or these adapters, then run `npm run prepare:workspace`. Next's `/workspace` handler requires an active Firebase staff session. Static JS is public code; it contains no credentials or record data. Every data API rechecks access.

See [CLOUD_IMPLEMENTATION.md](../docs/CLOUD_IMPLEMENTATION.md) for architecture/limits and [STAGING_SETUP.md](../docs/STAGING_SETUP.md) for the required service setup.
