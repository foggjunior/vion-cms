// Optional headless runner for tests/index.html. Playwright is NOT a project dependency:
// point PLAYWRIGHT_MODULE at an existing playwright or playwright-core install, e.g.
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright-core node tests/run-headless.mjs
// The CMS must already be served (python -m http.server 5173 --bind 127.0.0.1).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';

// BROWSER_CHANNEL=msedge (or chrome) runs the suite in an installed browser instead of bundled Chromium.
const browser = await chromium.launch(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {});
const page = await browser.newPage();
const external = [];
page.on('request', req => { if (!req.url().startsWith(base) && !req.url().startsWith('blob:') && !req.url().startsWith('data:')) external.push(req.url()); });
page.on('pageerror', err => console.error('page error:', err.message));
await page.goto(`${base}/tests/index.html`);
await page.waitForFunction(() => window.__testResults, null, { timeout: 120000 });
const { passed, failed, results } = await page.evaluate(() => window.__testResults);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : `\n     ${r.error}`}`);
console.log(`\n${passed} passed, ${failed} failed`);
if (external.length) console.log(`External requests: ${external.join(', ')}`);
await browser.close();
process.exit(failed || external.length ? 1 : 0);
