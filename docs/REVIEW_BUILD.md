> 7 November 2026: the new server application is documented in [Cloud implementation](CLOUD_IMPLEMENTATION.md). This document retains the approved browser-preview/history context.

# Vion CMS — complete local review build

Updated 6 November 2026. This is the current implementation guide; earlier phase documents remain historical evidence.

## Start and open

From a terminal:

    cd D:\CMS\vion-cms
    python tools/serve.py 5173

Open http://127.0.0.1:5173/#/dashboard. Keep the terminal open; Ctrl+C stops it. Alternatively double-click start-local.cmd. The no-cache server avoids mixed old/new ES modules. Direct file:// opening is unsupported. Ctrl+F5 refreshes a running copy.

## Layout

The 5 November screenshot supplied by the owner guided the narrow white sidebar, rounded outer shell, pale canvas, compact header, pastel metric cards, booking chart, analysis links, table and right-hand cards. Vion's own logo and gold actions are retained. There are no copied Niond branding, upsell prices, sample revenue or invented staff photos. The desktop sidebar is sticky; on phones it is a controlled drawer with an overlay.

The dashboard now reads saved local bookings, quotations, published catalogue/editorial records and team profiles. The monthly chart and reports use actual local requests. Quoted amounts are proposed prices, never reported as received revenue, and currencies are not mixed. Empty data shows real empty states.

## Every visible sidebar page

| Section | Working pages |
| --- | --- |
| Dashboard | Live local overview and quick actions |
| Tour Packages | Tour list/add, day-trip list/add, managed taxonomies |
| Destinations | List/add, media/SEO, optional private park rates |
| Accommodations | List/add, media/SEO, private general and room-specific STO |
| Bookings | Requests/detail/edit, booking PDF, quotation, website connection |
| Safari Proposals | Top itineraries, quotation list/create, private cost copies and guest PDF |
| Blogs | Posts, post creation, categories |
| Users | Internal staff directory with role descriptions and active state |
| Media Library | Shared upload/search/metadata/usage-protected gallery |
| Migration | List/add phases, month mapping, area/narrative/map coordinates |
| Giving Back | Impact stories and foundation profiles |
| Settings | Company/brand/SEO settings, team, reports, activity, backups, redirects, guide |
| Content | Website pages, experiences, FAQs and navigation |

Messages, Email Subscribers and Vehicles remain removed as previously requested. All visible navigation points to working screens; old placeholder URLs resolve to the corresponding working route where possible. Unknown/removed paths show a real not-found screen.

## Routes

- #/dashboard
- #/tours, #/tours/new, #/tours/{id}; same list/new/id pattern for destinations, accommodations and day-trips
- #/blogs, #/categories, #/migration, #/impact, #/foundations, #/users, #/pages, #/experiences, #/faqs, #/menus
- New editorial records: #/{module}/new; editor #/{module}/{id}; published preview #/{module}/{id}/preview
- #/top-itineraries, #/bookings, #/bookings/new, #/bookings/{id}, #/bookings/connect
- #/quotations, #/quotations/new, #/quotations/{id}; ?tour={localTourId} copies an itinerary template
- #/rates/accommodation/{id}, #/rates/destination/{id}, #/costing/tour/{id}
- #/settings, #/team, #/media, #/taxonomies, #/reports, #/activity, #/profile, #/help, #/backup, #/redirects
- #/site: published local website; catalogue hubs and details; /blog, /faqs, /experiences, /give-back, /tanzania-migration; published page paths; team

## Remaining-module fields and workflows

Definitions are in src/review/model.js, structural schema in schemas/editorial.schema.json. Fields are proposed replacement behaviour, informed by the audit and approved scope; they do not claim to reproduce unseen original forms.

Blog: title/slug, managed category, topics, date, excerpt, body, shared-library cover/alt, author and SEO. Category must be published before a blog post can be published; a category used by published posts cannot be unpublished/archived first.

Migration: phase name/slug, months 1–12, area, overview, what happens, safari experience, guide notes, coordinates, image/alt and display order. Published phases cannot overlap months. Published month selection displays the relevant phase; map links use the provided coordinates, without fabricated locations.

Impact: title/slug, programme, summary/body/date, image/alt and SEO. Foundation profiles: name/slug, summary/body/mission/programmes, HTTPS website and image/SEO.

