# Tour taxonomies and day trips — design notes (local prototype)

Date: 29 October 2026. Status: **proposed replacement behaviour**, implemented locally. None of the fields,
publication rules or validation below are confirmed requirements of the existing Vion CMS. The screenshots
establish only the sidebar entries *Tour Packages › Activities / day trips* and *Add Activity*; the public audit
observed day-trip pages, a tag filter and site-wide day-trip inclusion / what-to-bring lists, but not their admin
behaviour or approved text. Nothing here changes the live website.

## Where to find it

| Screen | Sidebar | Hash route |
| --- | --- | --- |
| Taxonomies (tour types, categories, standards, tags) | Tour Packages › **Taxonomies** (new entry; existing labels unchanged) | `#/taxonomies` (`?group=type\|category\|standard\|tag`, `&q=`, `&status=`) |
| Day Trips list | Tour Packages › Activities / day trips | `#/day-trips` (`?q=`, `&status=`, `&sort=`) |
| New day trip | Tour Packages › Add Activity | `#/day-trips/new` |
| Day-trip editor / preview | from the list | `#/day-trips/<id>`, `#/day-trips/<id>/preview?rev=draft\|published` |
| Day-trip defaults | “Day-trip defaults” on the Day Trips list, or “Edit defaults” in an editor | `#/day-trips/defaults` |
| Local day-trip listing / page | “Local day-trip listing”, or *Day trips* on the local preview site | `#/site/tours/day-trips`, `#/site/tours/day-trips/<slug>` |

## Tour taxonomies

### Term fields

| Field | Rule |
| --- | --- |
| `id` | Random UUID. Never changes (renaming keeps it, so records keep their link). |
| `namespace` | `type`, `category`, `standard` or `tag`. Fixed at creation. |
| `label` | Required, 1–80 characters after normalisation. |
| `key` | Stable value for links and filters: lowercase letters, digits and single hyphens, ≤ 64 characters. Suggested from the first label; never regenerated when the label changes; editable until the term is first published, then **locked** (external references such as `?filter=tag&value=<key>` depend on it). |
| `order` | Display order within the namespace (1, 2, 3…). |
| `active` | `true`/`false`. |
| `createdAt`, `updatedAt`, `version` | ISO UTC timestamps and a version for stale-write protection. |

Shape: `schemas/content.schema.json` `$defs/taxonomyTerm`. Nothing is seeded and no label claims to match the
existing CMS; each group shows a short neutral note that its values await owner confirmation (B4).

### Normalisation and uniqueness (documented rules)

- Labels: Unicode NFC, whitespace collapsed and trimmed. Two labels are the same when equal ignoring case
  (`Big  Five`, `big five` and `BIG FIVE` collide). Keys: trimmed, then compared exactly.
- Labels and keys are unique **within one namespace**; another namespace may reuse both (a tag and a type can both
  be “Private” / `private`).
- Rejected: blank labels, labels over 80 characters, malformed keys (with a suggested valid key), duplicates
  (reported as conflicts naming the existing term, including when that term is inactive).

### Ordering, activation and deletion

- **Move up / Move down** buttons on each row (keyboard operable). Focus stays on the same button of the moved term
  (or its neighbour when it reaches the end) and the new position is announced. The move sends the order the screen
  showed; if the stored order differs (another tab), it is rejected as stale and the latest order is shown. Ordering
  is disabled while a search or status filter is applied.
- **Deactivate / Activate.** Deactivating asks for confirmation and lists the record versions that use the term.
  Nothing is deleted and no record is changed.
- **No permanent deletion** in this phase (the previous “Delete unused term” action was removed).

### Inactive, unresolved and cross-namespace references

