# Vion CMS — first functional modules
Date: 28 October 2026. Status: proposed replacement behaviour, authorised for local implementation.

## Scope and evidence
Build Destinations, Accommodations and Tours, using the existing gold dashboard shell. The public audit describes output, not the existing admin schema or validation. Destination/accommodation public fields are observed; most tour fields are inferred. Draft/publish/archive, browser storage, explicit image roles and validation below are new design decisions for this prototype. Do not represent them as existing CMS behaviour.

The full seven audit documents are not bundled here. This is a condensed implementation handoff based on that conversation, not a replacement for original evidence. Screenshots in ../screenshots establish navigation only. Do not wait for more screenshots to implement the approved local workflows.

## Architecture
Keep the existing buildless HTML/CSS/JavaScript application and port 5173. Use ES modules and split app.js sensibly; preserve the existing shell, gold tokens, logo and all navigation labels. Do not introduce a framework migration, dependencies or production integration in this pass. Future Next.js/Firebase adoption is a separate decision.

Use a repository interface: list, get, saveDraft, publish, unpublish, archive, restore, export and import. Keep UI independent of IndexedDB. Store structured records and media Blobs in IndexedDB. Do not place image data URLs in localStorage. Every write must report success only after transaction completion; handle quota/open/transaction errors. Provide JSON data backup/import with schema version; include original assets as an optional separate backup only if fully implemented. Clearly state if a JSON backup excludes binary files. Validate imports completely before applying them. No production Firebase credentials or requests.

Local prototype notice: data exists only in this browser/origin and is not secure multi-user CMS storage; local publish means preview-visible, not deployed to the public website. No authentication/role simulation presented as real security.

## Shared record model
Use schemas/content.schema.json (JSON Schema draft 2020-12) for persisted draft shapes. Additional publication rules below are semantic and must be implemented separately. Use schemasVersion 1 at backup level and schemaVersion 1 per record. IDs use crypto.randomUUID; timestamps are ISO UTC; display dates in Africa/Dar_es_Salaam. Persist version for stale-write checks.

Records have id, kind, title, slug, status (draft/published/archived), createdAt, updatedAt, version and schemaVersion. Display names/internal names are separate. Preserve publishedRevision separately from working draft so editing a live record never silently replaces its preview-visible version. Store drafts and published snapshots without circular nesting. Publish an immutable snapshot; save draft does not republish. Unpublish removes the snapshot from public preview. Archive removes preview visibility, retains the record and remembers prior status; restore returns to draft and requires explicit republish.

Slug: generate on initial title entry, editable before first publish. Do not regenerate after later title edits. Uniqueness is per full route, across active AND archived records. Reserve hub paths including /tours/day-trips, /tours/zanzibar-trips and /tours/climbing-trips. Changing a previously published slug creates a local 308 redirect entry, not a real server redirect. Store route history; resolve query preset aliases separately later. Validate loops, collisions and reserved paths. Do not alter live website URLs.

## Lists and forms
Each module: heading, count, search, draft/published/archived filter, empty state, create action, edit, preview, duplicate and archive/restore. No permanent delete. Duplicate creates a new ID/draft, clears published snapshot and generates a unique slug. Sorting should be deterministic. Use hash routes with stable module/record IDs; support reload and back/forward.

Editors: sticky title/actions, tabbed or sectioned fields, field errors, saving/error/saved indicator, dirty state, unsaved-navigation warning, repeaters with stable item IDs, keyboard reorder controls, accessible labels and focus after validation. Save drafts with incomplete content but reject malformed supplied values. Archive and unpublish require clear in-app confirmation because they change local preview visibility.

Draft minimum: title only plus system fields. Slug can be empty until publication. Optional supplied URLs, emails, dates, numbers and relation IDs must still be valid. Numeric zero is not missing. Never insert fake prices, destinations or supplier details to satisfy validation.

## Destinations
Observed fields: internal/stored name, display name, slug, overview, optional wildlife, activities, best time, travel tips, ordered images. Proposed: structured tips, explicit cover, order, SEO overrides and legacy paragraph compatibility.
Editor sections: Basics; Content; Travel Tips & Activities; Media; SEO; Preview.
Publish minimum: title/display name, unique slug, overview, bestTime, one usable cover with contextual alt. Three images and adequate resolution are warnings, not a hard block. wildlife optional. Legacy tips must remain readable and can be converted to {id,title,body}[] without losing the original. Activities use ordered strings in this pass with trim/deduplication; do not silently merge distinct terms.

