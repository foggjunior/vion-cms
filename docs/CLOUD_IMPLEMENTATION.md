# Vion CMS — Next.js / Firebase implementation

Updated 7 November 2026. The owner approved the preview and chose a **new staging Firebase project** for the first connected test. This document describes the server implementation. The older phase documents describe the browser preview and its historical tests.

## What is implemented

- Next.js 16 App Router runs the application and all privileged APIs. React + Tailwind power sign-in, installation status, account management and integrations. The already approved CMS editors remain native ES-module components, delivered by the authenticated `/workspace` route. They have not been falsely described as a complete React rewrite.
- The approved full-width design, bundled Inter font, black text, gold actions, rounded navigation cards and collapsing sidebar remain.
- Every existing content, settings/team, editorial, taxonomy, booking, STO/rate, costing and quotation screen uses the cloud repository transport in this application. It does **not** create an IndexedDB database in the staff browser. The independent browser-only preview remains available for reference and export.
- Firebase Authentication signs staff in; a recent Firebase ID token is exchanged for an eight-hour HttpOnly, SameSite=Strict session cookie. The server verifies revoked sessions and the current staff access record on each request. Signing out clears the cookie. Staff accounts have no public self-registration or automatic access.
- Firestore persists shared records. Every mutation repeats the original domain validation server-side. Expected record versions reject stale edits; a workspace revision comparison prevents races across dependent records. Drafts and published snapshots stay separate.
- Real account management: grant an existing Firebase account access, or create an account and queue its password setup invitation through Resend. Change role, deactivate access and revoke sessions. The last active administrator cannot be removed. Team profiles and the internal directory remain content, not login accounts.
- Cloudinary receives signed JPEG/PNG/WebP uploads directly from the browser, followed by server verification of the provider record, actual image bytes and dimensions before any asset is added to the library. This avoids Vercel request-body limits for 10 MB uploads. Limits: 10 MB and 40 million decoded pixels; animated/multi-page images are rejected. Metadata is in Firestore; originals are in Cloudinary. Draft and publication references protect images from library removal. Removing a library item does not destroy its remote original; retention/cleanup is an explicit separate operation.
- Website booking sync reads the actual existing `bookings` contract on the server, including the legacy `depatureDate` spelling. IDs are deterministic per source project/document. Repeated imports skip existing records, preserving staff edits. Invalid source documents are reported. The source website is never modified by sync.
- Resend: explicit team-notification queueing from booking details, staff invitation jobs, lease-based processing, bounded retries, stable provider idempotency keys, signed delivery webhooks and an inbound email reader. Received emails remain correspondence; they do not silently become bookings. Plain text is rendered safely; attachments are listed but not downloaded.
- A scheduler endpoint runs booking sync and queued delivery. Existing website submissions already have their own email notification handler; importing those submissions does not re-send acknowledgements.
- Public publication feed contains validated snapshots and referenced public media only. Private rates, profit, customer information and the staff directory are excluded. Historical aliases are 308 redirect instructions in the feed. The website adapter is staged in `integrations/website/`; the existing website is not switched over automatically.
- Validated content backups, Cloudinary reference manifests and separate private-operation exports/imports. CLI migration has a read-only plan mode and requires a matching project confirmation for writes. URL reconciliation is tracked in `migration/url-ledger.json`.

## Run

Requirements: Node.js 22 or newer and npm. From `D:\CMS\vion-cms`:

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Fill `.env.local` using [STAGING_SETUP.md](STAGING_SETUP.md). Keep secrets out of Git and chat. The application opens at http://127.0.0.1:3000/setup and `/login`. Double-click `start-local.cmd` after installing dependencies. `npm run build` and `npm start` run the production build locally. Rebuild after changing NEXT_PUBLIC variables.

The old preview uses `python tools/serve.py 5173` or `start-preview.cmd`; it stays at http://127.0.0.1:5173. Its existing browser records are not automatically uploaded. Export data, media and private-operation backups first.

## Roles

| Role | Allowed work |
| --- | --- |
| admin | All modules, staff accounts, private operations, backups and migration |
| publisher | Read/edit public content, settings/team and media; publish/unpublish/archive; no customer or costing access |
| editor | Read public content and save drafts/media; cannot publish/unpublish/archive or access private operations |
| reservations | Booking inbox, private rates/costing/quotations; read content; no content editing or account administration |
| viewer | Read content; no writes, customer information, internal directory or costing |

