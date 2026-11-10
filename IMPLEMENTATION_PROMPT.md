> 7 November 2026: the new server application is documented in [Cloud implementation](docs/CLOUD_IMPLEMENTATION.md). This document retains the approved browser-preview/history context.

# Maintenance and release handoff prompt

Work in D:\CMS\vion-cms. Read PROJECT_PROMPT.md, README.md and docs/REVIEW_BUILD.md before changing code. All visible sidebar pages are implemented for local review; do not repeat the earlier scaffold-only or dashboard-only work.

Preserve the reference-inspired simple layout, Vion branding, real local dashboard metrics, all working catalogue/editorial/booking/quotation screens, shared media protection, independent publication snapshots, private rate separation and backward-compatible backups. Reuse existing modules and model validation. Cover changes with meaningful unit and browser tests and record actual results in docs/IMPLEMENTATION_STATUS.md.

Local review does not imply production readiness. Shared authentication/permissions, private server storage, live publishing, real redirects, source-ID migration and deployment require an explicit release task. Existing Firebase booking connector is read-only and needs an authorised staff account with deployed matching rules. Do not weaken security rules or expose credentials to make a connection work.

Keep original references and vendor licenses unchanged. Ask only for genuinely missing decisions; otherwise make conservative reversible local implementation choices and document them. Do not commit, push or deploy unless requested.
