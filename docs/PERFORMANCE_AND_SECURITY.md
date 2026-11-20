# Performance and security: implementation and evidence

## Follow-up — 20 November 2026

- **Website dependencies.** The development worktree now resolves Next.js 15.5.29, sanitize-html 2.18.1, Swiper 12.1.2 and sharp 0.35.5. The public registry audit reports 0 critical, 16 high, 23 moderate and 9 low advisories. The remaining advisories need reachability and patch review. The website declares Node 22.12 or newer for the sanitizer. The pnpm build policy retains the prior allowlist explicitly.
- **Website verification.** An isolated frozen install passed with pnpm 11.25.0, as did 123 website tests. A Chrome carousel fixture passed next-button navigation, keyboard navigation and pagination. Verify actual carousels and the production build on staging.
- **CMS MFA.** The staff sign-in screen now supports authenticator setup and TOTP challenges. Setup uses the existing verified staff session flow and clears the CMS session before showing the setup key. The key stays in the current page and is entered manually into the authenticator app. Completing setup returns staff to sign-in. Type checking, 142 isolated server tests and two mocked Chrome journeys passed. MFA enforcement remains off.
- **Owner staging order.** Enable TOTP in the staging Firebase Identity Platform configuration and verify the accounts' email addresses. Before setting `CMS_REQUIRE_MFA_ROLES`, enrol and sign in with at least two staging administrators, enrol the accounting users targeted by the policy, and rehearse account recovery. Keep the CSP in report-only mode for the auth check. Verify the deployed article cache, and confirm Firestore location before selecting a Vercel region.
- This follow-up contains source changes and isolated verification. No commit, push, deployment, live provider check or database change was made.

Updated 20 November 2026. Audience: the owner and the Vion Codex session. This builds on [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md); its release gates G1–G6 stay open until verified independently. Raw benchmark and audit output is in [benchmarks/2026-11-20/](benchmarks/2026-11-20/).

## Status

| Area | Status | Reason / pass criteria |
| --- | --- | --- |
| 1. Dashboard and list payloads | **Implemented and verified** (lab), live latency awaiting staging | One summary request; bounded list pages. Pass on staging: the dashboard makes one data request besides the account profile, and `/api/rpc` responses stay under 20 KB at production size. |
| 2. Public caching and freshness | **Implemented and awaiting staging** | Contract tested against an emulation of the Next 15 data cache. Needs `WEBSITE_REVALIDATE_URL` and `CMS_REVALIDATE_SECRET` configured. Pass: §2 checks. |
| 3. Mobile images and page stability | **Implemented and verified** (browser lab), real-user metrics awaiting deployment | Pass: CLS 0 and the image byte reductions below reproduce on staging; Speed Insights or CrUX after release. |
| 4a. CMS `sharp` advisory | **Implemented and verified** | `sharp` 0.35.5 (libvips 8.18.7) locked; image tests pass. |
| 4b. Website dependency advisories | **Blocked** | Next 15.5.22 has 3 critical advisories. The pnpm lockfile must be updated with pnpm, which is unavailable here. Owner command in §4. |
| 4c. MFA for admin and accounting | **Server side verified with mocks; enforcement blocked** | The login page has no second-factor step, so enrolled users could not sign in. Next step in §4. |
| 4d. Report-only CSP for React staff pages | **Implemented and awaiting staging** | Pass: two weeks of reports with no unexplained violations, then switch to enforcing. |
| 5a. Record-scoped saves (first slice) | **Implemented and verified** | Different-record edits 100/100 succeed (was 50/100); same-version edits give 1 success and 1 stale conflict per pair. |
| 5b. Database region and function placement | **Blocked** | Needs the owner-reported Firestore location. Mapping and the check are in §5. |
| 5c. Index exemptions | **Implemented and awaiting owner deploy** | `firestore.indexes.json`. Pass: `firebase deploy --only firestore:indexes` succeeds, and the staging smoke tests still pass. |

## Method and boundaries