All roles can edit their own display preferences. Buttons inherited from the approved UI may still be visible to a role that cannot execute them; the server denies the action. Dashboard private metrics are empty for roles without booking/costing access. More granular permission-aware button hiding is a UI refinement, not the access boundary.

## Storage and concurrency

`cms_entries` stores a document for each logical store/key, with a JSON payload. `cms_state/control` stores the shared revision. `cms_staff`, `cms_audit`, `cms_public`, email jobs/events and inbox correspondence are separate collections.

To retain the tested domain invariants, the server hydrates a temporary, isolated IndexedDB-compatible **in-memory transaction engine** for each request (`fake-indexeddb`). This is a compatibility layer, not browser persistence or a separate database. It runs the same repository methods; only the changed documents are committed to Firestore in a single revision-checked transaction. Publications are included in that transaction. A conflicting revision returns a reload/retry error; there is no last-writer-wins overwrite.

This initial adapter reads the workspace metadata on each request and serialises writes across the workspace. It deliberately enforces an 8,000-entry ceiling, 440 changed/projection documents per mutation and an 800 KB payload per document. These are implementation limits, not confirmed business rules. They suit a small initial migration but require measured staging latency/read-cost checks. Larger imports must be batched; a high-volume deployment should replace this compatibility layer with targeted Firestore repository transactions while retaining the domain tests. Cloudinary image bytes are never stored in Firestore.

## Security and delivery boundaries

The API verifies sessions and roles independently of the displayed UI. Mutations require a matching Origin. Uploaded files are inspected for actual bytes and decoded dimensions. Webhooks use Resend signature verification on the original payload; there is no unsigned inbound fallback. Provider credentials are only read by server modules. API errors do not return credential values.

`firestore.cms.rules` is a namespaced policy. Use a new staging project as chosen. **Do not replace the production website rules with it.** The existing website has a broad legacy `staff:true` rule: a deny rule on a nested CMS path does not override a matching allow in Firestore. Reusing that project requires reconciling the entire rule set and removing inappropriate broad access before release. This application does not assign the legacy `staff:true` claim.

The supplied `vercel.json` schedules ten-minute processing and requires a plan that supports that frequency. An external scheduler may instead call `/api/cron` with `Authorization: Bearer <CRON_SECRET>`. Delivery is queued, not guaranteed exactly once across all failure scenarios; provider idempotency applies within Resend's supported retention window. Inspect delivery events before manually requeueing exhausted jobs.

## Verification performed

- `npm run build`: passed after implementation (final result in IMPLEMENTATION_STATUS.md).
- `npm run test:server`: 34 tests passed: roles, shared data, server validations, stale and concurrent writers, publication isolation, private-data filtering, image references, backups, aliases and wire transport.
- `node tests/cloud-e2e.mjs`: 52 Chrome checks passed against the generated cloud UI and real execution pipeline, using isolated in-memory persistence. All 39 tested screens loaded; a second browser saw a saved server record; the approved editor saved through the API; no browser database was created; desktop/mobile checks passed.
- `node tests/next-http.mjs`: 22 checks passed against the actual Next server, including access denials, cross-origin rejection, protected-page redirects and login/setup rendering.
- No live Firebase, Cloudinary or Resend request was authenticated or sent. Real provider operations, staff invitation delivery, webhook delivery, deployed security rules and website cutover remain unverified until staging configuration is supplied. Java is unavailable here, so a full Firebase emulator run was not performed. In-memory tests are not reported as live integration tests.

## Release work still required

1. Create/configure the staging services and initial administrator; run the connected checks in STAGING_SETUP.md.
2. Reconcile source exports with the owner, all listed legacy URLs, taxonomy semantics and publication mappings. No unverified legacy content conversion is silently applied.
3. Migrate image files, content and private operations in staging; verify record totals, relations, guest PDF totals and private-data exclusion.
4. Wire the website adapter/template mappings on staging; verify canonical paths, 308 behaviour, metadata, forms and cache behaviour against the URL ledger. The feed alone does not change the public website or create redirects on its host.
5. Deploy the CMS and website integration to the chosen hosting environment after those checks. No deployment, commit or push has been performed by this task.


## 9 November workflow update

See [INLINE_ACCOMMODATIONS.md](INLINE_ACCOMMODATIONS.md) for inline accommodation/room capture, private STO reuse and the removed sidebar account block. Reservation staff can create accommodations through the bounded inline action and upload new media; this does not grant arbitrary content-write or publishing permissions.
