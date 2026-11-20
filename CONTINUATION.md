# Continuation

Updated 20 November 2026. See [Implementation status](docs/IMPLEMENTATION_STATUS.md) for the latest features and checks, and [Production readiness](docs/PRODUCTION_READINESS.md) for the cutover requirements.

## Where things stand

The CMS and public website development changes include the production-readiness, performance, security and content parity updates. The CMS uses `sharp` 0.35.5. The website lockfile includes the Next.js and sanitization updates. The CMS login code includes an authenticator enrollment and sign-in flow. Verify hosting, revalidation and MFA against staging before enforcing them.

| Repository | Path | Branch |
| --- | --- | --- |
| CMS | `D:/CMS/vion-cms` | `development` |
| Public website | `D:/viona-africa-development` | `development` |

Staging verification and content migration remain pending. See [Performance and security](docs/PERFORMANCE_AND_SECURITY.md) for the benchmark results and configuration notes.

## Decisions to keep

- **Screen data:**
  - Screens get server-computed summaries and pages (`src/review/summary.js`, `src/modules/shared/list-definitions.js`).
  - List definitions (columns, sorts, search) live only in the shared module.
  - The browser-only preview computes the same summaries locally.
- **Public caching:**
  - The CMS public feed is `no-store`; the website's Next.js data cache is the only cache layer.
  - Tags are scoped per CMS origin (`src/lib/cmsCacheTags.js`).
  - Fallback TTL 300 s; hard maximum TTL + 60 s; past it, a failure is an error, never stale content.
  - Invalidations are an outbox job written in the publishing transaction and signed with HMAC (`server/revalidation.mjs`).
- **Record-scoped saves:** only for edits of existing records that keep their slug or path (`server/scoped-writes.mjs`). Everything cross-record keeps the global revision check. Scoped commits still bump the revision.
- **Article images:**
  - Responsive `srcset`/`sizes` matched to the 760 px column, with a 2× density cap for ≥2.5× phones (`PHONE_DENSITY_CAP`).
  - Reserved `width`/`height`, with a 3:2 fallback.
- **Image uploads:** go through `server/image-inspect.mjs` (magic bytes first, unused libvips loaders blocked, pixel limit).
- **Report-only CSP:** for React staff pages via `proxy.ts`. `/workspace` and `/finance` keep their enforced policies.

## Verification (20 November 2026, isolated)

| Suite | Result |
| --- | --- |
| CMS server | 144 passed |
| CMS Chromium browser checks | 55 passed |
| CMS TypeScript | 0 errors |
| Website tests | 128 passed |
| Website JSX syntax | 21 files parsed |

## Staging checks

- Test a published tour, a day trip, and a website booking against staging.
- Verify the revalidation configuration, Firestore region and indexes, report-only CSP, and authenticator enrollment and sign-in.
- Complete the remaining [production readiness gates](docs/PRODUCTION_READINESS.md) before cutover.