- **No private data or live services.** No `.env*`, credentials, package-manager credentials or live or staging Firebase were accessed. No Next build, dev or start was run. Provider settings are unchanged, and nothing is committed or deployed.
- **Fixtures.** Persistence is the in-memory Firestore double (`server/tests/support/fake-firestore.mjs`). It applies Firestore's optimistic transaction model: read-set validation, retry, atomic apply. Synthetic workspaces come from `tools/bench-fixtures.mjs`, at the 200/600/1,200-record sizes used in the readiness report, plus one booking per record and one quotation per ten records.
- **Browser lab.** Headless Chrome via Playwright 1.63 on the same machine, Node 24.20. The screen bench answers `/api/rpc` with the real `execute()` pipeline in-process: 7 full page loads per screen; p50/p95 shown. The image bench answers Cloudinary with a local `sharp` stand-in serving JPEG at quality 78. Real `f_auto,q_auto` delivery would make *both* before and after smaller.
- **Network for dependency checks.** Clean npm config files (empty user and global), the public registry, and `--ignore-scripts`. Advisory lookups sent only package names and versions.
- **Not live evidence.** Lab and emulator numbers show relative change. They are not production speed, real-user metrics or verified provider behaviour.

## 1. Dashboard and list payloads

**Before.** The dashboard fetched the whole content context, all bookings, all private operations and all editorial documents, then counted in the browser. Catalogue lists fetched the whole workspace context.

**Now:**
- **`ws.summaries.dashboard({timeZone})`.** One request, computed where the data lives (`src/review/summary.js`; server through `execute()`, the browser in the local preview). It returns:
  - counts, plus the six-month chart in the viewer's time zone (the previous behaviour);
  - six recent bookings (name, arrival, guests, status) and four arrivals in the next 14 days (EAT);
  - four team members, the draft count, and report totals (quote value per currency, incomplete quotations).
- **Role rules on the server.** Booking and quotation data appears only for admin and reservations (others get zero counts and no rows, as before). Staff directory entries are counted only for admins. Accounting is refused.
- **Paged lists.** `cataloguePage` (Destinations, Accommodations, Tours, Day trips; 50 per page), `bookingPage` (50), `mediaPage` (Gallery, 24, with per-image usage) and `editorialPage` (Blogs and every editorial list, 12 per page with page numbers, as before).
- **What pages carry.** Only the displayed columns, the filtered total, and per-status counts across all records (so the "N shown · M total (…)" line is unchanged).
- **Search, filter and sort.** All server-side, using the same rules as before. The shared definitions live in `src/modules/shared/list-definitions.js` and are the single source for both browser and server.
- **Stable cursors.** A cursor carries the last row's sort fields, and every sort ends with title then ID. Pages stay correct through ties and through records added between page requests, with no duplicates.
- **UI states.** Searches are debounced by 250 ms. A response that arrives after a newer request is discarded. Each list has loading, failed-with-"Try again" and empty states, plus "Show more (N more)".
- **Unchanged.** Direct editor links, status filters, sorts, navigation and quick actions.
- **Exports on demand.** The private bookings export fetches the full register only when someone clicks it.
- **Offline preview.** The browser-only preview computes the same summaries locally.

**Measured** (clean back-to-back run: the baseline UI exported from `65d78cf` against the current UI, same server pipeline and fixtures, 7 loads each):

| Records | Screen | Requests | Bytes | p50 / p95 |
| --- | --- | --- | --- | --- |
| 200 | Dashboard | 5 → 2 | 3.52 MB → 1.9 KB | 1,480 / 1,579 → 1,436 / 1,576 ms |
| 200 | Destinations | 2 → 2 | 2.67 MB → 14.8 KB | 1,534 / 1,604 → 969 / 1,446 ms |
| 600 | Dashboard | 5 → 2 | 10.56 MB → 1.9 KB | 3,315 / 3,504 → 1,440 / 1,482 ms |
| 600 | Destinations | 2 → 2 | 8.01 MB → 15.2 KB | 2,363 / 2,881 → 1,463 / 1,605 ms |
| 1,200 | Dashboard | 5 → 2 | 21.13 MB → 2.0 KB | 4,866 / 6,283 → 2,621 / 2,891 ms |
| 1,200 | Destinations | 2 → 2 | 16.02 MB → 15.2 KB | 3,035 / 3,629 → 2,081 / 2,805 ms |

