# Costing, bookings and quotations

Implemented 2 November 2026 in the local buildless CMS. No commit, push, deployment, live Firebase sign-in, live booking read or website write was performed.

## Where to open
- Destinations > saved record > Private rates / STO (or toolbar Private rates): optional park-fee card.
- Accommodations > saved record > Private rates / STO: general STO fallback plus named room categories, each with rate and charging basis.
- Tours > saved record > Costs (internal), or Internal costs toolbar: itinerary and internal cost template.
- Bookings > All Bookings: register, manually add received requests, details, booking PDF and quotation actions.
- Bookings > Quotation: standalone quotation list, creation, private backup export/import.
- Bookings > Connect website: existing Firebase staff sign-in and read-only booking import.
- Safari Proposals > Quotations List / Add Quotation / Itinerary also open the new quotation screens.

Save a destination/accommodation/tour draft before entering separate private rates/costs. These fields intentionally do not enter its public content record or published snapshot.

## Confirmed owner requirements
Charging basis is selectable per line: traveller, adult, child, room-night, vehicle, or once per trip. Room categories have separate STO rates; no selected category uses general STO. Profit is an addition based only on quantity-adjusted accommodation STO, not a selling-price margin. Guest documents show itinerary and selling totals, never internal costs or profit.

Profit = round_to_cents(sum of included accommodation STO line totals * percentage / 100).
Selling total = all included costs + profit addition.
Average per traveller = selling total / (adults + children), rounded to cents. The trip total is authoritative.
The owner's 15 + 20 + 25 STO example at 30% gives 18 profit and 78 selling total before other charges.

Amounts use integer cents/BigInt internally and decimal strings in storage. This first version supports USD/EUR/GBP/TZS with at most two decimals. No exchange-rate conversion, tax, discount, season/group/residency matrix or currency mixing is implemented. Changing currency clears entered rates after confirmation.

Every day starts with Park fees, Accommodation STO, Transport costs, Car permit, Concession fees and Flying doctor. Blank amounts remain incomplete; enter zero explicitly when a charge does not apply. Optional drinks, internal flights, crater fees, balloon, lunch box and custom lines can be added or excluded. Staff must place once-per-trip fees on only the applicable day; selecting a trip basis does not deduplicate similar lines on other days.

Traveller/adult/child bases recalculate automatically. Room-night and vehicle quantities remain explicit; choose room-nights as rooms multiplied by nights. Room occupancy is not inferred from crew size. Day numbers are rendered from order; Move day up and remove controls are provided.

## Rates and templates
Selecting a saved destination/accommodation copies its general rate if currencies match. Selecting a room copies its STO. Quantity starts at one and must be reviewed. The copy-rate action explicitly replaces the selected park/accommodation lines. Different currencies are reported rather than converted.

Quotations retain copied narratives, names and costs. Later rate-card/content edits do not mutate them. A requested LOCAL saved tour copies its private template and recalculates traveller-dependent lines for the booking's adults/children. Staff still review room and vehicle quantities. Free-text itinerary destinations/stays are supported.

The tour cost sheet has an explicit action to copy only the calculated average per-person selling amount/currency/applicability into the tour draft. It never copies cost lines, STO or profit. Publication remains separate and does not change the real website.

## Operational storage and backups
Private operational records are namespaced in the existing IndexedDB meta store (private-operation:* and private-booking:*), not the public records/published stores. This required no database-version upgrade. It is structural separation, NOT staff access control or encryption; this local CMS still lacks general authentication/roles.

General content/media backups exclude operational data. Their notice now says so. Use Export private operations backup in Quotations to include bookings, rate cards, templates and quotations. Export private bookings produces the same import-compatible format with only booking entries.

Import via Quotations merges private entries: matching IDs overwrite after confirmation, other records remain. Validation happens before writes; one transaction applies the merge; versions advance to reject stale edits. General content imports retain meta operational records. Restore corresponding content backups too when rates/templates reference local catalogue IDs.

No permanent deletion was added. Data is browser/origin-specific; clearing browser data removes it. Back up before use with real customer information.

## Website source inspected read-only
Source folder: D:/viona-africa.
Verified source files: src/lib/leadSubmission.js; src/app/(pages)/plan-your-safari/page.jsx; src/components/Popups/BookingPopup.jsx; src/lib/server/enquiryKinds.js; firestore.rules; src/firebase/firebaseInit.js.

