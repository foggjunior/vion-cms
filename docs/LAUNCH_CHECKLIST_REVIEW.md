# Vion Africa Travel launch checklist review

Reviewed 11 November 2026. The CMS is in D:/CMS/vion-cms. Public website source is in D:/viona-africa. This review covers source and isolated fixtures. Deployment, real form delivery, production credentials and live database contents require separate verification.

## CMS changes

- Destination fees are entered on the itinerary day. Selecting a destination preserves the manually entered costs. Accommodation STO remains available.
- Open daily costs on a later day, select an earlier day and choose **Copy all costs**. The copy replaces that day's cost lines after confirmation when they have been edited. It preserves the destination, accommodation selection and itinerary text. Copied rows have independent IDs, so edits on one day never change the others.
- Blog posts, impact stories and foundation profiles have a supporting subheading. Publishing requires three distinct H2 headings in the main text. Existing published snapshots and backups remain readable.
- The excerpt is a short summary for a listing card. It can provide a fallback search description when a dedicated description is blank. The supporting subheading appears below the main title and adds context to it.
- The toolbar supports H2/H3 sections, bold, italic, lists, HTTPS links and a formatting preview. Tour and accommodation overview headings sit under the existing section heading. Formatting is stored as text and rendered with safe DOM elements.
- The desktop dashboard puts the seven requested actions on the right. On narrower layouts they appear above the main dashboard content.
- The legacy public website currently reads its existing published content collections. The new CMS preview and publication feed carry the updated records. The public website consumer still needs the separate CMS integration and migration before it can render newly authored CMS content.

## Results by check