- **What the requests are.** The remaining non-summary request is `review.profile` for the account menu, which already existed.
- **Server cost.** Still grows with the workspace, because each summary hydrates the in-memory domain. A warm instance reads one Firestore document (revision cache), not the whole workspace.
- **Tests.** `server/tests/summaries.test.mjs` (8):
  - equality with the previous full-data calculation;
  - time-zone month boundaries;
  - a bounded size as fixtures grow (the old data was over 100× larger);
  - role isolation;
  - every status and sort reproducing the previous order with no duplicates;
  - tie and insert stability, and cursor validation;
  - bookings, gallery and editorial paging;
  - local-preview parity.
- **Browser regression suites unchanged:**
  - cloud UI 57/57;
  - inline accommodation 25/25;
  - local unit 94/94;
  - review 97/97;
  - full local e2e 53 with the same 2 failures that predate this work.
- **Not converted:** Team, Taxonomies, Quotations, Redirects and the local site preview still use their existing data path.
- **Rollback.** Revert the listed UI modules. The server summaries are additive, and the old RPC methods are unchanged.

## 2. Public caching and publication freshness

**Design: one cache layer, at the website.**
- **The CMS feed is not cached** (`/api/public/*` sends `Cache-Control: no-store`, plus `X-Vion-Generated-At`). A CDN copy there would let an invalidated website read stale data back.
- **The website caches CMS responses in the Next.js data cache:**
  - **Tags** (`src/lib/cmsCacheTags.js`): `cms:<origin hash>`, `…:path:<cms path>` and `…:kind:<kind>`. Separate origins never share entries. Legacy reads use other URLs and no tags.
  - **Fallback TTL:** `CMS_FEED_TTL_SECONDS`, default 300; `0` restores the previous `no-store` behaviour.
  - **Hard maximum age:** a response generated more than TTL + 60 s ago is refetched with `no-store`. If that refetch fails, the page errors; it never shows the old copy.
- **Invalidation contract** (CMS `server/revalidation.mjs`, website `src/app/api/cms/revalidate/route.js`):
  - **What triggers it:** a committed publish, unpublish, rename/redirect or settings change writes an outbox job **in the same transaction** as the public projection change. Draft saves change nothing public and write no job.
  - **Delivery:** the job is sent after the response via Next `after()`; the scheduler retries due jobs (30 s doubling to 1 h, up to 8 attempts). Stuck jobs return to the queue after their lease. A rejected signature (401) fails permanently.
  - **Request format:** `POST` with `X-Vion-Signature: t=<unix>,v1=<HMAC-SHA256("t.body")>` using the shared secret `CMS_REVALIDATE_SECRET`, server-only on both sides. It is not a deployment credential.
  - **What the website does:** accepts signatures for ±5 minutes and bodies up to 64 KB with at most 500 paths. It calls `revalidateTag` for each path and kind tag, and `revalidatePath('/sitemap.xml')` for blog, destination, tour and day-trip changes.
  - **Large changes** (over 500 paths) expire everything from that CMS origin. `npm run public:reconcile -- --apply` also queues an invalidation.
- **Next 15.5.22 behaviour this relies on**, read in the installed source:
  - only HTTP 200 fetches are cached (`server/lib/patch-fetch.js:624`);
  - a revalidated tag makes the entry a miss, not stale (`server/lib/incremental-cache/index.js:345-352`);
  - an expired entry is served while it refreshes in the background (`patch-fetch.js:707-728`; this is why the hard maximum exists);
  - `revalidateTag(tag)` takes one argument (`server/web/spec-extension/revalidate.js:38`).
  - **Owner verification required:** Vercel's data cache implements the same semantics.

**Freshness bounds:**

| Case | Bound |
| --- | --- |
| Invalidation delivered | The next request after it fetches fresh. No TTL wait. |
| Cold cache | First request fetches; later requests are cached. |
| Invalidation lost (website down, wrong secret) | Up to the TTL (300 s), plus one request that may get the old copy while it refreshes. Never past TTL + 60 s (360 s). |
| Unpublish or visibility change | Immediate expiry via the path tag. A 404 is never cached, so a later re-publish also shows at once. |
| CMS outage | Withdrawn (invalidated) or over-age content gives HTTP 500. Within the TTL, the normal cached copy continues. |

