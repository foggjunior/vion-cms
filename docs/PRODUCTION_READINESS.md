# Production readiness: Vion CMS and public website cutover

Updated 19 November 2026. Audience: the owner and the Vion Codex session. This replaces older readiness statements in `CLOUD_IMPLEMENTATION.md`, `STAGING_SETUP.md` and `IMPLEMENTATION_STATUS.md` where they conflict.

## 1. Recommendation

**Ready for owner-run staging verification. Not ready for cutover.**

The source fixes below are implemented and verified with isolated tests. Cutover remains blocked by owner gates that code cannot close:

| # | Gate | Why it blocks | Smallest next step |
| --- | --- | --- | --- |
| G1 | Booking import topology (F16) | The sync reads `bookings` from the CMS's own Firebase project. In production the website writes them to the website project, so nothing would be imported unless the CMS runs in that project. | Decide: CMS in the website project (full rules reconciliation) or a read-only cross-project reader. |
| G2 | Legacy content converter (F19) | No tool converts the live website's collections and Firebase Storage images into CMS records. `migrate-cloud.mjs` only imports the old local-preview backup format. | Owner supplies a sanitised export sample of each legacy collection. Then build and fixture-test the converter against the mapping in §9. |
| G3 | Backups and PITR (F18) | No managed backup or point-in-time recovery is configured. App exports omit finance, staff access and email queues. | Enable Firestore PITR and daily scheduled backups on the production project. Sign off the targets in §9. |
| G4 | Hosting plan (§8) | Vercel Hobby is for personal or non-commercial use only and runs crons daily. | Choose Vercel Pro or another commercial host before production traffic. |
| G5 | Stored projection reconciliation (F3) | Public documents written before this change keep withheld fields until rewritten. The API now sanitises on read. | Run `npm run public:reconcile` (plan, then apply) on staging, then production. |
| G6 | Dependency advisories (F24) | **CMS resolved 20 Nov:** `sharp` 0.35.5 is locked and unused loaders are blocked ([PERFORMANCE_AND_SECURITY.md](PERFORMANCE_AND_SECURITY.md) §4). **Website still open:** `next` 15.5.22 has critical advisories, and `sharp` 0.34.5 is in its lockfile. | Owner: `pnpm add next@15.5.29 sanitize-html@^2.18.1` with a pnpm override `sharp: ^0.35.5`, then the website tests and a staging build. |

No production claim is made from local tests.

## 2. Baseline and method

- **Repositories:**
  - CMS: `D:/CMS/vion-cms`, branch `development`, audited at `65d78cf`.
  - Website: `D:/viona-africa-development`, branch `development`, audited at `edd2ea9`.
  - Both trees were clean at the start. `D:/viona-africa` (main) and the production branches were not touched.
  - No commit, push, deployment, migration or provider configuration was made.
- **Privacy boundary:** no `.env*` file, credential, private export, Firebase project (including staging), Cloudinary or Resend account was accessed.
  - No `next build`, `next dev` or `next start` was run, and no environment-loading script.
  - All tests used in-memory persistence, a Firestore test double (`server/tests/support/fake-firestore.mjs`), stubbed feeds or stubbed providers.
- **Evidence labels:**
  - **confirmed**: reproduced with synthetic data or read directly from source.
  - **inferred**: follows from source, but not executed end to end.
  - **owner verification required**: needs a connected or provider-side check.
- **Provider facts were checked on official pages:**
  - Vercel Functions limits; the cron usage page; Schedules limits; Terms of Service §4 (Hobby: "personal or non-commercial use"); Pro plan pricing.
  - Firestore transactions, quotas, disaster recovery and pricing.
  - Resend idempotency keys, webhook event types and webhook retries.

## 3. Findings

Line references point at the audit baselines (`65d78cf` CMS, `edd2ea9` website). Many CMS server files are single-line modules, so `:N` is that file's line.

### P0-1 Public data minimisation

| ID | Label | Issue and impact | Evidence | Fix | Test evidence |
| --- | --- | --- | --- | --- | --- |
| F1 | confirmed | The projector copied whole published snapshots into the public feed. This included a destination's staff-only `internalName`, an accommodation phone marked hidden, workflow metadata, a public detail page for a stay with `publicPageEnabled:false` (plus its gallery media), and hidden social, review and team-lineup entries. | `server/publication.mjs:12-15,21`. Reproduced with synthetic records before the fix. | New `server/public-fields.mjs`: explicit per-kind allowlists, conditional phone, visible-only social, review and lineup entries. A disabled stay gets no page, list entry, alias target or media. A tour that names it carries a minimal `accommodationSummaries` entry (title, destination, type, standard, setting, amenities, cover). Media is derived from projected data only. | `server/tests/public-projection.test.mjs` (12 tests). Every schema and editorial field must be classified as public or withheld, or the test fails. Sentinel values for drafts, supplier costs, guest contacts, finance references and directory e-mails never reach the feed. |
| F2 | confirmed | The website's destination mapping spread every CMS field (`...data`) into records that the public `/api/cms/collection` returns to browsers. | `src/lib/server/cmsCollections.js:52` (website) | Explicit `DESTINATION_FIELDS` allowlist. It holds even against an older CMS. | `tests/cms-cutover.test.mjs` |
| F3 | confirmed | Publishing only rewrites the paths a mutation changes. Documents stored by the old projector keep leaking until rewritten. | `server/publication.mjs:33` (`publicProjection` diff) | `sanitizePublished()` in both public routes closes the leak at deploy time. `npm run public:reconcile` rebuilds `cms_public`: dry run first, revision-checked batches, a report of paths and field names only, and removal of stale entries. | Sanitising is idempotent on new documents. A disabled legacy page reads as 404. Reconciliation reaches create/update/remove = 0/0/0 on re-plan and aborts on a concurrent revision. |
| F4 | confirmed | `cms_public` allowed public reads, including collection listing, although no consumer reads it directly (no website reference). | `firestore.cms.rules:10` | Read access is now denied (API-only). The Admin SDK used by `/api/public/*` is unaffected. | Source grep of both repos. **Owner:** deploy to staging only, merged with that project's rules. |

