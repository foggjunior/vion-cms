# Server domain and integrations

Next route handlers call these modules. `auth.mjs` verifies Firebase sessions, staff access and mutation origins. `policy.mjs` allowlists services/methods and role permissions. `execute.mjs` runs the server domain pipeline. `domain.mjs` reuses the tested repository invariants in an isolated in-memory transaction engine; `persistence.mjs` persists changed documents in revision-checked Firestore transactions.

`publication.mjs` projects published content and referenced media only. `media.mjs` inspects image bytes/dimensions and uploads to Cloudinary. `booking-sync.mjs` imports website request data. `email.mjs` and the verified webhook route handle Resend outbox, delivery and correspondence. Staff access records are distinct from published team profiles and the editorial staff directory.

`tests/cloud.test.mjs` runs without cloud credentials. Browser contract tests inject isolated test persistence into the same execution pipeline; production routes never accept a persistence override or a demo identity. Live integration verification requires staging configuration.