**Measured** (emulator, website `tests/cms-cache.test.mjs`, 13 tests):
- **Repeated reads:** 10 detail plus 10 list renders cost **2** CMS requests. With `CMS_FEED_TTL_SECONDS=0` (the previous behaviour) the same renders cost 20, because each read is `no-store`.
- **Publish → visible:** 0 TTL wait; the next read makes exactly one fresh request per cached response.
- **Unpublish:** a 404 on the next read, with no cached copy.
- **Redirect change:** a 308 on the next read.
- **Lost invalidation:** the old copy is served until 300 s, refreshed at 301 s, and hard-capped at 360 s.
- **Outage:** withdrawn and over-age content surfaces as errors.
- **Invalidation endpoint:** signature checks, expiry, malformed bodies, the 500-path limit and a missing secret are all handled.
- **Rollback and separation:** legacy mode makes zero CMS requests; origins stay separate.
- **CMS side** (`server/tests/revalidation.test.mjs`, 5 tests): a shared signature test vector, jobs for publish, rename and unpublish, none for drafts or an unconfigured website, kind-level jobs for large changes, and the retry, permanent-failure and lease rules.

**Owner configuration (staging first):**
- **CMS:** `WEBSITE_REVALIDATE_URL=https://<staging site>/api/cms/revalidate` and `CMS_REVALIDATE_SECRET=<random 32+ bytes>`.
- **Website:** the same `CMS_REVALIDATE_SECRET`, plus optional `CMS_FEED_TTL_SECONDS`.

**Owner checks:**
1. Publish a change and reload the page within 5 s. **Pass:** the new content shows, and the website log shows `/api/cms/revalidate` 200.
2. Unpublish. **Pass:** an immediate 404.
3. Set a wrong secret on the CMS and publish. **Pass:** a 401 in the website log, and the change still appears within 6 minutes.
4. Stop the CMS. **Pass:** an unpublished or over-age page returns 500, not old content.
5. Save a draft only. **Pass:** the public page is unchanged and no job is written.

**Rollback:** `CMS_FEED_TTL_SECONDS=0` (no caching) or `CMS_PUBLIC_MODE=legacy`.

## 3. Mobile images and page stability

**What changed:**
- **Responsive figures:** article figures (`src/lib/server/cmsCollections.js`) get Cloudinary `srcset` candidates of 320/480/640/800/1,080/1,520 px. Candidates never exceed the original's width; a 900 px original offers 900w.
- **`sizes` matched to the column:** 760 px maximum, 16 px gutters below 640 px and 32 px above. Paired section photos ask for half the column. The odd last photo of a section, and standalone photos, use the full width.
- **Reserved space:** `width` and `height` come from stored media dimensions. Older images without dimensions reserve a 3:2 box.
- **Unchanged:** lazy loading, alt text, captions, section order and the 640 px mobile stacking.
- **Phone density cap:** phones with screens of 2.5× density or more are deliberately served about 2× density, via the first `sizes` entry. Remove `PHONE_DENSITY_CAP` to give them full density.
- **Sanitiser** (`src/lib/sanitizeArticleHtml.js`):
  - `srcset` is kept only when every candidate is `https://res.cloudinary.com/… Nw`;
  - `sizes` only alongside a valid `srcset`;
  - `loading` and `decoding` only with their valid values; numeric `width`/`height` only;
  - legacy `src` handling unchanged.
- **Detail pages** get the referenced images embedded in the same feed response (`include=media`), so they no longer need one request per image.

**Measured** (browser lab, `scripts/bench-article-images.mjs`; the same synthetic long article with 22 images, scrolled to the end):

| Profile | Image bytes | CLS | Requested widths | Images with reserved size |
| --- | --- | --- | --- | --- |
| Phone 390×844 @3× | 1,719,038 → **1,101,698** (−36%) | 0.0191 → **0** | 1,000 → 800 | 0 → 22 of 22 |
| Desktop 1440×900 @1× | 1,719,038 → **506,787** (−71%) | 0 → 0 | 1,000 → 480 (pairs) / 800 (full) | 0 → 22 of 22 |

- **Without the density cap**, the phone requested 1,080 px and transferred 1,997,779 bytes, 16% *more* than before. That is why the cap exists.
- **Tests:** `tests/cms-article-images.test.mjs` (4) and the updated `tests/cms-article-sections.test.mjs`.
- **Unchanged:** CMS gallery thumbnails and upload validation.
- **Real-user metrics** are not measured. Use Vercel Speed Insights or CrUX after deployment.