### P0-2 Public website cutover and URL integrity

| ID | Label | Issue and impact | Evidence | Fix | Test evidence |
| --- | --- | --- | --- | --- | --- |
| F5 | confirmed | Renamed or migrated tours, stays, day trips, blog posts and Give Back stories returned 404. The generic detail adapter only accepted a matching `kind` and dropped the CMS's `{redirect,status:308}` answer. | `src/lib/server/cmsCollections.js:101` | `findCmsRecord` maps same-collection aliases to `{redirectTo}`. `findPublicDoc` issues `permanentRedirect` (308) from both metadata and page. Cross-collection, nested and off-site targets are refused (404). | 4 alias tests, plus 404 vs upstream 503 (`cms-cutover.test.mjs`) |
| F6 | confirmed | Give Back stories are published by the CMS under `/give-back/stories/<slug>` but served by the website at `/give-back/<slug>`. Their aliases could never resolve. CMS foundations claim `/give-back/<slug>`, which is not checked against story slugs. | `src/review/model.js` (`impact` prefix); `cmsCollections.js:94` | Alias mapping from stories path to website path. The collision rule is still open (§12). | Give Back alias test |
| F7 | confirmed | The website ignored CMS SEO title, description, noindex and share image. The sitemap listed noindex pages. | `tours/[slug]/page.jsx:174` (and the other five detail pages); `src/app/sitemap.js:57` | `seoOf()` mapping. `src/lib/seo.js` overrides title, description, image and `robots` on six detail pages. The sitemap excludes noindex records. Legacy documents (no `seo`) are unchanged. | SEO and sitemap test |
| F8 | confirmed | A missing CMS origin silently served legacy data, and there was no explicit rollback switch. | `src/lib/server/cmsPublic.js:4` | `CMS_PUBLIC_MODE=cms` fails visibly (throws) without a valid https origin. `CMS_PUBLIC_MODE=legacy` is the explicit rollback. Unset keeps the old behaviour. New `scripts/cms-preflight.mjs` checks the source, rejects the website as source, checks site settings, every kind's count against expected counts, and the URL ledger. | Source-mode, misconfiguration and 3 preflight tests |
| F9 | confirmed | The catalogue was capped at 200 per kind. The destinations reader and the `/faqs` page ignored `truncated` (silent loss). Each image cost one HTTP request (N+1). | `app/api/public/catalogue/route.ts:4`; website `cmsDestinations.js:31`, `faqs/page.jsx:9` | Deterministic cursor pages (`after`, document-ID order) with a 3 MB page budget, sanitised items and an optional embedded `media` map. The website follows cursors, de-duplicates, and fails on a missing cursor or runaway paging. | 437 records over 3 pages with no duplicates or gaps, deterministic order, byte budget (CMS). 437 records with zero per-image requests (website). |
| F10 | inferred | A CMS alias 308 drops the query string, because the redirect is raised in the data layer. The ledger's query URLs are website-owned static pages and unaffected. | `firestorePublic.js` | None. | Owner decision only if campaign parameters on legacy detail URLs matter. |
| F11 | owner verification required | All 74 ledger rows are `verified:false`, and accommodation slugs are not enumerated. Four retired destination slugs live in a website map keyed to legacy Firestore IDs; it is used only in legacy mode. | `migration/url-ledger.json`; website `src/lib/destinationRedirects.js` | The preflight checks every preserved CMS-backed ledger URL against the feed (200, redirect or missing). | The retired slugs must exist as CMS redirects before cutover. |

