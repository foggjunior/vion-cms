# Continuation — blog article sections, destination highlights, faster images

Updated 18 November 2026. Read this first, then [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) and `AGENTS.md`.

## Where things stand

Both tasks from the owner's 17–18 November request are implemented, tested, and committed and pushed to `development` in both repositories at the owner's request. Nothing is deployed. The owner restarts the app and runs the connected (Firebase/Cloudinary) checks personally.

| Repository | Path | Branch | State |
| --- | --- | --- | --- |
| CMS | `D:\CMS\vion-cms` | `development` | Pushed: `00842b0` "Add blog article sections, destination highlights and faster images" |
| Public website | `D:\viona-africa-development` (a git worktree) | `development` | Pushed: `edd2ea9` "Render CMS article sections and destination highlights" |
| Public website | `D:\viona-africa` | `main` | Has unrelated uncommitted changes from earlier work. **Do not use it for this task.** All website work belongs in the development worktree. |

Codex ran out of credit partway through. It had already written the CMS toolbar, H1–H3, alignment, "Add section" composer, destination fields, and the public sanitizer and mapping changes, without tests or docs. Claude Code checked that work, finished it, fixed what the tests exposed, and wrote these notes.

## The owner's request and its status

| # | Request | Status |
| --- | --- | --- |
| 1 | Only the blog **Article** toolbar should stick while scrolling. The title bar must not. | Done. On blog editors the title/Save/Publish bar is static and only the formatting toolbar is sticky. |
| 2 | Text type: Normal, H1, H2, H3 | Done (blog editor only; other editors keep Heading/Subheading). |
| 3 | Buttons to align/justify text | Done: Left, Center, Right, Justify. Alignment is kept on save, in the preview and on the public site. |
| 4 | Pale toolbar background so the buttons stand out | Done (`#fbf2da` bar, white buttons). |
| 5 | Each section has a heading (writer picks the level), paragraph text and supporting photos; two photos side by side, stacked on phones; then the next sections | Done. The toolbar button **Add section** opens a composer with heading level, heading, paragraph text, photos (any number; pairs sit side by side), and optional **text after the photos**. This matches the sample article (easytravel.co.tz): H2 → text → photo pair → text. |
| 6 | Gallery images load slowly; uploads take long to verify | Done. See "Image speed" below. |
| 7 | Popup when an article is published | Done. An **Article published** dialog names the article and its address. Shown for blog posts only. |
| 8 | Destination signature experiences and highlights: CMS inputs and public page | Done. The public page already had hidden **Highlights** ("Why Visit") and **Signature Experiences** ("Only Here") sections waiting for data. The CMS now has both fields in their own **Highlights & signature experiences** panel on the destination editor's **Content** tab, and the website mapping passes them through, plus Activities, which were not mapped from the CMS before. |

## How it works (decisions to keep)

**Article markup.** The body stays in the existing `@vion-rich:` HTML format. A section is
`<h1|h2|h3>…</h1|h2|h3><p>…</p><div class="article-section-photos"><figure data-asset-id="…" data-alt="…"><figcaption>…</figcaption></figure>…</div><p>…</p>`.
Alignment is stored as `style="text-align: …"` on `p/div/h1–h3/li/blockquote`. Blog previews keep the writer's heading levels (`preserveHeadings`). The three-distinct-headings publish rule counts H1–H3 for blogs.

**Public website.** `src/lib/server/cmsCollections.js` resolves each figure to a Cloudinary URL at 1000px (`f_auto,q_auto,c_limit`) with lazy loading, keeping its place in the text. `src/lib/sanitizeArticleHtml.js` allows only `div.article-section-photos` and `text-align` (left/center/right/justify). `globals.css` puts photo pairs side by side from 640px, crops them to 3:2, gives an odd last photo the full width, and sizes article H1s.

**Destination fields.** `highlights` and `signatureExperiences` are optional plain-text strings (schema, `newRecord`, editor, CMS preview). One item per line; `Title: description` shows a bold title; lines starting with a hyphen and a space become bullets. This matches how the public `DestinationContentBlock` renders text. Older destinations without the fields still save.

**Image speed.**

