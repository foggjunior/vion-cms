> 7 November 2026: the new server application is documented in [Cloud implementation](CLOUD_IMPLEMENTATION.md). This document retains the approved browser-preview/history context.

<!-- CURRENT_REVIEW_BUILD -->
> Current as of 6 November 2026: the complete local review build and current route/backup rules are documented in [Review build](REVIEW_BUILD.md). Earlier phase-specific scope and test counts below are historical unless explicitly updated.

# Site settings and team — design notes (local prototype)

Date: 29 October 2026. Status: **proposed replacement behaviour**, implemented locally. None of the fields,
publication rules or validation below are confirmed requirements of the existing Vion CMS; screenshots
establish only that a *Settings › Setting Options* entry exists. Nothing here changes the live website.

## Where to find it

- Sidebar **Settings › Setting Options** (`#/settings`) — the site settings editor. The account menu's
  **Settings** item opens the same screen.
- Sidebar **Settings › Team** (`#/team`) — team profile list, team order and visibility. **Add profile** opens
  `#/team/new`; profiles open at `#/team/<id>`.
- Previews: `#/settings/preview?rev=draft|published`, `#/team/<id>/preview?rev=draft|published`,
  `#/team/preview?rev=draft|published` (team page), and the local preview site `#/site`, `#/site/team`,
  `#/site/team/<id>`.

## Storage

IndexedDB `vion-cms-local` moves from version 1 to **version 2**. The upgrade is additive: it creates two
stores and does not touch existing stores or records.

| Store | Key | Contents |
| --- | --- | --- |
| `siteRecords` | `id` (index `kind`) | Envelopes `{ id, kind, record, workflow }` for `siteSettings`, `teamMember` and `teamLineup`. |
| `sitePublished` | `id` (index `kind`) | Immutable published snapshots `{ id, kind, revision, publishedAt, sourceVersion, snapshot }`. |

They are kept apart from `records`/`published` so slug, route, redirect and content-dependency rules never see
site records. Shapes are defined in `schemas/site.schema.json` (`schemaVersion: 1` per record). Every write
runs in one strict-durability transaction, re-validates inside it, checks the stored `version`
(stale-write protection) and reports success only after `complete`.

### Fixed IDs (singletons)

- Site settings: `id: "site-settings"` — enforced by the store key, the schema (`const`), the repository
  (creating a second one is rejected with “Site settings already exist…”) and backup validation.
- Team lineup: `id: "team-lineup"` — the single record holding display order and visibility.
- Team profiles use random UUIDs.

## Site settings fields

| Section | Fields |
| --- | --- |
| Company | name, tagline, footer description, office address, timezone (default `Africa/Dar_es_Salaam`), areas served |
| Contact | primary telephone, optional emergency telephone, public email, phone-support note, email-response note, Google Maps link |
| Branding | light-background logo, dark-background logo, default social-sharing image, explicit “use the light logo as the sharing image” fallback |
| Social profiles | repeatable `{ network, url, visible }`; suggestions Facebook, Instagram, TikTok; any other name allowed |
| Review links | repeatable `{ platform, url, description, buttonLabel, visible }`; list order is the display order |
| Default SEO | site name, title suffix, default description; the sharing image is the one chosen in Branding |

There are deliberately **no** fields for API keys, credentials, notification recipients, authentication,
analytics IDs or integration secrets; the schema rejects unknown fields. New settings start empty apart
from the specified default timezone.

**Logos.** A logo is either a library image (JPEG/PNG/WebP, the shared media library and its upload checks)
or a bundled trusted logo referenced by key. The only bundled logo is `assets/logo-dark.svg`
(`vion-logo-dark-artwork`), whose artwork is a near-black wordmark with an orange mark, so it is offered for
**light backgrounds only**. Choosing it is an explicit action; it is not pre-filled. User SVG uploads remain
rejected — the media security policy is unchanged.

## Team profiles

Fields: name, position/title, short biography (plain text), portrait (shared media library) with contextual alt
text, optional links `{ label, url }`. Profiles are public content, not user accounts: no login, roles or
links to authentication. The UI asks not to copy staff contact details from screenshots.

## How order and visibility are published

Display order and visibility are **not** part of a profile record. They live in the team lineup
(`entries: [{ memberId, visible }]`, array order = display order), which has its own draft and published
snapshot.

1. **Profile content** (name, position, biography, portrait, links) is published per profile with
   **Publish / Publish changes**. That never publishes the lineup.