**Route ownership (website `development`).**
- **CMS-backed when `CMS_PUBLIC_MODE=cms`:** `/destinations` and `/destinations/[slug]` (`cmsDestinations.js`); `/tours`, `/tours/[slug]`, `/tours/day-trips[/slug]`, `/tours/zanzibar-trips`, `/tours/climbing-trips`, `/accommodations[/slug]`, `/blog[/slug]`, `/give-back/[slug]`, `/plan-your-safari` (catalogue), `/faqs` (`readCatalogue`) and FAQ components on other pages (via `firestorePublic.js`, `/api/cms/collection` and `AppContext`).
- **CMS-backed home and about features:** featured destinations, review profiles and team (`cmsSiteSections.js`; failures render an empty section by design); footer company details, social profiles and emergency phone (`/api/cms/*`).
- **Static website UI:** `/`, `/give-back`, `/give-back/stawi-na-vion-foundation`, `/experiences/mto-wa-mbu-living-heritage`, `/privacy`, `/cookie-policy`, `/landing`. `/give-back/stories/[slug]` is a 308 to `/give-back/[slug]`.
- **Not served by the website:** CMS editorial pages, experiences, migration phases and menus are published but not consumed. FAQ `placements` are honoured only for `/faqs`: `listCmsCollection('faqs')` returns `/faqs` items to every FAQ component, including those on other pages (owner verification of the intended placement).
- **Legacy fallback:** every reader above uses the legacy Firestore collections when the mode is `legacy`, or when it is unset and no origin is set.

### P0-3 Booking and email continuity

| ID | Label | Issue and impact | Evidence | Fix | Test evidence |
| --- | --- | --- | --- | --- | --- |
| F12 | confirmed | Each sync scanned one 100-document ID-ordered batch. With a daily cron, a new request with a random ID could wait ⌈N/100⌉ days. Every call loaded the whole workspace and bumped the global revision even with nothing new, invalidating staff edits in progress. | `server/booking-sync.mjs:3`; `vercel.json:1` | Each run covers the whole backlog it can reach. A stateless 14-day `createdAt` window catches new requests, late offline-queue writes and skewed client clocks. A resumable ID sweep (6-hour cycle) catches old or untimestamped requests. Duplicates are detected with point reads of `cms_entries`. Imports run in 100-record revision-checked commits, retried on a concurrent edit. The cursor is stored after imports succeed and outside the workspace revision. Time budget, page cap and no-progress guard. | 7 tests: 450-request backlog in one run, repeat run is a no-op without a revision bump, late and skewed arrival, untimestamped and old records, resumable sweep and its rate limit, invalid source IDs reported, staff edits preserved, scheduled and manual runs concurrent with exactly-once import. |
| F13 | confirmed | `/api/cron` ran sync then email in one `try`, so a sync failure skipped email. | `app/api/cron/route.ts:2` | `server/scheduler.mjs` runs both independently. It returns HTTP 500 if either failed, with error codes, counts and a correlation ID only. It stores `cms_state/scheduler` (last run, last success). Integrations shows the last run, failures and booking-sync status. | Independent-failure tests; redaction (no e-mail address in response or logs) |
| F14 | confirmed | The outbox query took 50 jobs by status and then filtered by due time, so waiting retries could starve due mail. Results were recorded without a lease check. A provider acceptance followed by a local failure was recorded as a provider failure. Retries could run past Resend's 24-hour idempotency window, and permanent errors were retried. | `server/email.mjs:6` | Due jobs are selected and ordered before the limit. Expired `sending` leases are reclaimed. Only the lease holder records a retry. Acceptance is confirmed separately (left for lease expiry, so the retry returns the same provider ID). Jobs are not re-sent more than 23 hours after the first attempt; they fail for review instead. Permanent provider codes fail at once. | 6 tests, including a fake idempotent provider: exactly one delivery after the local failure, and a lost lease. |
| F15 | confirmed | A late webhook could regress delivery state, for example `sent` arriving after `delivered`. | `app/api/webhooks/resend/route.ts:2` | `recordEmailEvent()`: terminal outcomes outrank progress events; between equals, the later provider `created_at` wins. Duplicate `svix-id` deliveries are ignored. An event that arrives before the job's provider ID is applied on confirmation. | 2 tests |
| F16 | confirmed / owner decision | The sync reads `bookings` from the CMS's own Firebase project (`FIREBASE_PROJECT_ID`). | `booking-sync.mjs:3` | Gate G1. | — |
| F17 | confirmed / owner decision | Contact and Stawi partnership forms write the website's `messages` collection, which the CMS never imports. Staff are e-mailed immediately by the website handler. | Website `contact/page.jsx`, `StawiPartnerDialog.jsx`; `enquiryKinds.js` | MVP gap, documented. | Owner confirms whether messages must appear in the CMS. |

**Preserved behaviour.**
- The website still writes `bookings` and `messages` directly. It still sends the team notification and the traveller acknowledgement itself (`/api/send-booking-email`, `/api/send-contact-email`).
- The CMS sync never sends email and never modifies the website.
- CMS team notifications are queued only by explicit staff action.
- No extra acknowledgement or notification was added.

### P0-4 Recovery and migration