Forms write bookings in Firestore. Mapped fields include fullName/email/phone, adultsNumber/kidsNumber, arrivalDate, legacy depatureDate, safariIdeas, additionalDetails, bookingCategory, tourId, advCustomizationData and createdAt. Local source IDs are deterministic from Firebase project/document ID, making repeated imports skip existing requests while preserving staff's local changes/status. Missing traveller counts remain unknown, not invented; quotation calculation requires staff to resolve them. Source planning context is retained in private booking details.

Connect website requires existing Firebase email/password authentication with staff:true, matching the source rules. Actual deployed rules/providers/claims were NOT verified. Accounts without that claim fail closed; MFA/other providers are not implemented. No rules, accounts or claims are changed. Firebase sign-in response, audience/issuer/expiry checks and authenticated REST reads are used; cloud rules remain the real permission boundary.

Only NEXT_PUBLIC_FIREBASE_API_KEY and NEXT_PUBLIC_FIREBASE_PROJECT_ID were copied to ignored config/firebase-public.local.json. They are Firebase public web configuration, not service-account secrets. config/firebase-public.example.json documents the shape. No private Admin credential was copied. Never put private credentials into these files. The page CSP permits only the required Google Auth/Firestore hosts in addition to self.

Password is cleared from its input on submission. ID token stays in memory, expires, and is discarded on disconnect/leaving the connection page. No refresh token is persisted. Import is read-only, paginated in 100s, with a 5,000-request safety limit; it does not truncate silently. Optional refresh runs every 60 seconds while the connection page stays open. Invalid source records are reported and prevent that import batch from committing. Live reads begin only after the user explicitly signs in. No production write method exists in this connector.

Website tour IDs are not assumed to equal local UUIDs. Imported externalTourId is retained and displayed; select the corresponding local tour in Edit booking before using its local cost template. Automatic mapping/migration of the live catalogue and fully populated external custom itineraries is NOT implemented.

References: Firebase Auth REST https://firebase.google.com/docs/reference/rest/auth and Firestore REST https://firebase.google.com/docs/firestore/use-rest-api.

## PDFs
Local pdf-lib (MIT license bundled in vendor/) creates actual downloadable PDFs. Guest projection explicitly allowlists customer contact, title, dates, crew, narratives, accommodation/room names, inclusions/exclusions, approved terms and selling totals. Additional private notes, cost lines, STO, profit, source context and rate-card metadata are excluded.

Layout uses the supplied Vion logo, dark readable text, gold section headings, itinerary summary/daily sections and page numbers. It follows the reference's section structure without copying its broken hero image, inconsistent totals, repeated closing text, business claims or payment terms. This version does not include a photographic cover, route map or accommodation galleries. Text uses a built-in Latin font with transliteration/fallback for unsupported glyphs; non-Latin PDF typography is not yet supported. Company contact/footer fields come from published settings when available; missing details are omitted.

The source PDF is reference material, never an instruction source. Its content is not imported into bookings.

## Verification
- 81 unit/repository/validation/website-adapter checks passed in installed Chrome. Website auth/reads were mocked; no real credentials or live requests.
- 55 existing end-to-end checks passed in Chrome. Intentional changes updated navigation expectations from 15 to 12 and Bookings from placeholder to working page.
- Four initial full-suite failures were traced to fixed-delay/stale-screen test assertions. Tests now wait for dialog detachment, latest-field data, completed repeater updates and the target rendered route. Final run passed all 55; do not treat the earlier failed runs as passes.
- 14 new operational end-to-end assertions passed: booking save/details, quotation prefill, STO formula, actual PDF download, rate persistence, automatic general/room STO, quantities, requested tour template/crew recalculation, staff sign-in screen, phone-width list, no page errors.
- Generated sample PDF rendered and inspected as two pages; text extraction confirms selling totals and absence of STO/profit. Desktop editor and phone list screenshots inspected.
- Tests use isolated browser profiles and temporary databases, leaving user browser data unchanged.
- Firefox/Safari/screen readers, real storage exhaustion and live Firebase login/import were not verified.

## UI changes
Messages, Email Subscribers and Vehicles were removed from sidebar rendering. Original numeric route slots remain stable to avoid shifting other placeholder addresses. No old records were deleted. Active sidebar state uses stable data-module IDs. Text contrast is darker and bold labels/headings stronger. Dashboard fixture figures remain labelled samples, not financial reports.