## 4. Staff security and dependencies

### `sharp` (CMS)

The official advisories:
- **GHSA-f88m-g3jw-g9cj** (libvips): fixed in 0.35.0.
- **GHSA-rgj7-g3m4-5g8c** (libheif, HEIF/AVIF; possible RCE on glibc Linux): fixed in 0.35.4.
- **GHSA-wq5f-xc86-pv6w** (librsvg, SVG): fixed in 0.35.5.

They affect anyone decoding untrusted images.

**What was done:**
- **Upgrade:** the CMS now locks `sharp` 0.35.5 (libvips 8.18.7). Next 16.4.5 declares `^0.35.5` and shares it. Every platform binary, including `linux-x64`, is in the lockfile.
- **Hardening** (`server/image-inspect.mjs`, used by both upload paths):
  - the JPEG/PNG/WebP magic-byte check runs before any decode;
  - unused libvips loaders are blocked (HEIF, SVG, GIF, TIFF, VIPS and others);
  - an explicit 40-megapixel check (0.35.5 also enforces it in `metadata()`);
  - animated and multi-page images are rejected.
- **Tests** (`server/tests/image-security.test.mjs`, 5):
  - JPEG, PNG and WebP accepted;
  - SVG, GIF, AVIF and junk rejected;
  - the blocked SVG loader refuses to decode even when called directly;
  - 10 MB and 48-megapixel limits;
  - Cloudinary verification with a mock covering wrong format, oversize dimensions, a foreign delivery host, mismatched bytes, oversize downloads and HTTP 404.
- **Guest PDFs** are generated in the browser without `sharp`, so they are unaffected.
- **Remaining `npm audit --omit=dev`:**
  - **4 high:** the `@grpc/grpc-js` chain under the browser `firebase` SDK. The advisories concern gRPC servers, and the CMS imports only `firebase/app` and `firebase/auth`. Not reachable. Owner: take the upstream Firebase update when published.
  - **6 moderate:** `glob`/`minimatch` via `rimraf` under `gaxios`/`google-gax`. Only exploitable with attacker-controlled glob patterns, so not reachable. `npm audit fix` would *downgrade* `google-gax` 5.0.8 → 5.0.4 in the Firestore client, so it was declined and reverted.

### Website dependencies (blocked: pnpm required)

Public advisory lookup for the resolved lockfile: 66 advisories (4 critical, 26 high, 27 moderate, 9 low). Full list: `benchmarks/2026-11-20/website-advisories.json`. Priority:
- **`next` 15.5.22, critical:**
  - Image Optimization API RCE with AVIF (GHSA-2xp9-vwfh-vxw4) and with SVG (GHSA-2464-fhr4-w9xw);
  - RCE on Windows hosts (GHSA-p293-qw3h-jr36);
  - plus a high: Server Actions denial of service (GHSA-p3m5-59mp-jv5r);
  - plus moderate ISR cache poisoning.
  - **Target `next@15.5.29`** (latest 15.5; every listed advisory is fixed after 15.5.27).