| # | Check | Source review or remaining verification |
|---|---|---|
| 1 | Proofreading | New text reviewed. Full editorial proofreading needs the published content inventory. |
| 2 | Copyright and dates | Fixed the CMS footer to use the current year. Website footer already uses it. Media and font licensing needs the owner's rights records. |
| 3 | Legal pages | Privacy and Cookie Policy routes exist. Terms & Conditions needs approved company terms. |
| 4 | Contact details | Website uses contact settings and contact links. Verify the address, phone, WhatsApp, email and map with approved business details. |
| 5 | CTA above the fold | CMS shortcuts verified in the dashboard. Check the public homepage and key landing pages at device sizes after deployment. |
| 6 | Sticky mobile CTA | Tour and day-trip detail pages have sticky booking bars. Check overlap with other mobile UI on devices. A global WhatsApp button is disabled in source. |
| 7 | Loading states | CMS saves disable submission while pending. Public enquiry flows have submission locks and progress states. Check the full page set under throttling. |
| 8 | Form errors | Source contains field validation and failure/retry states. Check each public form with invalid input and simulated delivery failures. |
| 9 | Thank-you page | Added the /thank-you next-steps page and linked it from saved enquiry confirmations. The confirmation retains its existing delivery warning when needed. |
| 10 | Links | Checked the new CMS action paths and public source route targets. Run a deployed crawl for dynamic and external URLs. |
| 11 | Form delivery | Isolated enquiry tests pass. Verify real receipt with approved test recipients. |
| 12 | Navigation | Tested the dashboard shortcuts and preview routes. Full deployed navigation crawl remains. |
| 13 | 404 | Website has a branded NotFoundState. CMS has a dashboard recovery link. |
| 14 | Search, login and payments | Source has search and CMS authentication. Checkout and payments need a defined provider, account, and booking/payment workflow. |
| 15 | Integrations | Maps and chat have consent gating in source. Verify Firebase, Cloudinary, Resend and optional integrations in staging. |
| 16 | Browsers | New CMS workflows checked in isolated Chrome. Firefox, Safari and Edge verification remains. |
| 17 | Breakpoints | Dashboard checked at widths 360, 768, 1024 and 1440. Public pages and landscape device checks remain. |
| 18 | Touch targets | New dashboard and formatting controls have a 44px minimum height. Audit the rest of the site on touch devices. |
| 19 | Performance | Measure deployed LCP, INP, CLS and load time under representative network conditions. |
| 20 | Images | Website uses responsive image handling, Cloudinary resizing and Next AVIF/WebP configuration. Verify coverage on deployed pages. |
| 21 | Bundling | Public website uses the Next build pipeline. The CMS workspace serves ES modules. Production output and unused code need a build inspection. |
| 22 | Caching and CDN | Sitemap has hourly revalidation. Cloudinary handles image delivery. Confirm deployed response headers and cache behavior. |
| 23 | Compression | Verify deployed HTML, CSS and JS response compression. |
| 24 | Meta titles | CMS preview shows title length and fallback. Public routes have page metadata. Crawl deployed pages for duplicates. |
| 25 | Meta descriptions | CMS preview shows description length and excerpt fallback. Crawl deployed pages for duplicates and missing descriptions. |
| 26 | Headings | Fixed duplicate main headings in editorial previews. New editorial publishing requires three distinct section headings. Check deployed content after integration. |
| 27 | Image alt text | CMS validates alt text when publishing editorial covers and catalogue images. Audit all live meaningful and decorative images. |
| 28 | Sitemap | Existing sitemap reads published records. Added the Giving Back hub, Stawi foundation page and published stories. Search Console submission remains. |
| 29 | Robots | Public robots configuration points to the sitemap and allows public routes. Confirm deployed output. |
| 30 | Indexing | Public layout defaults to indexable. Error and thank-you pages are intentionally excluded. Verify production tags and headers across indexable routes. |
| 31 | URLs and canonicals | Source has canonicals and an existing permanent legacy redirect. CMS checks slug format and route collisions. Crawl deployed canonical URLs and redirects. |
| 32 | Structured data | Blog and Giving Back details have JSON-LD in source. Validate deployed schemas and assess coverage by page type. |
| 33 | Social sharing | Added existing 1200×630 artwork to Blog and Giving Back listing metadata for Open Graph and Twitter. Validate article-specific imagery and deployed share previews. |
| 34 | HTTPS | Check deployed certificates, redirects and mixed content. |
| 35 | Debug settings | Verify production configuration in the hosting dashboard. The checklist's PHP environment variable names do not configure this Next project. |
| 36 | Credentials | Owner checks admin accounts, password policy and repository secret scanning. |
| 37 | Headers | CMS workspace includes CSP and frame restrictions. Public header change was rejected by automatic review because the proposed frame policy could weaken clickjacking protection. Check deployed CSP, frame policy, HSTS and nosniff before any public header change. |
| 38 | Input protection | Server checks include role/origin validation and enquiry input checks. Website article HTML is sanitized. New CMS formatting uses text nodes. Penetration testing remains. |
| 39 | Spam | Enquiry notification endpoints have rate limiting. A form-level CAPTCHA or honeypot was not found in the reviewed flows. Select and verify a control across submission endpoints. |
| 40 | File access | Check hosting access rules and public paths on the deployed applications. |
| 41 | Updates | Run dependency audit and review actionable advisories in the deployment environment. |
| 42 | Accessibility | New controls have labels and keyboard-operable native buttons. Full accessibility audit remains. |
| 43 | Screen readers | Source uses semantic headings and success announcements. Verify representative flows with NVDA and VoiceOver. |
| 44 | Analytics | GA4 loads after analytics consent in source. Check Realtime in the configured property. |
| 45 | Search Console | Verify ownership and submit the deployed sitemap in Search Console and Bing. |
| 46 | Conversion events | Existing lead events fire after saved submissions. Confirm the configured analytics events and thank-you page views. Purchase events depend on a payment workflow. |
| 47 | Consent | Source provides analytics/functional consent and a preferences control. Verify cookies and third-party requests before and after consent. |
| 48 | Icons | Connected the favicon and Apple touch icon in website metadata, and named the manifest. Android icons already exist. |
| 49 | Print | Added website print styles for readable text, hidden navigation and booking bars, and heading/image page breaks. Check print preview on priority pages. |
| 50 | Domain and DNS | Verify DNS and preferred-host redirects in the deployed environment. |
| 51 | Email DNS | Verify SPF, DKIM and DMARC for the actual sending domain and confirm delivery. |
| 52 | Backups | CMS has backup tools and isolated restore checks. Confirm automated production backups and perform an approved staging restore. |
| 53 | Environment | Owner verifies production data, mail and queue configuration. This project uses Next configuration and scheduled endpoints. |
| 54 | Jobs | Review deployment schedule, queue processing and successful runs in hosting logs. |
| 55 | Uptime | Confirm a configured monitor and approved alert recipient. |
| 56 | Logging | Source has error handling and operational logs. Confirm collection, redaction and alerts in production. |
| 57 | Sign-off | Owner reviews deployed content and design. |
| 58 | Documentation | Added this checklist and the editing guide above. Deliver owner-approved training and login handoff separately. |
| 59 | Post-launch | Repeat navigation, form delivery, SEO and deployment checks after release. |

## Verification

CMS server tests, preview regressions and isolated workflow checks ran without production credentials. Public website enquiry and utility tests ran against fixtures. Changed website JSX was syntax checked. The owner can restart the CMS and review the workflows in the configured environment.