FAQs: question, answer, display order and public-path placements. Empty placements mean the main FAQ page. Explicit placements show questions on those published pages; /faqs may be included explicitly. Public FAQ search and accordions work.

Experiences: title/slug, summary/overview, location/format/pace/seasons, ordered visit sections, inclusions/exclusions/preparation, image/alt and SEO. Include-experience links prefill a local booking request.

Pages: title, exact path, introduction, typed ordered sections (text, hero, CTA, facts or FAQ), image/alt and SEO/noindex. Create standard page drafts explicitly adds missing drafts for Home/About/Contact/Plan/Privacy/Cookies/Give Back/Zanzibar/Climbing. Existing pages are kept; no copy or legal promises are invented or auto-published. Catalogue hub previews keep their listings/search when editorial content is supplied.

Navigation: named group, Header/Footer/Planning placement, ordered labelled links and display order. Public local preview uses the published menu snapshot; footer placement appears in the footer. Links accept safe internal paths or HTTPS only.

Staff directory: name/email/phone, role description, notes and active state. Internal only; no public publishing. This directory does not create Firebase accounts, send invitations or enforce access permissions. Actual multi-user identity/roles remain a production integration dependency.

Lists have search, status filter, deterministic sorting, pagination, duplicate and archive/restore. Editors have validation, save status, unsaved-change guards, shared image picking, repeaters with keyboard movement, local draft/published previews and search previews. Saving draft edits never silently changes the published snapshot. Archive is reversible; there is no permanent content deletion. Public paths remain reserved across rename/archive. Historical paths resolve to current published content only in the local preview; real 308 redirects require production integration.

Top itineraries use saved tour records and featured/rank values, allow draft edits and create quotation copies. Profile edits local display preferences; End review session leaves a resumable local screen and does not pretend to end an authenticated CMS session. Leaving the website-connection view still destroys its separate in-memory Firebase token.

## Data, images and backups

The database remains version 3. Editorial records live under review-document:* in the existing meta store, with activity under review-activity:* and display preferences under review-profile. They are separate from private financial/customer namespaces and public catalogue stores. Their published snapshots are immutable copies until republished; writes are version checked and commit before success is shown.

Data backup schema version 3 now has the optional reviewVersion:1 extension: reviewRecords, reviewProfile and reviewActivity. It is validated before import and applied inside the original import transaction. New-format import replaces the editorial extension; older backups lacking it preserve current editorial records and the image metadata/files they require. Imported editorial versions advance so stale editors cannot overwrite the restore. Use the updated app to restore these extended backups; older application builds may ignore fields they do not understand.

Editorial images in working records and published snapshots participate in existing media usage/deletion protection. Blob files still require the separate media backup. Data backup includes the internal staff directory; handle it as internal company data. Private bookings/STO/tour costs/quotations still have their separate operational export/import from Quotations.

## Current verification

Final Chrome checks: 94 unit/repository tests, 55 existing end-to-end checks, 97 new review-page/layout assertions and 14 operational assertions passed. See IMPLEMENTATION_STATUS.md for details. Tests use isolated browser profiles and temporary databases, not the user's browser data. Browser test runners require an existing Playwright install via PLAYWRIGHT_MODULE and BROWSER_CHANNEL=chrome. No production request or cloud credential is required for tests.

## Review limits and release boundary

This is a complete local review application, not a deployed shared CMS. Persistence is browser/origin-specific; clearing browser storage removes local records. There is no general CMS authentication, enforced role system or shared server database. Local publishing never writes to the production website. Existing staff-authenticated website booking reads still require the proper deployed rules/provider/account; live sign-in and reads were not performed during this work.

Content migration, real source-ID matching, production redirects, live publishing/cache invalidation, private server storage, account provisioning, external delivery and deployment remain release work. No live website files/data, production rules, Git commits, pushes or deployments were changed by this review-build task. Source audit documents and reference screenshots/assets remain reference material. Vendor license files are preserved verbatim.

### Full-width and typography update — 6 November 2026
The workspace now fills the browser width with no outside frame or maximum-width cap. Arial/Helvetica replaces the previous font stack, with stronger text weights and near-black labels and body copy. Gold actions, coloured status indicators and the mobile navigation are retained.