- **`sharp` 0.34.5** (Next's optional dependency): add a pnpm override to `^0.35.5`. Next 15.5.28+ accepts `^0.34.3 || ^0.35.5`, so without the override it may stay on 0.34.
- **`swiper` 11.2.10, critical prototype pollution** (fixed in 12.1.2, a major upgrade): test the carousels.
- **`sanitize-html` → 2.18.1** (moderate). `undici` comes through the Firebase SDK; the Firebase update fixes it.

**Owner command** (in the website development worktree, then the website tests and a build on staging):

```
pnpm add next@15.5.29 sanitize-html@^2.18.1
# package.json → "pnpm": { "overrides": { "sharp": "^0.35.5" } }
pnpm install
```

**Reachability:** the site runs on Vercel's Linux functions, not Windows. Whether `/_next/image` is served by Vercel's own optimiser or the app's needs owner verification. Upgrade regardless.

### MFA (`CMS_REQUIRE_MFA_ROLES`)

**Tested with mock sessions** (`server/tests/mfa-session.test.mjs`, 7):
- admins and accounting are refused without a second factor; other roles are unaffected;
- the same check applies at sign-in (from the ID token);
- enforcement is off unless configured;
- a promotion requires a new MFA sign-in on the next request; a demotion or deactivation applies at once; revoked sessions are rejected;
- recovery works through a second enrolled admin, or by narrowing the setting.
- MFA never changes staff records: a sole unenrolled admin is locked out, not removed. `actorFromToken` moved to `server/session.mjs`, which has no Next imports, so it can be tested.

**Blocked:**
- **What's missing:** the login page (`app/login/page.tsx`) calls `signInWithEmailAndPassword` and turns every error into "Unable to sign in". A user with an enrolled factor receives `auth/multi-factor-auth-required` and cannot finish signing in. There is also no enrolment screen.
- **Next step:** add a TOTP second-factor step to the login page (`getMultiFactorResolver` + `TotpMultiFactorGenerator.assertionForSignIn`) and a "Set up authenticator" page (`TotpMultiFactorGenerator.generateSecret`, `multiFactor(user).enroll`). Verify both with Identity Platform on staging.

**Staged plan** (staging, then production; never enable in production first):
1. Enable Identity Platform with TOTP MFA.
2. Ship the two UI pieces above.
3. Enrol **at least two** admins and every accounting user.
4. Set `CMS_REQUIRE_MFA_ROLES=admin,accounting`.
5. Check:
   - an enrolled admin signs in;
   - an unenrolled admin gets `mfa-required`;
   - promoting a user forces re-sign-in with the factor.

**Recovery:**
- an enrolled admin manages staff;
- an admin who loses their factor is unenrolled in the Identity Platform console, then re-enrols;
- as a last resort, the owner removes `admin` from the setting and redeploys.

### Report-only CSP (React staff pages)

**What was added:**
- **`proxy.ts`** (Next 16 convention, Node runtime) sets `Content-Security-Policy-Report-Only` with a per-request nonce for `/`, `/login`, `/setup`, `/staff` and `/integrations`. The root layout calls `connection()`, so those pages render per request and Next applies the nonce.
- **The policy** (`server/csp.mjs`):
  - nonce-based `script-src` with `'strict-dynamic'`;
  - `style-src` with the nonce, and `style-src-attr 'unsafe-inline'` for React style props;
  - `connect-src` limited to Firebase email/password sign-in (`identitytoolkit.googleapis.com`, `securetoken.googleapis.com`; the emulator origin only when configured);
  - images from self, `data:`, `blob:` and Cloudinary;
  - `frame-src`, `object-src` and `base-uri` set to `'none'`; `frame-ancestors 'none'`.
  - No wildcards. No `unsafe-eval` outside development.
- **Unchanged:** the enforced policies on `/workspace` and `/finance`.
- **Reporting:** reports go to `/api/csp-report`, at most 16 KB. Only the directive, the blocked resource's origin and the page path are logged.
- **Google sign-in** does not exist in the code, so no Google or Firebase auth-iframe origin is allowed. Reports will show what to add if it is introduced.

**Staging checks:**
1. Sign in with email and password.
2. Use `/staff` (invite, role change) and `/integrations` (sync, process queue).
3. Read the logs for `CSP report-only violation`. **Pass:** none except explained ones.
4. After two clean weeks, rename the header to `Content-Security-Policy` in `proxy.ts`.

## 5. Database region and independent saves

**Paths most sensitive to Firestore round-trip time:**
- **Every staff request:** session verification (`verifySessionCookie` with a revocation check, plus one `cms_staff` read).
- **Every RPC:** a snapshot (one control read when warm, the whole workspace when cold).
- **Every save:** a commit transaction (the control document, plus the record preconditions on the scoped path).
- **Single-entry reads:** media display redirects.
- **The public feed:** one read, plus a batched media read.
- **Scheduled jobs:** booking sync and the email and revalidation outboxes.

**Region (blocked on the owner):**
- **Facts:**
  - Vercel functions default to `iad1` (Washington, DC) for new projects; Hobby allows one region, Pro five.
  - The only African Vercel region is `cpt1`.
  - Firestore offers `eur3` (Belgium/Netherlands), `nam5` (Iowa) and `africa-south1` (Johannesburg), among others.
- **Placement to verify:**
  - `eur3` or `europe-west1/4` → `cdg1`, `dub1` or `fra1`;
  - `europe-west2` → `lhr1`;
  - `nam5` → `iad1` or `cle1`;
  - `africa-south1` → `cpt1`.
- **Set** `"regions": ["<code>"]` in `vercel.json` only after the owner confirms the Firestore location.
- **Check:** compare `Server-Timing` on a warm `/api/rpc` read before and after. **Pass:** p50 improves and no errors appear.

**Index exemptions** (`firestore.indexes.json`, owner deploys). Every field below is never filtered or sorted on; the query inventory is `server/*`, `app/api/*` and `tools/*`.

| Collection | Field | Why it is safe to exempt |
| --- | --- | --- |
| `cms_entries` | `json` (up to 800 KB) | Only read by document ID or an unfiltered scan. |
| `cms_public` | `data` (map) | Queried by `kind` and document ID only. |
| `cms_email_jobs` | `html` | Queried by `status`, `resendId` and `createdAt`. |
| `cms_received_email` | `text`, `attachments` | Ordered by `receivedAt` only. |
| `cms_finance` | `rows`, `trips` | Single-document get. |
| `cms_revalidate_jobs` | `paths` | Queried by `status`. |

**Record-scoped saves (first slice):**
- **Eligible operations** (`server/scoped-writes.mjs`):
  - `content.saveDraft` on an existing destination, stay, tour or day trip with an unchanged slug;
  - `review.save` on an existing editorial document with an unchanged path and status.
- **How the commit works** (`persistence.commitScoped`): it requires the record, and every image, related record, taxonomy term or editorial document the edit *newly* references, to be exactly as read. It still advances the workspace revision, so snapshot caches and every whole-workspace writer see the change.
- **Still on the whole-workspace guard:** new records, slug and path changes (route claims), publish, unpublish, archive, media, taxonomy, settings, bookings, operations, imports and restores.
- **Point reads:** `content.get`, `content.getPublished`, `bookings.get`, `operations.get` and `review.get` read one stored entry with no workspace snapshot. Role checks are unchanged.
- **Losing edits:** a stale save keeps them in the form, and the editor offers "Reload latest version", as before.

**Measured** (`tools/bench-concurrency.mjs 50`; in-memory double, 2 instances saving at once):

| Path | Different records | Same record (success / stale) |
| --- | --- | --- |
| Previous (global) | 50 of 100 succeed | 50 / 50 |
| Scoped | **100 of 100** succeed | 50 / 50 |

- **Latency** was comparable between paths: 38–41 ms p50 in this run, varying a few ms between runs.
- **Concurrent creation** of *new* records still serialises (1 of 5 in `bench:capacity`), by design.
- **Tests** (`server/tests/scoped-writes.test.mjs`, 9):
  - parallel different-record edits;
  - one stale conflict for the same record version;
  - concurrent renames to one slug (one wins);
  - publish versus edit;
  - an image newly referenced while it is removed (the reference is rejected), and the reverse (removal blocked);
  - a failed multi-record save writes nothing;
  - editorial parallel saves and the path-change guard;
  - point reads with role checks;
  - dashboard and list freshness across cached instances.

**Rollback:** remove `commitScoped` from the default persistence passed by `execute()`, and every save returns to the global path.

**Finance:** unchanged. The per-entry migration plan stays separate (PRODUCTION_READINESS §10).

## Commands run and results

| Command | Result |
| --- | --- |
| CMS `node --test server/tests/*.test.mjs` | **142 passed** (108 previous + 34 new: summaries 8, scoped writes 9, revalidation 5, MFA/CSP 7, image security 5) |
| CMS `node tools/prepare-cloud.mjs`, then `tests/editor-and-cost-copy-e2e.mjs` / `tests/inline-accommodation-e2e.mjs` | 57 / 25 passed |
| CMS `tests/run-headless.mjs` / `tests/review-e2e.mjs` (local preview on port 5181) | 94 / 97 passed |
| CMS `tests/e2e.mjs` | 53 passed, 2 failed. Both failures predate this work: the dashboard expects 6 quick actions but there are 7; and the duplicate "Settings" locator. |
| CMS `tests/daily-costs-e2e.mjs` | Stops at the known button-style check after 5 passes (fails on `7508e4b` too) |
| CMS `tsc --noEmit` | 0 errors |
| CMS `node tools/bench-screens.mjs 200,600,1200 7` (baseline UI from `git archive 65d78cf`, then current) | Table in §1 |
| CMS `node tools/bench-concurrency.mjs 50 global` / `… scoped` | Table in §5 |
| CMS `node tools/bench-capacity.mjs 200,600` | Warm reads 1 per RPC; unchanged sizes |
| CMS `npm install sharp@^0.35.5 --ignore-scripts` (clean config) | 0.35.5, libvips 8.18.7 |
| CMS `npm audit --omit=dev` | 10 (4 high, 6 moderate), none reachable (§4) |
| Website `node --test --import ./tests/support/register.mjs "tests/**/*.test.mjs"` (temporary `node_modules` junction to `D:/viona-africa/node_modules`, removed after) | **123 passed** (106 previous + 17 new: cache 13, images 4) |
| Website `node --import ./tests/support/register.mjs scripts/bench-article-images.mjs` | Table in §3 |
| Website advisory lookup (npm bulk endpoint, package names and versions only) | 66 advisories (§4) |

**Not run:**
- Next build, dev or start, and every provider-connected check.
- `operations-e2e.mjs` (port 5173).
- pnpm (not installed).
- Real-user metrics.

## Changed files (this pass)

**CMS.**
- **New server modules:** `server/scoped-writes.mjs`, `server/revalidation.mjs`, `server/session.mjs`, `server/csp.mjs`, `server/image-inspect.mjs`.
- **New shared and app files:** `src/review/summary.js`, `src/modules/shared/list-definitions.js`, `proxy.ts`, `app/api/csp-report/route.ts`, `firestore.indexes.json`.
- **New tools:** `tools/bench-fixtures.mjs`, `tools/bench-screens.mjs`, `tools/bench-concurrency.mjs`.
- **New tests:** `server/tests/{summaries,scoped-writes,revalidation,mfa-session,image-security}.test.mjs`.
- **New docs:** `docs/benchmarks/2026-11-20/*`, this document.
- **Edited server modules:** `server/{persistence,execute,publication,public-feed,policy,domain,auth,media,direct-media}.mjs`.
- **Edited test support:** `server/tests/support/fake-firestore.mjs`, `server/tests/access-matrix.test.mjs`.
- **Edited routes and app shell:** `app/api/{public/content,public/catalogue,rpc,cron}/route.ts`, `app/layout.tsx`.
- **Edited config and tooling:** `next.config.mjs`, `firestore.cms.rules`, `tools/reconcile-public.mjs`, `cloud/remote-workspace.js`, `package.json`, `package-lock.json`.
- **Edited UI:**
  - `src/review/{workspace-views,views}.js`;
  - `src/modules/{list-view,bookings-view,media-library-view,destinations,accommodations,tours,day-trips}.js`;
  - `src/storage/workspace.js`.

**Website.**
- **New:** `src/lib/cmsCacheTags.js`, `src/lib/server/cmsRevalidate.js`, `src/app/api/cms/revalidate/route.js`, `scripts/bench-article-images.mjs`, `tests/cms-cache.test.mjs`, `tests/cms-article-images.test.mjs`.
- **Edited:** `src/lib/server/{cmsPublic,cmsCollections,cmsDestinations,cmsSiteSections}.js`, `src/lib/sanitizeArticleHtml.js`, `tests/cms-article-sections.test.mjs`.

## Owner-run staging checks (summary)

1. **CMS:** deploy with the new lockfile. **Pass:** uploads of JPEG, PNG and WebP work, and SVG/GIF/HEIC are rejected.
2. **Website:** run the dependency commands in §4, the tests and a build.
3. **Caching:** configure the revalidation secret and URL on both apps, then run the §2 checks.
4. **CSP:** collect report-only CSP reports for two weeks (§4).
5. **Lists and dashboard:** on production-sized content, check that dashboard and list responses stay under 20 KB (`X-Vion-Response-Bytes`).
6. **Region:** report the Firestore location; set `vercel.json` `regions`; compare `Server-Timing`.
7. **Indexes:** deploy the field overrides.
8. **MFA:** after the login and enrolment UI exists, follow the staged plan in §4.