2. **Order and visibility** are edited in the draft lineup:
   - on the Team list, **Move up / Move down** buttons and the **Visible** checkbox write the draft lineup
     immediately (each write is stale-checked against the lineup version);
   - in the profile editor's **Team page** tab, *Visible on the team page* and *Display order* are saved with
     **Save draft** in the same transaction as the profile (rejected as stale if the lineup changed since the
     editor loaded it).
3. **Publish order & visibility** on the Team list publishes the lineup snapshot only. It never publishes
   profile content, so unpublished profile edits stay unpublished.
4. The local team page shows the entries of the **published** lineup that are visible **and** have a published
   profile snapshot, in published order, rendered from those snapshots.

Consequences: a newly published profile appears on the team page only after the order is published too (the
editor and toast say so). New profiles join the end of the draft lineup, visible by default (prototype
assumption, mirrors the accommodation `publicPageEnabled` default). **Unpublish** removes a profile's published
snapshot (it leaves the team page at once) but keeps its lineup place. **Archive** removes the snapshot, takes the
profile out of the draft lineup (remembering its visibility) and makes it read-only. **Restore** returns it to
draft at the end of the draft lineup with its earlier visibility; it must be republished.

## Validation (proposed)

Drafts may be incomplete; supplied values must be valid.

- Text is trimmed; single-line values are whitespace-collapsed; multi-line values keep their line breaks.
- Telephone: 7–15 digits, optional leading `+`, spaces/brackets/hyphens (the existing accommodation rule, not a
  country-specific format). `tel:` links contain only digits and `+`.
- Email: one plain address such as `info@example.com` (no display name, spaces or `?`/`&` characters).
- Timezone: IANA `Area/Location` name or `UTC` that the browser also recognises. Abbreviations such as `EAT` and
  offsets such as `+03:00` are rejected (Chromium accepts some legacy abbreviations, so the browser alone is not
  enough).
- Links (social, reviews, maps, team links): `https://` only; `javascript:`, `data:`, `http:` and other schemes are
  rejected. The maps link must be a Google Maps address (`maps.app.goo.gl`, `maps.google.*`, `google.*/maps`).
  Links are checked again when rendered, so a stored unsafe value is shown as text, never as a link.
- Two **visible** social profiles with the same network name (case-insensitive) are rejected; a hidden duplicate
  is allowed.

Publish minimum — settings: company name, office address, timezone, primary telephone, valid public email, at
least one usable logo with alt text (the bundled logo counts for light backgrounds), and a default sharing image
or the explicitly approved fallback to an uploaded light-background logo (the bundled SVG cannot be a sharing
image). Every listed social profile needs network + URL; every review link needs platform, URL and button label.
Everything else is optional.

Publish minimum — profiles: name, position, biography, portrait with an available file and alt text; each link
needs a label and URL. Biography length over ~600 characters is a warning only.

## Rendering

All names, biographies, descriptions and labels are inserted as text nodes (`h()`), paragraphs come from blank
lines, and no user value is ever used as HTML. Missing settings produce an explicit “no published site settings”
state on the local site with the bundled logo labelled as a fallback — no business details are invented. The
metadata preview states that production SEO is not changed.

## Media usage

`assetUsage()` now also scans settings (logos, sharing image) and profiles (portrait), in working drafts and
published snapshots. Media deletion re-checks inside its own transaction, so an image used only by a published
profile snapshot or by the settings cannot be deleted.

## Backup and import

Data backups are now **schemasVersion 2** and add `siteRecords` and `sitePublished` (settings, profiles, lineup
and their snapshots). Image files stay in the separate media backup (unchanged format, schemasVersion 1),
which includes portraits, logos and sharing images.

- **v2 import** — replace-all, as before, now including site settings, team profiles and the lineup. An empty
  list clears them. The whole file is validated first: schemas, unsafe links, one settings record only, lineup
  integrity (every active profile exactly once; no unknown or archived profiles), snapshot consistency and media
  references.
- **v1 import** (backups made before these modules existed) — still accepted. Interpretation: the backup has no
  information about site settings or team, so it replaces the collections it contains (records, snapshots,
  redirects, taxonomy terms, image details) and **keeps** the current site settings, team profiles and lineup,
  together with the image details and files those records use, so nothing they reference is orphaned. The
  import confirmation states this.
- Restoring data and media: import the data backup, then the media backup. Until the media backup is imported,
  referenced images show as “file missing” and publishing is blocked for them.
