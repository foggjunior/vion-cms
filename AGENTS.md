<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


## Owner privacy boundary

Do not open, read, print, copy or modify environment files (`.env` and variants), credential files or service-account keys. Do not connect to real Firebase/database services, including configured staging services, unless the owner explicitly changes this boundary. The owner performs configuration and connected checks personally. Do not run Next build/dev/start or environment-loading bootstrap/migration commands as an indirect way to read those files. Source-only changes, static UI generation and explicitly isolated in-memory tests are allowed. Never print secrets or ask the owner to paste them into chat.