| ID | Label | Issue | Evidence | Fix or next step |
| --- | --- | --- | --- | --- |
| F18 | confirmed | **Content backup** (`backup.exportData`): records, published snapshots, redirects, taxonomies, settings, team and editorial documents, plus asset *metadata*. **Media backup** (`exportMedia`): a manifest of Cloudinary references, no bytes. **Private operations** (`operations.export`): quotations and costing. **Not in any export:** finance (`cms_finance/ledger`; readable only via `GET /api/finance`), staff access (`cms_staff`), email jobs, events and received mail, audit, scheduler and sync state. No managed backup is configured. | `server/execute.mjs:2`; `app/api/finance/route.ts:18` | `FIRESTORE_DATABASE_ID` added, so a restored database (restores always create a new database) can be selected without code changes. The restore rehearsal and idempotent re-import are tested. Gate G3 for managed backups. |
| F19 | confirmed | There is no legacy-website-to-CMS converter, and legacy images may be on Firebase Storage. CMS media accepts only verified Cloudinary originals. | `tools/migrate-cloud.mjs`; website `next.config.mjs` (remote patterns) | Gate G2. Mapping in §9. |

### P1-5 Capacity, performance and cost

| ID | Label | Issue | Evidence | Fix |
| --- | --- | --- | --- | --- |
| F20 | confirmed | Every RPC read the whole workspace: Firestore document reads equal entries + 1. Whole-workspace responses (`content.loadContext`, `backup.exportData`) pass Vercel's 4.5 MB buffered limit at roughly 330 published records of the synthetic shape. | `server/persistence.mjs:4`, `execute.mjs:2`; measurements in §10 | A revision-validated snapshot cache: a warm instance reads 1 document while the revision is unchanged, and every commit stays revision-checked. Responses over 4 MB stream (the platform limit excludes streamed responses), up to a 48 MB cap that returns a clear 413. Logs record the operation name and size only. **Owner verification:** load a workspace larger than 4.5 MB on staging. |
| F21 | confirmed | A single global revision means 1 of 5 concurrent writers succeeds; the rest get a 409 and must reload. | §10 | Booking sync no longer bumps the revision on idle runs and retries a stale chunk. Record-scoped versioning is the next step (§12). |
| F22 | confirmed | The finance ledger is one document. A ledger at the validator's maximum (2,000 rows, 1,000 trips) is an 868 KB save request against a 600 KB limit, and 990 KB stored against Firestore's 1 MiB document limit. | `server/finance.mjs:30`; `app/api/finance/route.ts:28` | Staged per-entry plan in §10. |
| F23 | confirmed | The 8,000-entry adapter ceiling equals about 2,400 published catalogue records of the synthetic shape (~3.25 entries per record), before bookings and quotations, which share it. | `persistence.mjs:4`; §10 | Documented. Fails loudly (503 `capacity`). |

### P1-6 Security, deployment and operations

