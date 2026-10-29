# Vion CMS — project initiation prompt

You are building the replacement Vion Africa Travel CMS in D:\CMS\vion-cms. Tonight's deliverable is ONLY the dashboard landing page after admin login and its sidebar/header shell. Do not build authentication, database integration, bookings, payments, quotes, or the other module forms tonight. Work locally; do not deploy or push without a request.

## Read before changing anything
Inspect the existing project and any instructions first. Use D:\CMS\screenshots as the visual evidence for the existing CMS and D:\CMS\assets for real brand assets. Preserve these reference folders and the existing .git directory. Read the seven cms-discovery documents if supplied; otherwise use the discovery context below and explicitly record missing documents. Do not claim access to files you cannot find.

## Visual target
Faithfully reproduce the information architecture and main dashboard layout in the four screenshots: sidebar at left, logo/header and account dropdown, welcome heading, quick actions, four KPI cards, monthly bookings chart, quotation conversion, upcoming arrivals, recent bookings table, unread messages. Replace the old green accent with an elegant golden palette. Use the supplied Vion logo without recolouring it. Use white surfaces, a light neutral canvas, restrained borders, clear typography and generous but practical spacing. Gold is the brand accent; semantic states may use restrained green or amber. Do not add unrelated modules, decorative hero photography, invented analytics, or marketing-page styling.

Exact sidebar structure evidenced by screenshots:
- Dashboard
- Tour Packages: Tours List; Add Tour; Activities / day trips; Add Activity
- Destinations: Destinations List; Add Destination
- Accommodations: Accommodations List; Add Accommodation
- Bookings: All Bookings
- Safari Proposals: Top Itineraries; Quotations List; Add Quotation / Itinerary
- Blogs: Blog Posts; Add Post
- Users: Users List
- Messages: Messages List
- Media Library: Gallery
- Email Subscribers: Mailing List
- Vehicles: Vehicles List; Add Vehicle
- Migration: Migration Posts; Add Post
- Giving Back: Charity; Profiles
- Settings: Setting Options

Quick actions: New Booking, Add Tour, Write Blog, Quotations, Bookings, Gallery. Account dropdown: Profile, Settings, Log out.

## Frontend behaviour
Implement working independent sidebar accordions, active navigation styling, a working account dropdown that closes outside/on Escape, mobile sidebar with overlay, responsive cards and table scrolling. Quick actions and module links may open an explicit unimplemented-module screen with a return-to-dashboard action. Never pretend a record was saved or a live account logged out. Use keyboard-accessible buttons and focus states, useful alternative text and readable contrast.

Use an isolated fixture data layer and label every dashboard figure as sample data. Use fictional names and example.com addresses instead of copying customer/staff contact information from screenshots. Do not sum the six-month sample chart to imply it equals the all-time bookings count. The screenshot figures are layout references, not verified current business totals.

## Discovery context for tomorrow, not tonight's implementation
The existing public site is reported as Next.js on Vercel using Firestore/Storage and some Cloudinary media. The public audit of 27 October 2026 identified destinations, accommodation, tours/day trips, taxonomies, blog, FAQs, company/team data, impact stories and enquiry forms. It did not establish admin workflows. The screenshots additionally establish visible sidebar entries for bookings, proposals/quotations, vehicles and mailing lists, but do not establish their internal behaviour. Do not infer those workflows from menu labels.

Before functional CMS development, reconcile the owner's screen-by-screen description with the audit. P0 decisions remain open: full module list (A1), empty public tours and draft inventory (A2), accommodation visibility (A3), camps and itinerary links (A4), tour fields (B1), price matrix (B2), private commercial data (B3), taxonomy definitions (B4), record lifecycle/deletion (C1), slug behaviour (C2), drafts/publication (D1), live update mechanism (D2), media ownership (E1), authentication/users (F1), enquiry storage (G1), notification recipients (G2), and non-Vion copy (J1). Do not connect production Firebase or migrate records until these contracts are agreed.

Keep every inventoried successful public URL or plan an approved 308. Obtain the complete URL export: the audit counts 57 accommodation URLs without enumerating every slug. Preserve experience/enquiry query presets, stable references and the legacy depatureDate mapping. Keep audit defects separate from enhancements. Source files under any synced sources/ directory are read-only.

## Completion criteria
1. A recognisable dashboard frontend matching the reference structure with gold branding and real logo.
2. All 15 sidebar groups and screenshot submenu labels present.
3. Functional frontend navigation, dropdown and mobile menu; no fake backend actions.
4. Explicit demo data notice; no production connections or customer details.
5. Browser check at desktop and mobile widths; report actual verification and any limits.
6. README with launch instructions, scope, file map and next steps. Keep the implementation small and readable; reuse the existing stack if one exists. Record any framework choice rather than silently introducing one.

The initial implementation uses buildless HTML/CSS/JavaScript because this checkout had no application files and tonight needs no server behaviour. This is a frontend reference, not the final architectural commitment. When adopting Next.js later, preserve the approved shell, tokens, components and fixtures while moving behaviour into the agreed application structure.
