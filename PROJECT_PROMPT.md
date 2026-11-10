> 7 November 2026: the new server application is documented in [Cloud implementation](docs/CLOUD_IMPLEMENTATION.md). This document retains the approved browser-preview/history context.

# Current Vion CMS project context

Updated 6 November 2026. The dashboard-only scope is superseded.

Work in D:\CMS\vion-cms. Read README.md, docs/REVIEW_BUILD.md, docs/IMPLEMENTATION_STATUS.md and applicable instructions first. Preserve the original screenshots/assets and the existing Git repository. Synced sources/ files are read-only.

The local CMS now has working catalogue, settings/team, booking/costing/quotation, editorial, media and utility pages. The 5 November screenshot guides layout; Vion logo and gold actions remain. Dashboard numbers come from local records. Do not restore sample revenue/bookings or placeholder routes.

Keep the buildless stack and existing repositories/components. src/review/model.js and schemas/editorial.schema.json document the additional module shapes. Respect independent drafts/published snapshots, stale-write rejection, media dependency protection, private cost separation, archive/restore and backup compatibility.

Treat earlier reports as evidence of observed public output and owner decisions, not proof of original admin schemas. Private rate/financial data must never enter published content or guest PDFs. Staff directory roles are descriptive, not real permission enforcement. General CMS authentication/shared storage are not implemented.

Start with python tools/serve.py 5173. Run meaningful existing and new tests for changed behaviour. Do not claim unavailable checks. Update current docs and mark historical plans clearly. Never modify vendor licenses. No production writes, publishing, credential changes, account grants, commits or pushes unless the user authorises that work.