| ID | Label | Issue | Fix or status |
| --- | --- | --- | --- |
| F24 | confirmed | `npm audit --omit=dev`: `sharp` ≤0.35.4 has high-severity libvips and libheif advisories. The CMS decodes uploaded bytes with `sharp` (`server/direct-media.mjs`, `media.mjs`). | Gate G6, owner-approved upgrade. |
| F25 | confirmed (inferred applicability) | Six moderate transitive advisories (`gaxios`, `gcp-metadata`, `google-gax`, `glob`, `minimatch`, `rimraf`) have non-breaking fixes. The `@grpc/grpc-js` and `@firebase/firestore` "high" entries concern gRPC servers and suggest a nonsensical major downgrade; the CMS is a gRPC client. | Run `npm audit fix --omit=dev` and the tests. The website audit (`pnpm audit --prod`) was not run: pnpm is unavailable here. |
| F26 | confirmed | The staff application had no `X-Robots-Tag`, `robots.txt`, HSTS or Permissions-Policy. | Added in `next.config.mjs` and `public/robots.txt`. |
| F27 | confirmed / owner decision | MFA is neither available nor enforced for privileged roles. | Opt-in `CMS_REQUIRE_MFA_ROLES=admin,accounting` (checks the session's second-factor claim). Enable Identity Platform MFA and enrol the users first, or they will be locked out. |
| F28 | inferred | `/login`, `/setup`, `/staff` and `/integrations` have no CSP; `/workspace` and `/finance` do. | Deferred: needs a browser check against Firebase Auth endpoints. |
| F29 | confirmed | The role boundaries hold. Every staff API route verifies the session and every mutation verifies the origin. | `server/tests/access-matrix.test.mjs` (10 tests: all roles × all allowlisted methods, staff directory, finance, prototype names, MFA, route source scan). |
| F30 | owner verification required | Least-privilege IAM and keys; exact `APP_ORIGIN` (https); `CRON_SECRET` set; Resend sending-only key; Cloudinary key scope. | Checklist in §11. |
| F31 | owner verification required | The `Cache-Control` set by `next.config` on `/api/:path*` competes with `public, s-maxage=60` on `/api/public/*`; precedence is not documented. | Inspect the staging response headers. |

## 4. Changed files

**CMS (`D:/CMS/vion-cms`).**
- **New modules:**
  - `server/public-fields.mjs`, `server/public-feed.mjs`, `server/public-reconcile.mjs`.
  - `server/scheduler.mjs`, `server/diagnostics.mjs`.
  - `tools/reconcile-public.mjs`, `tools/bench-capacity.mjs`, `public/robots.txt`.
- **Rewritten:** `server/publication.mjs`, `server/booking-sync.mjs`, `server/email.mjs`, `server/persistence.mjs` (`createPersistence`, snapshot cache, `existing()`; same exported API).
- **Edited server modules:**
  - `server/firebase.mjs`: `FIRESTORE_DATABASE_ID`.
  - `server/policy.mjs`, `server/auth.mjs`: opt-in MFA.
- **Edited routes and UI:**
  - Routes: `app/api/{cron,rpc,public/catalogue,public/content,webhooks/resend,integrations}/route.ts`.
  - UI: `app/integrations/integration-panel.tsx`, `cloud/website-view.js`.
- **Config:** `firestore.cms.rules`, `next.config.mjs`, `package.json` (`public:reconcile`, `bench:capacity`).
- **Tests:**
  - `server/tests/{public-projection,booking-email,access-matrix,recovery-capacity}.test.mjs`.
  - `server/tests/support/fake-firestore.mjs`.

**Website (`D:/viona-africa-development`).**
- **New:** `src/lib/cmsSource.js`, `src/lib/cmsPreflight.js`, `src/lib/seo.js`, `scripts/cms-preflight.mjs`, `tests/cms-cutover.test.mjs`.
- **Edited:**
  - Adapters: `src/lib/server/{cmsPublic,cmsCollections,cmsDestinations,firestorePublic}.js`.
  - Context and routes: `src/context/AppContext.js` (stay-summary fallback), `src/app/sitemap.js`, `src/app/api/cms/social-profiles/route.js`.
  - Six detail pages (metadata): `destinations`, `tours`, `tours/day-trips`, `accommodations`, `blog` and `give-back` `[slug]/page.jsx`.
  - `src/app/(pages)/faqs/page.jsx`: paginated reader.

**Compatibility.**
- The public API changes are additive: `next`, `media`, `include`, `after` and `limit`.
- `truncated` keeps its meaning, and the default page size stays at 200.
- A website build without these changes behaves as before against the new CMS, minus withheld fields.
- The new website works against the old CMS: there are no cursors to follow and images resolve per image.

## 5. Commands run and results

| Command (isolated) | Result |
| --- | --- |
| CMS `node --test server/tests/*.test.mjs` at `65d78cf` before edits | 61 passed |
| CMS `node --test server/tests/*.test.mjs` after | **108 passed, 0 failed** (61 existing + 47 new: projection 12, booking/email 17, access 10, recovery/capacity 8) |
| CMS `node tools/prepare-cloud.mjs` then `node tests/editor-and-cost-copy-e2e.mjs` (in-memory server, port 5190, Chrome) | 57 workflow checks passed |
| CMS `node tests/inline-accommodation-e2e.mjs` | 25 passed |
| CMS `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | 0 errors (3 type errors in new code found and fixed) |
| CMS `node tools/bench-capacity.mjs 200,600,1200` (and a 40-record smoke run) | See §10 |
| CMS `npm audit --omit=dev --json` (sends the lockfile package list to the npm registry) | 11 advisories: 5 high, 6 moderate (F24, F25) |
| Website `node --test --import ./tests/support/register.mjs "tests/**/*.test.mjs"` (temporary `node_modules` junction to `D:/viona-africa/node_modules`, removed afterwards) | **106 passed, 0 failed** (all 92 existing + 14 new) |

**Not run, and why.**
- `next build`, `next dev` and `next start` in either repo (they load environment files).
- Firebase emulator (not configured here).
- Every provider-connected check.
- CMS `tests/e2e.mjs`, `run-headless.mjs`, `review-e2e.mjs` and `daily-costs-e2e.mjs`: no `src/` UI module changed. The known pre-existing failures are unchanged: `e2e.mjs` ×2 and the `daily-costs-e2e.mjs` button style, both also failing on `7508e4b`.
- `operations-e2e.mjs` (hard-wired to the owner's port 5173).
- `pnpm audit` (pnpm unavailable).

## 6. Public data contract

**Withheld from the feed:**
- Destination `internalName`.
- Accommodation `publicPhone` (unless `publicPhoneVisible`), `publicPhoneVisible`, `publicPageEnabled` and `noDestinationReason`.
- Workflow `status`, `version` and `schemaVersion`.
- Drafts.
- Hidden social, review and lineup entries.
- All private operations, bookings, quotations, finance and the staff directory.

The full lists are in `server/public-fields.mjs`.

**CMS fields with no public consumer yet** (coverage only; deferred unless the owner says otherwise):
- `accommodation.publicPhone` when visible: the website's `contacts` field is legacy-only.
- `accommodation.locationName`; `tour.recommendedRank`; `dayTrip.whatToBring` and `displayOrder`.
- `blog.subtitle`; `impact.subtitle`; `foundation` website, mission and programmes (only `mission` is mapped).
- Editorial `experience`, `migration` (except FAQ use), `page` and `menu`.
- `siteSettings.seo.titleSuffix` and `defaultDescription`. The website keeps its own " | Vion Africa Travel" suffix; a CMS SEO title replaces the page-name part.

## 7. URL integrity checks (owner-run, staging)

1. `node --env-file=<staging env> scripts/cms-preflight.mjs --ledger D:/CMS/vion-cms/migration/url-ledger.json --expect counts.json --site https://<staging-site>`
   - **Pass:** `"ok": true`; no ledger URL missing; every count is at least the legacy count.
2. For each `redirected` ledger entry, `curl -sI https://<staging-site><from>` must return `308` with `Location` equal to the target. A missing slug must return `404`. With the CMS stopped, a page must return `500`, not `404`.
3. View source on one record of each kind with CMS SEO values set. Check `<title>`, the description, `og:image` and `robots` (`noindex` where set). Confirm `/sitemap.xml` omits noindex pages.
4. `CMS_PUBLIC_MODE=cms` with `CMS_PUBLIC_ORIGIN` removed: pages fail with 500 (visible), not legacy content. `CMS_PUBLIC_MODE=legacy`: legacy content is served, and the preflight with `--allow-legacy` passes.

## 8. Booking and email operations

**Inbox lag target.** Proposed business target: website enquiry in the CMS inbox within **15 minutes**. Staff are already e-mailed by the website within seconds, so the CMS inbox is secondary to that alert.

**Feasible schedules (official sources).**

| Option | Schedule | Notes |
| --- | --- | --- |
| Vercel Hobby | cron once per day, ±59 min precision | More frequent cron expressions fail at deployment (cron usage page). Not permitted for Vion's commercial use (Terms §4). The newer Schedules page states a 15-minute minimum on Hobby; the two pages conflict. |
| **Vercel Pro (recommended)** | per-minute cron | $20/month platform fee including one deploying seat and $20 usage credit (Pro plan page). Set `vercel.json` to `*/15 * * * *` after upgrading; deploying that on Hobby fails. Function maximum duration 800 s, so the 60 s `maxDuration` here is comfortable. |
| External scheduler | any | A trusted scheduler can call `GET /api/cron` with `Authorization: Bearer <CRON_SECRET>`. This does not fix the Hobby licensing issue. |

No plan was changed or purchased. The website's current host could not be confirmed from the repository (owner verification).

**Firestore index.** The recent-window query (`createdAt >= x`, ordered by `createdAt` then document ID) is expected to use the automatic single-field index. If the first staging run reports `failed-precondition`, create the index from the link in the error.

**Alerting (owner to configure).**

| Condition | Signal | Who |
| --- | --- | --- |
| Scheduled run failed | Cron HTTP 500 in Vercel logs; `cms_state/scheduler.ok=false`; Integrations shows the failing job and its correlation ID | Admin |
| Queue lag | Integrations jobs in `retry` or `failed`; `due` greater than 0 for more than 30 minutes | Reservations lead, then Admin |
| Delivery failures | `delivery` of `email.bounced`, `email.complained` or `email.failed`; `errorCode` | Reservations lead |
| Booking import stale | `cms_state/booking-sync.at` older than 30 minutes (on Pro), or `invalidCount` greater than 0 | Reservations lead |
| Publish failure or stale catalogue | 409/413 on publish; preflight counts below expected | Publisher, then Admin |
| Elevated HTTP errors or spend | Vercel and Firebase budget alerts | Owner |
| Backups | Firestore scheduled backup failure | Owner |

**Logging policy.**
- Logs, responses and stored run records carry operation names, counts, sizes, error codes and correlation IDs only.
- Never names, e-mail addresses, phone numbers, message bodies, tokens or keys.
- Booking-sync reports Firestore source document IDs only.

## 9. Recovery and migration

**Recovery matrix (targets proposed for owner sign-off).**

| Data | Where | Recovery mechanism | Proposed RPO / RTO |
| --- | --- | --- | --- |
| Content, editorial, settings, team, redirects, asset metadata | `cms_entries`, `cms_state` | Firestore PITR (7 days, 1-minute granularity) and daily scheduled backups (14-week retention). The restore goes to a new database; set `FIRESTORE_DATABASE_ID`, redeploy, then run `public:reconcile`. The app-level content backup is for portability. | 15 min / 4 h |
| Bookings (CMS inbox), quotations, costing | `cms_entries` | As above. Also `operations.export` (admin). | 15 min / 4 h |
| Finance ledger | `cms_finance/ledger` | As above (not in app exports). | 15 min / 4 h |
| Staff access | `cms_staff` + Firebase Auth | Firestore restore. Auth users are not in Firestore backups; the owner keeps a list of staff e-mails and roles. | 24 h / 4 h |
| Email queue and events | `cms_email_*` | Firestore restore. Restored jobs older than 23 hours fail for review instead of re-sending. | 15 min / 4 h |
| Public projection | `cms_public` | Derived: `npm run public:reconcile`. | 0 / 30 min |
| Media originals | Cloudinary | The CMS never deletes originals. Account-level loss needs a Cloudinary backup or own export (owner verification). | Owner |
| Website enquiries | Website Firebase project (`bookings`, `messages`) | Website project's own backups. Unaffected by a content-source rollback. | Owner |

**Restore rehearsal (isolated, staging).**
1. Export content, media manifest and private operations from staging.
2. Enable PITR and take a manual backup.
3. Restore into a new database `restore-<date>`.
4. Point a second staging deployment at it with `FIRESTORE_DATABASE_ID`.
5. Compare record counts per store, IDs, the public projection (`public:reconcile` plan = 0/0/0) and URL sets.

Synthetic equivalents pass in `recovery-capacity.test.mjs`: the clean-workspace restore reproduces records, IDs, drafts, aliases and public URLs, and a repeat import is idempotent.

**Legacy → CMS mapping.** Inferred from the website's legacy reads; owner verification is required against a sanitised export. IDs map deterministically (hash of `legacy:<collection>:<id>`) and are recorded in a migration ID map, so repeat imports are idempotent.

| Legacy collection | CMS kind | Field mapping and notes |
| --- | --- | --- |
| `destinations` | destination | `name`→`title`/`displayName`; `slug` kept; `isPublished`→published snapshot; `overview`, `wildlife`, `highlights`, `signatureExperiences`, `activities`; `whenToVisit`/`bestTimeToVisit`→`bestTime`; `travelTips`→`travelTips[{id,title,body}]`; `safariIdeas`→`legacyTravelTips`; `type` (id in `destination-types`)→`destinationType` label; `photos[0]`→`cover`, rest→`gallery` (alt from name); `country` has no field. Retired slugs (`destinationRedirects.js`)→`redirects`. |
| `accommodations` | accommodation | `name`→`title`; `overview`→`description`; `facilities`→`amenities`; `activities`; `website`; `contacts`→`publicPhone` + `publicPhoneVisible:true` (it was public); `isInPark`→`setting`; `destinationId`→mapped ID; `category`/`level` IDs→`type`/`standard` labels; `mapLink` has no field; `publicPageEnabled:true`. |
| `tours` | tour | `title`, `slug`, `isPublished`; `overview` HTML→sanitised `@vion-rich:`; `duration`→`durationDays`; `itinerary[{destinationId,accommodationId,overview}]`→days `{dayNumber,title,description,destinationIds,accommodationIds}`; `included`/`excluded`→`inclusions`/`exclusions`; type/category/standard/tag IDs→taxonomy terms (created and mapped); `isFeatured`→`featured`; price fields→`pricing` (`manualFrom`, USD) or `request`; `publicRates` kept. |
| `day-trips` | dayTrip | As tours; `duration`→`{value,unit}`; tags→`tagIds`. |
| `blogs` | blog | `title`, `slug`, `isPublished`; `overview`→`body`; `photos`→`coverAssetId`/`gallery`; `category`→`categoryId`; tags→`topics`; `createdAt`→`publishDate`. Three distinct headings are required to *re-publish* (existing snapshots import as-is). |
| `charity` / `profile-charity` | impact / foundation | `profile.category`→`foundation.impactId`. Story URL stays `/give-back/<slug>`. |
| `company-details`, team, FAQs | siteSettings, teamMember/Lineup, faq | Settings fields as in `listCmsCollection('company-details')`. |
| Photos | assets + assetBlobs | Cloudinary URLs: register after verification. Firebase Storage URLs: download, upload signed to Cloudinary, verify bytes (the existing `finishUpload` checks), then reference. |

**Cutover sequence.**
1. **Capture:** managed export or backup of both Firebase projects; Cloudinary backup; app exports.
2. **Freeze legacy edits:** announce a window. The website forms keep writing.
3. **Migrate a sample, then the full set, into staging:** `--plan` first, then compare counts, URLs (preflight) and spot pages.
4. **Final delta:** records changed since the sample (by legacy `updatedAt` or `createdAt`), then `public:reconcile`.
5. **Switch the website:** `CMS_PUBLIC_MODE=cms` + `CMS_PUBLIC_ORIGIN`, then redeploy.
6. **Smoke checks:** §7 plus one test enquiry per form, to an approved test address.

**Rollback.**
- **Procedure:** set `CMS_PUBLIC_MODE=legacy` and redeploy the website. Enquiries are unaffected because forms never depend on the content source.
- **Editorial work done in the CMS after cutover** is listed by `cms_audit` (operation, actor, time). Re-key it in legacy, or keep it for the next cutover attempt.
- **Triggers:**
  - preflight failure;
  - any leaked withheld field;
  - more than 1% of ledger URLs returning 404;
  - a 5xx rate above the pre-cutover baseline for 15 minutes;
  - a form submission failure;
  - catalogue counts below expected.

## 10. Capacity measurements (synthetic, in-memory Firestore double, Node 24.20, this workstation)

Records are split evenly into destinations, stays, 7-day tours and three-section blog posts, at realistic text lengths. Timings are relative, not production latency.

| Published records | Entries | Workspace | Reads/RPC cold → warm | `loadContext` / backup response | List RPC cold / warm | Write | Concurrent writers succeeded | 200-tour page |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 200 | 651 | 2.75 MB | 652 → 1 | 2.67 MB / 2.67 MB | 89 / 57 ms | 141 ms | 1 of 5 | 0.54 MB (50 items) |
| 600 | 1,951 | 8.25 MB | 1,952 → 1 | **8.01 MB** / 8.01 MB | 187 / 208 ms | 340 ms | 1 of 5 | 1.62 MB (150) |
| 1,200 | 3,901 | 16.51 MB | 3,902 → 1 | **16.02 MB** / 16.02 MB | 372 / 429 ms | 749 ms | 1 of 5 | 2.17 MB (200 + cursor) |

**Read cost.**
- The Firestore free quota is 50,000 reads per day (pricing page). The per-read price varies by location (owner verification on the Google Cloud pricing table).
- Without the cache, 1,000 staff RPCs per day on a 600-record workspace cost about 1.95 million reads.
- With warm instances, each read RPC costs 1 read plus the occasional full reload after a commit.
- Writes still hydrate the whole workspace, and write time grows linearly with it.

**Launch headroom.**
- Estimate Vion's real size from the content backup file. Below about 3 MB, the buffered path is used; above that, the new streaming path. That path still needs a staging check.
- The next step for growth is scoped repository reads (record-level `get`/`list` from `cms_entries` by key) for read RPCs, then record-scoped versions for writes. Keep the publish transaction, which writes the source record and its public projection together.

**Finance (staged plan; no migration was made).**
1. Add `cms_finance_entries/{id}` with stable UUIDs: trips keep theirs; rows get one at migration, recorded in a map. Keep the original amount strings, currency, exchange rate, converted amount, reference, `version`, `createdBy`/`updatedBy`.
2. A dry-run migration copies the ledger into entries and reconciles: row and trip counts; totals per currency (original and converted); per-trip payments received; and a hash of each row's fields. All must match exactly.
3. Dual-read behind a flag. Writes go to entries with per-entry version checks and a per-entry audit trail. The ledger document is frozen but kept.
4. Rollback: flip the flag back to the ledger document. Remove it only after owner sign-off.

## 11. Owner-run checks before production (pass criteria)

1. **Configuration.**
   - `APP_ORIGIN` is the exact https staging origin.
   - `CRON_SECRET` is set (a missing secret denies the scheduler).
   - `RESEND_*` uses a sending-only key.
   - The service account has only the Firestore and Auth roles the CMS needs.
   - Optional `CMS_REQUIRE_MFA_ROLES` only after MFA enrolment.
2. **Rules:** deploy `firestore.cms.rules` to staging, merged with a default deny. Direct client reads of `cms_public` are denied.
3. **Projection:** `npm run public:reconcile` plan, then `-- --apply` with `CMS_RECONCILE_PROJECT_CONFIRM`, then re-plan reports `create 0, update 0, remove 0`. The public API never returns `internalName` or a hidden phone.
4. **Roles:** sign in as each role and try the denied actions (the server returns 403). Deactivate a user: the next request returns 401/403. The last active admin cannot be demoted.
5. **Booking sync:**
   - Two runs: the second adds 0 and does not change the workspace revision.
   - A booking created with a past client clock is imported on the next run.
   - Integrations shows the last run.
6. **Email:**
   - Queue one notification. It reaches `sent` once.
   - Webhook events update `delivery` and never regress it.
   - A replayed webhook is reported as a duplicate.
7. **Capacity:** open the workspace with production-sized content. If `X-Vion-Streamed: 1` appears, the page still loads, and no `FUNCTION_PAYLOAD_TOO_LARGE` appears in the logs.
8. **Headers:** CMS responses carry `X-Robots-Tag: noindex`. `/api/public/*` caching behaves as intended (F31).
9. **Website:** §7 checks pass.
10. **Recovery:** the §9 restore rehearsal passes and its timing is recorded against the RTO.

**Deployment order.**
1. CMS (backward compatible).
2. Firestore rules.
3. Projection reconciliation.
4. Website with `CMS_PUBLIC_MODE` unset, which still serves legacy content.
5. Preflight.
6. The cutover switch.

## 12. Open items and deferred work

| Item | Priority | Smallest safe next step |
| --- | --- | --- |
| G1–G6 | P0 gates | See §1. |
| Give Back route collision (foundation `/give-back/x` vs story `x`) | P1 | Add a CMS route-claim for `/give-back/<impact slug>` so foundation and story slugs cannot coincide. |
| Scoped reads and record-level versions | P1 | Read RPCs via keyed `cms_entries` lookups; measure with `npm run bench:capacity`. |
| Finance per-entry records | P1 | §10 plan, dry run first. |
| CSP on React pages | P2 | Add a CSP with Firebase Auth `connect-src`; verify sign-in in a browser. |
| Query string on alias 308 | P2 | Only if campaign parameters must survive legacy-URL redirects. |
| Contact messages in the CMS inbox | Owner decision | Read-only importer for `messages`, mirroring booking sync. |
| Dependency advisories | P1/P2 | `npm i sharp@^0.35.5`, `npm audit fix --omit=dev`, `pnpm audit --prod` on the website. |
| Pre-existing e2e failures | P2 | `tests/e2e.mjs` ×2, `daily-costs-e2e.mjs` button style (fail on `7508e4b` too). |