| Situation | Draft save | Publish | Editor | Published page |
| --- | --- | --- | --- | --- |
| Active term, correct group | OK | OK if the term is in the published taxonomy | offered | label shown |
| Inactive term **already saved** on this record (or on the record being duplicated) | OK + warning | OK + warning | stays selected, labelled “(inactive — kept)”, banner | label still shown |
| Inactive term **newly chosen** | error | error | not offered | — |
| Unresolved value (ID that is not a managed term) already saved | OK + warning (kept, never silently dropped) | error | shown as “Unresolved value: ID …” (selects: choose another value or “— No … —”; tags: Remove) | not shown |
| Unresolved value newly added | error | error | — | — |
| Term from another group (e.g. a tag ID in “Tour type”) | error | error | shown as “wrong group” | — |

“Already saved” means the stored version of the record (or the source record for Duplicate) held that reference.
Imports treat each record's own references as saved, so older data with inactive or unresolved values imports with
warnings (listed in the import confirmation) rather than being changed.

### Local publication policy for taxonomy changes

Reuses the team-order convention: one separate published snapshot.

1. Creating, renaming, re-keying (before publication), reordering, activating or deactivating a term changes the
   **working terms** only. The Taxonomies screen lists the unpublished changes.
2. **Publish taxonomy changes** stores one snapshot of every term (`id`, namespace, label, key, order, active) as the
   published taxonomy (`taxonomyPublished` store, id `tour-taxonomy`, with a revision). It does not read or write any
   tour, day trip or other record, so a management edit can never publish a content draft. The confirmation lists
   the changes; publishing is rejected as stale if terms changed after they were reviewed.
3. The local preview site resolves term labels and order from the published taxonomy; editor draft previews use the
   working terms (and flag inactive or unresolved values). Public pages show no keys, states or management controls.
4. A tour or day trip can be published only when every term it references is in the published taxonomy (an
   inactive published term is fine). Publishing content never publishes the taxonomy.

Upgrade note: before database version 3 the local site showed working term labels directly. The upgrade therefore
stores the existing terms as the first published taxonomy (revision 1, origin “upgrade”), so the local site looks
the same as before. The Taxonomies screen states this origin.

### Tour selectors

Tour type, category and standard selects and the Tags checkboxes offer **active** terms in display order. Saved
inactive, unresolved or wrong-group values are listed explicitly (never replaced by the first option or silently
cleared) with an explanation. Day trips use the same Tags field.

## Day trips

A new record kind `dayTrip` in the existing content stores, so slugs, redirects, snapshots, dependency checks, media
protection, duplicate and archive/restore reuse the tour/destination code. Shape:
`schemas/content.schema.json` `$defs/dayTrip`. There are deliberately **no** accommodation, tour type, category,
standard, `durationDays` or itinerary fields.

| Field | Notes |
| --- | --- |
| Title, slug | Slug generated from the first title, then kept; route `/tours/day-trips/{slug}`. |
| Summary | Optional teaser; cards fall back to the start of the overview. |
| Overview | Plain text, paragraphs on blank lines. Required to publish. |
| Destinations (`destinationIds`) | Several allowed; at least one **published** destination to publish. |
| Tags (`tagIds`) | Managed tour tags (see above). Optional. |
| Duration (`{ value, unit }` or `null`) | Optional. If given: a number above 0 with at most two decimals and unit `hours` or `days`; sanity limit 24 hours / 7 days (prototype assumption). Not linked to the schedule. |
| Schedule | Optional ordered items `{ id, heading, description }` (stable IDs, keyboard reorder). Each item needs a heading to publish; the number of items never has to match the duration — this is not a multi-day itinerary. |
| Cover, gallery | Shared media library; cover with contextual alt text required to publish; gallery images need alt or “decorative”. |
| Inclusions | At least one to publish. |
| Exclusions, what to bring | Optional; shown on the page only when filled in. |
| Pricing | Price on request (default) or provisional manual “from” price — see Pricing. An explicit mode is required. |
| Featured, display order | Featured trips list first, then display order (0 is a real value, empty sorts last), then title. |
| SEO | Title, description, sharing image (falls back to the cover) and noindex, as for other content. |

Draft minimum: a title. Publish minimum (proposed): title, unique valid slug, overview, at least one published
destination, usable cover image with alt text, at least one inclusion, explicit pricing mode (complete when manual).
Missing summary or duration produce warnings only; nothing is invented to fill them.