- *Display:* `GET /api/media/:id?w=<width>` used to load the whole Firestore workspace snapshot and stream the full-size original for every image. It now reads the single `assetBlobs` entry (`readEntry` in `server/persistence.mjs`) and returns a 302 (cached for one day) to a resized Cloudinary rendition (`server/media-delivery.mjs`; widths 480/1000/1600 only). In the cloud workspace, `<img>` tags point at that URL directly (`ws.media.displayUrl`), so the browser loads, caches and lazy-loads them. Gallery tiles use 480, covers 1600, others 1000. Without `?w` the route still streams the original for PDFs and exports. The local IndexedDB preview still uses Blobs.
- *Upload:* in the cloud workspace, photos over 2560px or 2.5 MB are resized in the browser to a 2560px long edge before upload (`optimizeForUpload` in `src/storage/media-validation.js`). JPEG stays JPEG; PNG/WebP become WebP. EXIF orientation is applied and other metadata, such as GPS, is dropped. Up to three files upload at once, but finalize calls run one at a time because each commits a workspace revision. On the server, `finishUpload` runs the Cloudinary verification (all existing checks kept) and the workspace snapshot in parallel.

## Files changed

CMS (`D:\CMS\vion-cms`): `src/components/blog-section.js` (new), `src/components/writing.js`, `src/review/views.js`, `src/review/model.js`, `src/review/workspace-views.js`, `src/modules/destinations.js`, `src/modules/preview.js`, `src/modules/shared/records.js`, `schemas/content.schema.json`, `src/components/media.js`, `src/components/media-picker.js`, `src/storage/media-validation.js`, `cloud/remote-workspace.js`, `app/api/media/[id]/route.ts`, `server/media-delivery.mjs` (new), `server/persistence.mjs`, `server/direct-media.mjs`, `layout.css`, `modules.css`; tests: `server/tests/articles-and-destinations.test.mjs` (new), `tests/editor-and-cost-copy-e2e.mjs`, `tests/review-e2e.mjs`.

Also fixed: the **My profile** page threw "toast is not a function" on save (missing import since commit 2fa84a4).

Public website (`D:\viona-africa-development`): `src/lib/server/cmsCollections.js`, `src/lib/sanitizeArticleHtml.js`, `src/lib/server/cmsDestinations.js`, `src/app/globals.css`, `src/app/(pages)/blog/[slug]/page.jsx` (gallery on the legacy path); test `tests/cms-article-sections.test.mjs` (new).

## Verification (18 November 2026)

All runs were isolated: in-memory persistence, stubbed feeds and static servers. No environment file, Firebase, Cloudinary or live site was used. No Next build/dev/start was run.

| Suite | Result |
| --- | --- |
| CMS `node --test server/tests/*.test.mjs` | 61 passed (4 new) |
| CMS `tests/editor-and-cost-copy-e2e.mjs` (cloud UI + in-memory server) | 50 passed (24 new, 1 updated) |
| CMS `tests/inline-accommodation-e2e.mjs` | 25 passed |
| CMS `tests/run-headless.mjs` (local preview, port 5181) | 94 passed |
| CMS `tests/review-e2e.mjs` (local preview, port 5181) | 97 passed |
| CMS `tests/e2e.mjs` | 53 passed, 2 failed. **Both failures also occur on commit 7508e4b without these changes:** "dashboard widgets missing" and a duplicate `Settings` button (strict-mode locator) |
| CMS `tests/daily-costs-e2e.mjs` | Stops at "Accommodation action is gold, padded and spaced from inputs". **Also fails on commit 7508e4b**; not related to this work |
| CMS `tests/operations-e2e.mjs` | Not run. It is hard-wired to port 5173, which the owner may be using |
| Website `npm test` (run through a temporary `node_modules` junction to `D:\viona-africa\node_modules`, since removed) | 92 passed (4 new) |

The cloud browser tests serve `public/approved/`. Run `node tools/prepare-cloud.mjs` after changing UI source; it only copies files. Playwright is not a dependency; see `tests/run-headless.mjs` for `PLAYWRIGHT_MODULE`.

## Next steps

1. Done: committed and pushed on `development` in both repositories (see the table above).
2. Owner: run `npm run prepare:workspace`, restart the CMS, then check with the real services: upload a large phone photo, open the Gallery, write and publish an article with a photo pair, and fill Highlights/Signature experiences on a destination and view `/destinations/<slug>`.
3. Optional follow-ups: fix the two pre-existing `e2e.mjs` failures and the daily-costs button check; let `operations-e2e.mjs` take `BASE_URL`; consider a width-limited thumbnail for the public blog listing.