## Accommodations
Fields: name/title, slug, optional destinationId, type, standard, setting (insidePark/outsidePark/unspecified), description, amenities[], activities[], publicPhone, publicPhoneVisible, website, cover/gallery, SEO. Suggested initial types Hotel/Lodge/Campsite and standards Luxury/Semi Luxury/Normal are audit examples, not immutable business rules.
Publish minimum: title, slug, description, cover/alt, type, standard, plus published destination or explicit noDestinationReason. Phone optional, hidden by default, validated if public. Private supplier rates/contacts do not belong in these records.
A3/A4 unresolved: accommodation public visibility and camp separation. Provide publicPageEnabled independent of workflow. Existing route visibility cannot be changed globally without owner approval. Local new records default publicPageEnabled true but this is a prototype assumption. Do not split camps or rewrite imported narratives automatically.

## Tours
Fields: title, slug, summary, overview, durationDays, destinationIds, typeId/categoryId/standardId/tagIds, media, itinerary[], inclusions[], exclusions[], featured, recommendedRank, pricing, SEO.
Day fields: id, dayNumber, title, description, destinationIds, accommodationIds, meals[], activities[]. Destination is many-to-many; accommodation references can be multiple alternatives. Blank daily accommodation is allowed; tour can be camping or otherwise without a property record. Do not invent camps/routes yet.
Publish minimum: title, slug, overview, positive integer durationDays, at least one published destination, ordered contiguous itinerary with count equal to durationDays and each day title/narrative, cover/alt, inclusions, exclusions and an explicit pricing mode. Taxonomies are optional pending B4; labels must not claim known existing values. Provide prototype taxonomy editing with stable IDs and namespaces (type/category/standard/tag); prohibit deletion while referenced.
Pricing: mode request/manualFrom. Default request. For manualFrom require currency (validated ISO currency supported by Intl.NumberFormat), nonnegative decimal-safe amount, basis (perPerson/perGroup/perVehicle) and public explanation of applicability. Store amount as decimal string, not floating point. Do not calculate total quotes or fabricate the residency/season/group matrix. B2/B3 block that future model. Warn clearly that manual from pricing is provisional. Only render 'per person' for perPerson. Missing price sorts last; request mode never becomes zero. No booking/payment/availability functionality.

## Media
One local asset library: upload/select/reuse, file name/type/size/dimensions, original Blob, alt default, optional credit/caption, usage references. Contextual placements contain assetId, alt, decorative, caption and order. Cover is distinct from gallery ordering. Reject SVG uploads (bundled trusted logo is unaffected); allow JPEG/PNG/WebP with configurable size limit (proposed 10 MB), validate decodability, warn on low resolution, revoke object URLs after use. No deletion of referenced assets. Make missing assets visible as errors rather than silently substituting unrelated imagery.

## Preview and dependencies
Render readable local preview cards/details from the actual saved draft/published snapshot. Preview uses escaped text and safe paragraphs; no raw user HTML/innerHTML interpolation. Show draft badge and price basis. Relation pickers display archived/unpublished references with warnings. Block publishing with unpublished dependencies; block unpublishing/archiving a record used by a published tour/accommodation unless dependents are explicitly unpublished first. Never auto-cascade data changes. Working edits to published dependencies must not alter a tour's published snapshot unexpectedly.

## SEO
seo: title, description, shareAssetId, noindex. Use safe generated title/description fallbacks and cover share-image fallback. Length guidance is advisory (description around 160 characters), not an assertion about current CMS rules. Preview canonical route from current slug; never fetch or overwrite production metadata. Redirect screen may list locally planned redirects only. Noindex is independent of archive/publication.

## Out of scope
Authentication, real roles, enquiries, day-trip editor, commercial price matrix, supplier net rates, camp conversion, email delivery, content migration, actual deployment/redirects, homepage page-builder, bookings, quotations and other operational workflows. Preserve their sidebar placeholders. Implement extension boundaries without building these modules.

## Future dependencies
A1 full scope; A2 hidden tour inventory; A3 accommodation visibility; A4 camps; B1 exact tour editor; B2 price matrix; B3 private data; B4 taxonomies; C1 lifecycle; C2 legacy slugs; D1/D2 publication and cache; E1 media ownership; F1 authentication; G1/G2 enquiries; J1 copy corrections. Do not block this local prototype on these answers; document assumptions and defer production-dependent work.