List: search (title, slug, summary), status filter (active, draft, published, published with unpublished changes,
archived, all), sorts (last updated, title, featured then display order, price with missing last), duplicate,
archive/restore. Editor: save draft, publish/publish changes, unpublish, archive/restore, duplicate, previews, the
unsaved-changes guard and stale-write handling of the shared editor.

### Pricing

The tour pricing implementation is reused unchanged: `request`, or `manualFrom` with an ISO 4217 currency, a
decimal-string amount (never converted through floating point; precision checked per currency), a basis
(`perPerson`, `perGroup`, `perVehicle`) and a public applicability note. Only `perPerson` renders “per person”.
Zero renders as an amount; a missing amount renders as “Manual price incomplete” and blocks publishing; request mode
stores no amount. No residency/season/child/group-size matrix, totals, quotes, payments, availability or checkout.

## Day-trip defaults

One record (`defaults` store, id `day-trip-defaults`): default inclusions and default what-to-bring items. **Nothing
is pre-filled** because the approved texts were not provided.

- Editing the defaults (Day-trip defaults screen, stale-checked) never changes any day trip — not drafts, not
  published versions.
- In a day-trip editor, **Copy defaults into this draft** is the only way defaults reach a record. When either list
  already has entries, a dialog warns and offers **Replace lists** (both lists become exactly the defaults) or **Add
  missing defaults** (default entries not already listed are appended). Copying changes only this form; it is saved
  with **Save draft** and never touches other records.
- This copy behaviour is proposed replacement behaviour; how the existing site applies its global lists is not
  known.

## Routes and local preview

Route registry (`src/modules/shared/routes.js`):

| Public pattern | Local preview (hash) |
| --- | --- |
| `/tours/day-trips` (listing hub) | `#/site/tours/day-trips` |
| `/tours/day-trips?filter=tag&value={tag key}` | `#/site/tours/day-trips?filter=tag&value={tag key}` |
| `/tours/day-trips/{slug}` | `#/site/tours/day-trips/{slug}` |

- A tour slug cannot contain “/”, so `/tours/{slug}` never collides with `/tours/day-trips/{slug}`; `/tours/day-trips`
  (with `/tours/zanzibar-trips` and `/tours/climbing-trips`) stays reserved for tours. Day-trip slugs are unique
  across active **and archived** day trips and their previous routes; changing a published slug plans a local 308
  entry exactly as for other content.
- The listing shows published snapshots only (featured first, then display order, then title), with destination and
  tag labels from published data, the price with its correct basis, and the shared published footer. Day-trip pages
  show duration (if any), destinations, price, tags, summary, overview, the optional schedule, inclusions and, when
  filled in, exclusions and what to bring.
- **Tag filter contract.** `filter=tag` with `value` = the tag's stable **key** in the published taxonomy (trimmed,
  case-insensitive). The production value format is unconfirmed; the key is the local assumption. Outcomes: no
  parameters → all trips; known tag → matching trips (an inactive published tag still matches, because records keep
  displaying it) or a readable “No published day trips are tagged …” state; unknown key → “No published tag has the
  key …” with a link to all trips; unsupported `filter`, missing value or value without filter → a warning and all
  trips. Filter links appear for active published tags used by published day trips.
- Draft previews: the editor's *Preview saved draft* (`#/day-trips/<id>/preview?rev=draft`) renders the saved draft
  with working relations and terms, flagging unpublished references and inactive/unresolved terms.
- These hash URLs and planned redirect entries are local review aids. They are **not** production HTTP routes and
  do not implement production redirects.

## Storage, publication and safeguards

- IndexedDB `vion-cms-local` version **3**. The 2 → 3 upgrade is additive and runs in the upgrade transaction (all
  or nothing): it creates `taxonomyPublished` and `defaults`, adds `key`, `order` and `active` to each existing term
  (key from the label, made unique within its namespace with -2, -3…; order following the old alphabetical display;
  active `true`; id, namespace, label, timestamps and version unchanged) and stores the first published taxonomy.
  Records, snapshots, redirects, site records and image Blobs are untouched. Version 1 databases upgrade through 2.
