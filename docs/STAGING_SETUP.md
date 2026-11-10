# Connect the Vion staging CMS

Updated 7 November 2026. The owner chose a new staging Firebase project. No project ID or service credentials have been supplied yet.

## 1. Firebase staging project

Create a new Firebase project and web app. Enable Email/Password in Authentication and create a Firestore database. Add localhost and your eventual staging hostname as authorised Auth domains. Register the initial administrator email/password in Authentication; passwords are not stored in this repository.

Copy `.env.example` to `.env.local`, then fill:

- NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_PROJECT_ID from the staging web app settings. These identify the public web app.
- FIREBASE_PROJECT_ID matching that staging project.
- FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY from a staging service account, **or** GOOGLE_APPLICATION_CREDENTIALS pointing to its JSON file outside the repository. These are private. Literal `\n` sequences in the private key are supported.
- APP_ORIGIN=http://127.0.0.1:3000 for local development. Use the exact HTTPS origin when deployed.

Deploy the namespaced rules in `firestore.cms.rules` **to staging only**, merged with a default-deny policy for any other staging collections. No Firebase rules were deployed by the implementation task. Do not use the live website project for these first tests.

Grant the first administrator access:

```powershell
cd D:\CMS\vion-cms
npm run staff:bootstrap -- your-admin-email@example.com
npm run dev
```

The bootstrap command works only before an active administrator exists. Subsequent accounts are managed in `/staff`. A normal Firebase user without an active `cms_staff` record cannot enter the CMS. No legacy `staff:true` claim is required or granted.

## 2. Cloudinary

Use a staging Cloudinary account/environment. Fill CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET. No unsigned upload preset is needed. The server authorises a signed upload to the `vion-cms/` public ID prefix, then verifies the uploaded original before adding it to the library. Upload bytes go directly to Cloudinary so the 10 MB allowance works on serverless hosting. These images are intended for published travel content; do not upload passports or confidential customer attachments to this media library.

Test JPEG, PNG and WebP upload/reuse from Gallery; reject SVG and a file over 10 MB. Reference an image from a draft and confirm library removal is blocked. Confirm that an unreferenced library removal retains the original in Cloudinary for deliberate retention/cleanup.

## 3. Resend

Verify a sending domain in Resend and fill RESEND_API_KEY, RESEND_FROM and BOOKING_NOTIFICATION_TO with approved staging recipients. Queue a team notification from a saved booking, then use `/integrations` → Process queued notifications. Confirm the same booking notification cannot be queued twice.

For account invitations, an administrator chooses Create account & queue invite in `/staff`, then processes delivery in Integrations. Confirm the received link sets a password and opens the CMS login. Invitations use Firebase-generated password setup links; the CMS never collects another user's password.

Create a Resend webhook to `https://your-staging-host/api/webhooks/resend`; subscribe to the supported send/delivery/failure events and `email.received` if receiving is used. Fill RESEND_WEBHOOK_SECRET with its signing secret. The webhook URL must be reachable over HTTPS; localhost is not directly reachable by Resend.

For inbound email, configure a receiving address/subdomain and fill RESEND_INBOUND_TO with that exact address. Confirm the verified event retrieves a message into Integrations → Received booking emails. Existing mailbox routing must be preserved when choosing the receiving domain. Messages do not create bookings automatically and attachments are not fetched.

Fill CRON_SECRET, then configure a scheduler. The supplied Vercel schedule is every ten minutes and may require a paid plan. The same endpoint is available to a trusted external scheduler. A missing secret denies scheduler access.

## 4. Website requests in staging

The staging sync reads `bookings` in **the configured staging Firebase project**, by default. It does not reach into the live website Firebase project. Populate staging using an approved exported/sanitised test booking with the real website contract, or point a staging website build to that project.

Use Bookings → Connect website → Sync website requests. Re-run and confirm existing requests are skipped. Check adult/child counts, original received time, legacy departure-date spelling and customization context. Invalid records must be reported rather than invented or discarded. This initial connector imports new records only; it does not overwrite staff edits when a source document changes later. Pagination scans 100 source documents per batch and restarts a scan after the final batch so later documents with lower IDs are eventually found.

The public website source under `D:\viona-africa` was inspected, not modified. It already has its own email handler for form submissions. Sync never duplicates those acknowledgements.

## 5. Migrate approved local data

Export three backups from the old preview: content data, media files, and private operations. Save them outside the Git repository. First run the read-only plan:

```powershell
npm run migrate:plan -- "C:\path\content.json" --plan
```

For a confirmed staging target, set a process-local confirmation value, migrate images preserving IDs, then import content and private operations:

```powershell
$env:CMS_MIGRATION_PROJECT_CONFIRM="your-staging-project-id"
npm run migrate:plan -- "C:\path\media.json" --media
npm run migrate:plan -- "C:\path\content.json" --apply
npm run migrate:plan -- "C:\path\private.json" --operations
```

Image imports also require the project confirmation. No migration was applied by this implementation task. Record versions advance on restore to reject old editor copies. Import limits are documented in CLOUD_IMPLEMENTATION.md; test and batch larger data sets before use. Export a fresh shared backup before replacing existing staging content.

The URL ledger includes literal paths and the explicitly listed destination/accommodation slugs from audit 01. Template patterns and system assets are identified separately. The audit does not enumerate every accommodation slug; compare the actual source export before checking those URLs off. Every row starts unverified. Preserve exact paths or supply a verified 308 destination, including query-string behaviour where applicable.

## 6. Connected acceptance before release

- Admin, publisher, editor, reservations and viewer accounts have the expected permissions. Direct API calls cannot bypass them. Deactivated staff and revoked sessions are rejected; the last active admin is protected.
- Two devices see shared saves. A stale editor receives a conflict, not a success message.
- Draft edits stay out of published snapshots. Publishing/unpublishing changes the public feed atomically with the source record. Private supplier rates, profit, bookings and staff directory never appear in the public feed or guest PDFs.
- Media uploads reach staging Cloudinary, references prevent removal, and the public feed resolves images used by published records.
- Booking sync imports the real staging form shape without duplicate notifications. Guest quotation PDFs retain selling totals only. Emails show delivered/bounced status from verified webhooks.
- Content/media/private backups round-trip on a clean staging project with matching counts, relationships and IDs.
- The staged website adapter is explicitly wired to the public templates, all URL ledger rows reconciled, real redirects tested on the website host, and metadata/forms checked before production cutover.

Local-only tests do not replace these provider-connected checks.
