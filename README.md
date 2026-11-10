# Vion Africa Travel CMS

The approved CMS now has a Next.js server application using Tailwind CSS, Firebase Authentication/Firestore, Cloudinary and Resend. The original browser preview remains for reference and backup export.

## Start the new application

```powershell
cd D:\CMS\vion-cms
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open http://127.0.0.1:3000/setup, configure the **new staging project** chosen by the owner, then sign in at `/login`. Follow [Staging setup](docs/STAGING_SETUP.md) to bootstrap your first administrator and configure image/email services. Never put secrets in chat or Git. Double-click `start-local.cmd` after dependency installation. Rebuild after changing NEXT_PUBLIC values.

`npm run build` builds the application; `npm start` serves it. The approved CMS workspace is `/workspace`; account access is `/staff`; service status, email delivery and correspondence are `/integrations`.

## Features

Tours/day trips, destinations, accommodations, room/general STO rates, exact-cost quotation calculations, selling-only guest PDFs, booking inbox, settings/team, shared media, taxonomies, blogs/categories, migration, impact/foundations, pages, experiences, FAQs, navigation, reports and profiles are connected to authenticated server repositories. Account roles are enforced by the API. Publication snapshots remain separate from drafts. Existing website data and hosting are not changed automatically.

See [Cloud implementation and limits](docs/CLOUD_IMPLEMENTATION.md), [implementation status](docs/IMPLEMENTATION_STATUS.md) and [acceptance checklist](docs/ACCEPTANCE_CHECKLIST.md). The approved editors are retained native modules served by Next.js; authentication and new service/account screens use React/Tailwind.

## Inline accommodation entry

Use **Add accommodation** directly inside a quotation or tour itinerary day, then **Save accommodation & use**. The property and private room/general STO rates are saved for reuse in later work. See [workflow details](docs/INLINE_ACCOMMODATIONS.md). The top-right menu is now the single account menu.

## Daily costs and profit

Open/close costs within each itinerary day. Adult and child rates use their respective counts; room/vehicle quantities remain separate. Below the days, choose profit percentages by cost group and review the total itinerary cost, profit and guest grand total. See [daily costing guide](docs/DAILY_COSTS_AND_PROFIT.md).

## Tests

```powershell
npm run test:server
node tests/cloud-e2e.mjs
node tests/next-http.mjs
```

Browser checks require Chrome and an installed Playwright package; set PLAYWRIGHT_MODULE if it is not available on the local module path. The browser contract tests use isolated in-memory server persistence, not live Firebase. Real connected checks are listed in STAGING_SETUP.md. No production deployment, data migration or external email was performed during implementation.

## Original browser preview

```powershell
python tools/serve.py 5173
```

Open http://127.0.0.1:5173/#/dashboard or double-click `start-preview.cmd`. Its data stays in that browser/origin until explicitly exported and migrated. [Review build guide](docs/REVIEW_BUILD.md) describes those historical local workflows. The test suite is at `/tests/`; run its existing headless runner with the preview server running.