- Day trips use the content repository: drafts and immutable published snapshots, saving a draft never republishes,
  stale versions rejected, validation inside the write transaction, success only after `complete`.
- Dependencies: a destination used by a **published** day trip cannot be unpublished or archived until that day trip
  is unpublished (the message names it). Nothing cascades.
- Media: images used by day-trip drafts or published snapshots cannot be deleted; usage links open the day-trip
  editor.
- Taxonomy writes and defaults saves follow the same transaction, stale-version and fault-injection conventions.

## Backup compatibility

Data backups are now **schemasVersion 3**. They add day trips (in `records`/`published`/`redirects`), terms with
`key`/`order`/`active`, `taxonomyPublication` (object or `null`) and `dayTripDefaults` (object or `null`). The media
backup format is unchanged (schemasVersion 1) and includes day-trip images.

| Import | Replaces | Keeps |
| --- | --- | --- |
| v3 | everything: records of all kinds, snapshots, redirects, terms, published taxonomy, defaults, site settings, team, image details (`null`/empty clears) | image files only for images listed in the backup |
| v2 (before day trips) | destinations, accommodations, tours, their snapshots and redirects, taxonomy terms, site settings, team profiles, team order, image details | current **day trips** (drafts, published snapshots, route history, planned redirects), the **day-trip defaults**, current terms those day trips use that are not in the backup, and image details/files those day trips use |
| v1 (before site settings and team) | as v2 except site records | as v2, plus current site settings, team profiles, team order and the images they use |

For v1/v2 the backup's terms are upgraded like the database (a term already stored here with the same ID and group
keeps its current key, order and active flag, so published keys never change) and become the published taxonomy
(origin “import”), together with the published versions of kept terms. Kept terms that were never published stay
unpublished.

Validation happens before anything is written (the Backup screen runs a dry run first and lists what will be kept):
format/version, record and term schemas, term uniqueness per namespace, cross-namespace references, published
snapshots referencing only published records, published terms (with unchanged keys) and listed images, defaults
shape, unsafe links, routes, redirect loops, site rules — and for v1/v2 the **kept** records against the imported
content (for example a kept published day trip whose destination is not published in the backup rejects the whole
import with an explanation). After an import the result states how many images have no file yet; they show as
“file missing” and block publishing until the media backup is imported.

## Team follow-up

After **Publish / Publish changes** on a team profile, the editor shows a notice with **Review team visibility**,
which opens the Team list with focus on the *Team page order and visibility* panel (`#/team?focus=lineup`). The
same action is on the profile's *Team page* tab. Following it only navigates: profile content and the team order
remain separate publications, and nothing else is published.

## Local assumptions (conservative, reversible)

- Taxonomy changes are published together as one snapshot (not per term or per group).
- The tag filter value is the tag key; the local listing applies it to published day trips only.
- Day-trip duration limits (24 hours, 7 days, two decimals) are sanity checks only.
- Schedule items need a heading to publish; descriptions are optional.
- Day trips default to price on request, like tours; that counts as an explicit pricing mode.
- Older backups keep local day trips rather than deleting them (they hold no information about day trips).

## Remaining owner decisions

- B4: the actual tour types, categories, standards and tags, their definitions and whether categories/standards
  apply to day trips (deliberately not added here).
- The approved default inclusions and what-to-bring texts, and whether the live site applies them globally,
  per trip or only as editor templates.
- The production tag-filter value format (key, slug or label) and any other filters on `/tours/day-trips`.
- Day-trip publication minimum, whether duration and schedule should be required, and duration units/limits.
- Day-trip pricing beyond request / manual “from” (B2/B3), and whether residency or group-size pricing applies.
- Whether taxonomy changes need per-term publication or approval, and whether deletion of unused terms is wanted.
- C2: existing day-trip URLs, legacy slugs and real redirects; D1/D2 publication and cache behaviour in production.
