# Inline accommodations — 9 November 2026

## Workflow

In a quotation, private itinerary/tour-cost sheet, or tour-package itinerary day, use **Add accommodation**. Enter the name; choose a saved destination or enter another location; optionally add overview, amenities, activities and images. Add room types and their STO prices, or a general STO price when room categories are not needed. Currency and charging basis are explicit. Unknown prices remain blank.

**Save accommodation & use** saves a reusable draft accommodation and its private rate card together in one transaction. The accommodation is selected for the day. The first entered room is initially selected; the quotation room selector or the tour's **Choose room type** action lets staff choose another room or the general-rate fallback. The parent quotation/tour remains unsaved until staff uses its own Save action. Cancelling the parent does not delete the deliberately saved reusable accommodation.

Later quotations can pick the property from **Saved accommodation**, then select its room type. Tour days keep accommodation alternatives and room names; creating a quotation or costing template from that tour copies the selected compatible STO. Existing quotations keep their copied costs rather than changing when a rate card changes. Existing saved cost templates remain authoritative when chosen; loading a template does not silently replace its saved cost snapshots with newer rates.

The accommodation's shared list contains the new property immediately after saving/reloading. New properties are drafts with public-page visibility disabled. They are not automatically published to the public website. Public publication/dependency checks remain separate. STO rates stay in private operational storage and never enter public accommodation or tour snapshots. Guest PDFs keep selling totals only.

The form uses the shared image picker/upload flow; the first image becomes the cover and later images become the gallery. Uploading an image stores it in the media library separately; cancelling the accommodation dialog does not delete that library image.

## Data and permissions

The optional accommodation `locationName` supports free-text locations without requiring a destination record beforehand. Tour itinerary days have optional `accommodationRooms` entries containing only accommodation ID, room ID and room name. Existing records/backups remain valid without these fields. Removing an accommodation alternative removes its room selection during form conversion.

`accommodationInline.create` is a bounded server action that always creates an accommodation, not an arbitrary content kind. Admin and reservation staff can add supplier rates; editor/publisher staff can add details and room names with blank supplier prices. Viewers cannot create. `accommodationInline.rooms` returns room IDs/names only, never supplier prices. Reservation staff can upload new media for this workflow without receiving general content-edit permissions.

Content and rate saves are atomic. Invalid prices, duplicate room names, missing references and simulated storage failures save neither record. Matching name/location duplicates are rejected with guidance to select the existing property; existing records/rates are never silently overwritten. A different costing currency leaves the copied price blank and shows a warning; there is no invented currency conversion.

## Navigation

The left sidebar no longer contains an account card, My profile or Sign out. The top-right account menu remains, and profile updates no longer try to update removed sidebar elements.

## Verification

45 server tests passed, including 11 new inline-accommodation tests. 25 isolated Chrome workflow checks passed for quotation capture, media selection, later reuse, general pricing, tour room selections, tour-based quotations/cost templates, currency mismatch, sidebar removal and phone layout. The original 94 preview storage/validation tests also passed.

Tests used isolated in-memory repositories and static test servers. No environment files, credential files, staging database or live database were read. A Next build/dev process was not run because those commands automatically load environment files; the owner can restart the local development server to load the update.

The cloud UI generator now retains an explicit CSP matching the authenticated workspace rather than stripping the policy tag. This resolves the automatic review rejection encountered while regenerating the UI.
