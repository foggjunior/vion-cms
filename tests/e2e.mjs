// End-to-end browser checks for the acceptance checklist, driven through the real UI.
// Playwright is NOT a project dependency; point PLAYWRIGHT_MODULE at an existing install:
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright-core node tests/e2e.mjs
// Requires the CMS to be served at BASE_URL (default http://127.0.0.1:5173). Each run uses fresh,
// isolated browser profiles, so no existing local CMS data is read or changed.
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const outDir = process.env.E2E_OUT || mkdtempSync(join(tmpdir(), 'vion-e2e-'));
const results = [];
const external = [];
const pageErrors = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
// A failed check must not cascade: close any open dialog and drop unsaved editor state before the next one.
async function recover(target) {
  try {
    for (let i = 0; i < 3 && await target.locator('dialog[open]').count(); i += 1) await target.keyboard.press('Escape');
    await target.evaluate(() => { const view = window.__vionApp?.currentView(); if (view) view.isDirty = () => false; });
  } catch { /* page may be closed */ }
}
async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, true, typeof detail === 'string' ? detail : '');
  } catch (err) {
    let where = '';
    try {
      const state = await page.locator('.save-status').first().textContent({ timeout: 500 }).catch(() => '-');
      where = ` [at ${await page.evaluate(() => location.hash)}; status: ${state}]`;
      await page.screenshot({ path: join(outDir, `fail-${results.length + 1}.png`) });
    } catch { /* ignore */ }
    record(name, false, err.message.split('\n')[0] + where);
    await recover(page);
  }
}
function expect(condition, message) { if (!condition) throw new Error(message); }

const browser = await chromium.launch();
async function newContext(viewport = { width: 1400, height: 900 }) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  context.on('request', req => { const url = req.url(); if (!url.startsWith(base) && !url.startsWith('blob:') && !url.startsWith('data:')) external.push(url); });
  return context;
}
const watch = page => {
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('dialog', d => { pageErrors.push(`native dialog: ${d.message()}`); d.dismiss(); });
  return page;
};

const context = await newContext();
const page = watch(await context.newPage());

// ---- helpers ----
const status = () => page.locator('.save-status').textContent();
async function waitStatus(state) { await page.waitForSelector(`.save-status[data-state="${state}"]`, { timeout: 10000 }); }
// Marks the status so the helpers wait for the action's own final state instead of a stale one.
const markStatus = target => target.evaluate(() => { document.querySelector('.save-status').dataset.state = 'test-pending'; });
async function save(target = page) {
  await markStatus(target);
  await target.click('[data-action="save"]');
  await target.waitForFunction(() => ['saved', 'error', 'idle'].includes(document.querySelector('.save-status')?.dataset.state), null, { timeout: 15000 });
}
async function tab(name) { await page.getByRole('tab', { name, exact: false }).first().click(); }
async function dialogButton(name) { await page.locator('dialog[open]').getByRole('button', { name, exact: true }).click(); await page.waitForTimeout(150); }
async function makeImage(width, height, type = 'image/png') {
  const b64 = await page.evaluate(async ({ width, height, type }) => {
    const c = new OffscreenCanvas(width, height);
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#aa791b'); grad.addColorStop(1, '#2f7d5b');
    g.fillStyle = grad; g.fillRect(0, 0, width, height);
    const blob = await c.convertToBlob({ type, quality: 0.85 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  }, { width, height, type });
  return Buffer.from(b64, 'base64');
}
async function uploadCover(fileName, width = 1600, height = 900) {
  await tab('Media');
  await page.locator('#f-cover').click();
  await page.waitForSelector('dialog[open]');
  await page.setInputFiles('#media-upload-input', { name: fileName, mimeType: 'image/png', buffer: await makeImage(width, height) });
  await page.waitForSelector('dialog[open] .upload-results');
  await dialogButton('Use image');
}
async function reuseCover(fileName) {
  await tab('Media');
  await page.locator('#f-cover').click();
  await page.waitForSelector('dialog[open] .asset-tile');
  await page.locator('dialog[open] .asset-tile', { hasText: fileName }).first().click();
  await dialogButton('Use image');
}
async function publish() {
  await markStatus(page);
  await page.click('[data-action="publish"]');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await page.locator('dialog[open]').count()) { await dialogButton('Publish locally'); continue; }
    if (/Published locally|Not published|Not saved/.test(await status())) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`publish did not finish: ${await status()}`);
}
// Navigates by hash and waits until the app reports that route as rendered.
async function open(hash, target = page) {
  await target.goto(`${base}/${hash}`);
  await target.waitForFunction(h => { const root = document.getElementById('moduleRoot'); return root.dataset.ready === 'true' && root.dataset.renderedRoute === h; }, hash, { timeout: 15000 });
}
async function openNav(target, group, item) {
  const toggle = target.locator('.nav-toggle', { hasText: group });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await target.locator('.submenu button', { hasText: item }).first().click();
}
const currentId = () => page.evaluate(() => location.hash.split('/')[2]);
const text = sel => page.locator(sel).innerText();

// ---- 1. Shell ----
await page.goto(`${base}/`);
await check('Dashboard renders with gold branding, logo and 15 navigation groups', async () => {
  expect(await page.locator('h1#pageTitle').textContent() === 'Dashboard', 'dashboard heading missing');
  expect(await page.locator('.nav-toggle').count() === 15, `expected 15 groups, got ${await page.locator('.nav-toggle').count()}`);
  expect(await page.locator('.brand img[src="assets/logo-dark.svg"]').count() === 1, 'logo missing');
  const gold = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--gold').trim());
  expect(gold === '#aa791b', `gold token changed: ${gold}`);
  expect(await page.locator('.stat').count() === 4 && await page.locator('.quick-action').count() === 6, 'dashboard widgets missing');
});
await check('Sidebar list/Add entries open the working modules', async () => {
  const pairs = [['Tour Packages', 'Tours List', '#/tours', 'Tours'], ['Tour Packages', 'Add Tour', '#/tours/new', 'New tour'], ['Destinations', 'Destinations List', '#/destinations', 'Destinations'], ['Destinations', 'Add Destination', '#/destinations/new', 'New destination'], ['Accommodations', 'Accommodations List', '#/accommodations', 'Accommodations'], ['Accommodations', 'Add Accommodation', '#/accommodations/new', 'New accommodation']];
  for (const [group, item, hash, heading] of pairs) {
    await openNav(page, group, item);
    // Wait for this route's render; the previous view's h1 is still present until then.
    await page.waitForFunction(h => { const root = document.getElementById('moduleRoot'); return root.dataset.ready === 'true' && root.dataset.renderedRoute === h; }, hash, { timeout: 10000 });
    expect(await page.evaluate(() => location.hash) === hash, `${item} → ${await page.evaluate(() => location.hash)}`);
    expect((await page.locator('#moduleRoot h1').first().textContent()).trim() === heading, `${item} heading`);
  }
});
// Phase 3 wired Activities / day trips and Add Activity (previously placeholders) and added Taxonomies.
await check('Other modules remain honest placeholders; Add Tour quick action opens the tour editor', async () => {
  await open(`#/dashboard`);
  await openNav(page, 'Bookings', 'All Bookings');
  await page.locator('#modulePreview').waitFor({ state: 'visible', timeout: 3000 });
  expect(/NOT BUILT IN THIS PROTOTYPE/.test(await text('#modulePreview')), 'placeholder wording');
  await openNav(page, 'Blogs', 'Blog Posts');
  await page.locator('#modulePreview h2', { hasText: 'Blog Posts' }).waitFor({ timeout: 3000 });
  await open(`#/dashboard`);
  await page.locator('.quick-action', { hasText: 'Add Tour' }).click();
  await page.waitForSelector('#moduleRoot h1');
  expect(await page.evaluate(() => location.hash) === '#/tours/new', 'quick action route');
  await open(`#/dashboard`);
  await page.locator('.quick-action', { hasText: 'New Booking' }).click();
  await page.locator('#modulePreview h2', { hasText: 'All Bookings' }).waitFor({ timeout: 3000 });
});

// ---- 2. Destination ----
let destId;
await check('Destination: title-only draft saves, slug auto-generates, survives reload', async () => {
  await open(`#/destinations/new`);
  await page.fill('#f-title', 'Serengeti National Park');
  expect(await page.inputValue('#f-slug') === 'serengeti-national-park', 'slug not generated');
  await save();
  expect(/Draft saved/.test(await status()), await status());
  destId = await currentId();
  expect(/^[0-9a-f-]{36}$/.test(destId), `URL not updated: ${destId}`);
  await page.fill('#f-title', 'Serengeti National Park (Tanzania)');
  expect(await page.inputValue('#f-slug') === 'serengeti-national-park', 'slug regenerated after first save');
  await page.fill('#f-title', 'Serengeti National Park');
  await page.reload();
  await page.waitForSelector('#f-title');
  expect(await page.inputValue('#f-title') === 'Serengeti National Park', 'title lost after reload');
});
await check('Destination: publishing an incomplete draft lists actionable errors and focuses the first invalid field', async () => {
  await page.click('[data-action="publish"]');
  await page.waitForSelector('.issue-summary.has-errors');
  const summary = await text('.issue-summary');
  expect(/Write an overview/.test(summary) && /best time/.test(summary) && /Choose a cover image/.test(summary), summary);
  const active = await page.evaluate(() => document.activeElement.id);
  expect(active === 'f-overview', `focused ${active}`);
  expect(await page.getByRole('tab', { name: /Content/ }).getAttribute('aria-selected') === 'true', 'Content tab not selected');
  expect(await page.locator('#f-overview').getAttribute('aria-invalid') === 'true', 'aria-invalid missing');
});
await check('Destination: upload media, add contextual alt, publish locally and preview the saved revision', async () => {
  await page.fill('#f-overview', 'Endless plains and the Great Migration.');
  await page.fill('#f-bestTime', 'June to October for the river crossings.');
  await uploadCover('serengeti.png');
  await page.fill('#f-cover-alt', 'Wildebeest crossing the Mara River');
  await publish();
  expect(/Published locally/.test(await status()), await status());
  await open(`#/destinations/${destId}/preview?rev=published`);
  await page.waitForSelector('.preview-page');
  const body = await text('.preview-page');
  expect(/Endless plains/.test(body), 'published preview missing overview');
  await page.waitForFunction(() => document.querySelector('.preview-hero img')?.naturalWidth > 0, null, { timeout: 5000 });
  expect(await page.locator('.preview-hero img').getAttribute('alt') === 'Wildebeest crossing the Mara River', 'alt text');
});
await check('Draft edits to a published record do not change the published preview until republished', async () => {
  await open(`#/destinations/${destId}`);
  await tab('Content');
  await page.fill('#f-overview', 'EDITED DRAFT overview text.');
  await save();
  expect(/published version unchanged/.test(await status()), await status());
  expect(await page.locator('.status-changes').count() > 0, 'no unpublished-changes badge');
  await open(`#/destinations/${destId}/preview?rev=published`);
  await page.waitForSelector('.preview-page');
  expect(/Endless plains/.test(await text('.preview-page')) && !/EDITED DRAFT/.test(await text('.preview-page')), 'published snapshot changed by draft save');
  await open(`#/destinations/${destId}/preview?rev=draft`);
  await page.waitForSelector('.preview-page');
  expect(/EDITED DRAFT/.test(await text('.preview-page')), 'draft preview missing edit');
  await open(`#/site/destinations/serengeti-national-park`);
  await page.waitForSelector('.preview-page');
  expect(!/EDITED DRAFT/.test(await text('.preview-page')), 'local site shows unpublished draft');
  await open(`#/destinations/${destId}`);
  await publish();
  await open(`#/site/destinations/serengeti-national-park`);
  await page.waitForSelector('.preview-page');
  expect(/EDITED DRAFT/.test(await text('.preview-page')), 'republish did not update site');
});

// ---- 3. Accommodation ----
let accId;
await check('Accommodation: unsafe website rejected; linked to destination; phone hidden unless selected', async () => {
  await open(`#/accommodations/new`);
  await page.fill('#f-title', 'Plains Camp');
  await page.fill('#f-type', 'Lodge');
  await page.fill('#f-standard', 'Luxury');
  await tab('Destination');
  await page.selectOption('#f-destinationId', destId);
  await tab('Description');
  await page.fill('#f-description', 'Tented camp on the plains.');
  await tab('Contact');
  await page.fill('#f-publicPhone', '+255 700 000 000');
  await page.fill('#f-website', 'javascript:alert(1)');
  await save();
  expect(/Not saved/.test(await status()), `unsafe link saved: ${await status()}`);
  expect(/rejected for safety/.test(await text('#f-website-error')), 'website error text');
  expect(await page.evaluate(() => document.activeElement.id) === 'f-website', 'website not focused');
  await page.fill('#f-website', 'https://www.example.com/plains-camp');
  await save();
  expect(/Draft saved/.test(await status()), await status());
  accId = await currentId();
  await reuseCover('serengeti.png');
  await page.fill('#f-cover-alt', 'Tent veranda facing the plains');
  await publish();
  expect(/Published locally/.test(await status()), await status());
  await open(`#/site/accommodations/plains-camp`);
  await page.waitForSelector('.preview-page');
  let body = await text('.preview-page');
  expect(!/\+255 700 000 000/.test(body), 'phone shown while hidden');
  expect(/Serengeti National Park/.test(body), 'destination link missing');
  await open(`#/accommodations/${accId}`);
  await tab('Contact');
  await page.check('#f-publicPhoneVisible');
  await publish();
  await open(`#/site/accommodations/plains-camp`);
  await page.waitForSelector('.preview-page');
  body = await text('.preview-page');
  expect(/\+255 700 000 000/.test(body), 'phone not shown when selected');
});
await check('Accommodation: no-destination reason is required to publish and resolves the error', async () => {
  await open(`#/accommodations/new`);
  await page.fill('#f-title', 'Migration Mobile Camp');
  await save();
  await page.click('[data-action="publish"]');
  await page.waitForSelector('.issue-summary.has-errors');
  expect(/explain why this accommodation has no destination/.test(await text('.issue-summary')), 'reason error missing');
  await tab('Destination');
  await page.fill('#f-noDestinationReason', 'Seasonal mobile camp that follows the migration.');
  await page.waitForTimeout(600);
  expect(!/explain why this accommodation has no destination/.test(await text('.issue-summary')), 'error did not clear after typing reason');
  await save();
});

// ---- 4. Tour ----
let tourId;
await check('Tour: link destination/accommodation, build itinerary, reorder with keyboard; days stay contiguous', async () => {
  await open(`#/tours/new`);
  await page.fill('#f-title', 'Northern Circuit Safari');
  await page.fill('#f-durationDays', '3');
  await tab('Destinations');
  await page.locator('.relation-picker').first().getByLabel(/Serengeti National Park/).check();
  await tab('Overview');
  await page.fill('#f-overview', 'Three days in the Serengeti.');
  await page.fill('#f-inclusions', 'Park fees'); await page.keyboard.press('Enter');
  await page.fill('#f-exclusions', 'International flights'); await page.keyboard.press('Enter');
  await tab('Itinerary');
  await page.getByRole('button', { name: 'Add 3 missing days' }).click();
  const titles = ['Arrival', 'Full day game drive', 'Departure'];
  for (let i = 0; i < 3; i += 1) {
    await page.fill(`#f-itinerary-${i}-title`, titles[i]);
    await page.fill(`#f-itinerary-${i}-description`, `${titles[i]} narrative.`);
  }
  await page.locator('#f-itinerary-0-title').locator('xpath=ancestor::li[contains(@class,"repeater-item")]').getByLabel('Plains Camp').check();
  await page.getByRole('button', { name: 'Move Day 3 up' }).focus();
  await page.keyboard.press('Enter');
  const focused = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
  expect(focused === 'Move Day 2 up', `focus after move: ${focused}`);
  const order = await page.$$eval('.day-list > .repeater-item', items => items.map(li => [li.querySelector('.repeater-title').textContent, li.querySelector('input').value]));
  expect(JSON.stringify(order) === JSON.stringify([['Day 1', 'Arrival'], ['Day 2', 'Departure'], ['Day 3', 'Full day game drive']]), JSON.stringify(order));
  await save();
  expect(/Draft saved/.test(await status()), await status());
  tourId = await currentId();
  const days = await page.evaluate(async id => (await (await window.__vionApp.workspace()).content.get(id)).record.itinerary.map(d => `${d.dayNumber}:${d.title}`), tourId);
  expect(JSON.stringify(days) === JSON.stringify(['1:Arrival', '2:Departure', '3:Full day game drive']), JSON.stringify(days));
});
await check('Tour: reserved hub slug and malformed numbers are rejected', async () => {
  await tab('Basics');
  await page.fill('#f-slug', 'day-trips');
  await page.fill('#f-durationDays', 'three');
  expect(await page.evaluate(() => window.__vionApp.currentView().isDirty()), `edits not detected; slug=${await page.inputValue('#f-slug')}`);
  await save();
  expect(/Not saved/.test(await status()), await status());
  expect(/reserved hub path/.test(await text('#f-slug-error')), 'reserved slug not reported');
  expect(/whole number/.test(await text('#f-durationDays-error')), 'malformed duration not reported');
  await page.fill('#f-slug', 'northern-circuit-safari');
  await page.fill('#f-durationDays', '3');
  await save();
  expect(/No changes to save/.test(await status()), `reverting to saved values should leave nothing to save: ${await status()}`);
  expect(await page.locator('.issue-summary.has-errors').count() === 0, 'stale errors still shown after fixing the fields');
});
await check('Tour: price on request by default; publish succeeds with published dependencies', async () => {
  await reuseCover('serengeti.png');
  await page.fill('#f-cover-alt', 'Safari vehicle on the plains');
  await publish();
  expect(/Published locally/.test(await status()), await status());
  await open(`#/site/tours/northern-circuit-safari`);
  await page.waitForSelector('.preview-page');
  expect(/Price on request/.test(await text('.preview-page')), 'request price display');
  expect(/Plains Camp/.test(await text('.itinerary-preview')), 'day accommodation missing');
});
await check('Pricing: manual per group/person/vehicle render distinctly; zero differs from missing; commas rejected', async () => {
  await open(`#/tours/${tourId}`);
  await tab('Pricing');
  await page.locator('#f-pricing-mode input[value="manualFrom"]').check();
  await page.waitForSelector('#f-pricing-amount');
  await page.fill('#f-pricing-currency', 'USD');
  await page.fill('#f-pricing-amount', '1,250');
  await page.selectOption('#f-pricing-basis', 'perGroup');
  await save();
  expect(/digits only/.test(await text('#f-pricing-amount-error')), 'comma amount accepted');
  await page.fill('#f-pricing-amount', '0');
  expect(/From USD\s0 per group/.test(await text('.price-display')), await text('.price-display'));
  await page.click('[data-action="publish"]');
  // The earlier draft-error summary is still on screen until publish validation replaces it.
  await page.waitForFunction(() => /Not ready to publish/.test(document.querySelector('.issue-summary')?.textContent || ''), null, { timeout: 10000 });
  expect(/what the “from” price applies to/.test(await text('.issue-summary')), 'applicability not required');
  await page.fill('#f-pricing-applicability', 'Whole private vehicle, up to 6 guests, low season.');
  await publish();
  await open(`#/site/tours/northern-circuit-safari`);
  await page.waitForSelector('.preview-page');
  let body = await text('.tour-facts');
  expect(/From USD\s0 per group/.test(body) && !/per person/.test(body), body);
  await open(`#/tours/${tourId}`);
  await tab('Pricing');
  await page.fill('#f-pricing-amount', '1250');
  await page.selectOption('#f-pricing-basis', 'perPerson');
  expect(/From USD\s1,250 per person/.test(await text('.price-display')), await text('.price-display'));
  await page.selectOption('#f-pricing-basis', 'perVehicle');
  expect(/From USD\s1,250 per vehicle/.test(await text('.price-display')), await text('.price-display'));
  await page.fill('#f-pricing-amount', '');
  expect(/Manual price incomplete/.test(await text('.price-display')), 'missing amount should not read as zero');
  await page.locator('#f-pricing-mode input[value="request"]').check();
  await page.waitForTimeout(200);
  expect(/Price on request/.test(await text('.price-display')), 'request after switch');
  await save();
  const pricing = await page.evaluate(async id => (await (await window.__vionApp.workspace()).content.get(id)).record.pricing, tourId);
  expect(JSON.stringify(pricing) === '{"mode":"request"}', `request mode stored extra fields: ${JSON.stringify(pricing)}`);
  await open(`#/site/tours/northern-circuit-safari`);
  await page.waitForSelector('.preview-page');
  expect(/From USD\s0 per group/.test(await text('.tour-facts')), 'saved draft silently republished');
});

// ---- 5. Duplicate, archive/restore, dependencies ----
await check('Duplicate creates a draft with a new ID, unique slug and no published snapshot', async () => {
  await open(`#/tours`);
  await page.getByRole('button', { name: 'Duplicate Northern Circuit Safari' }).click();
  await page.waitForSelector('#f-title');
  const copyId = await currentId();
  expect(copyId !== tourId, 'same id');
  expect(await page.inputValue('#f-title') === 'Northern Circuit Safari (copy)', await page.inputValue('#f-title'));
  expect(await page.inputValue('#f-slug') === 'northern-circuit-safari-copy', await page.inputValue('#f-slug'));
  expect((await text('.editor-badges')).includes('Draft'), 'not a draft');
  expect(await page.getByRole('link', { name: 'Preview published snapshot' }).count() === 0, 'copy has published snapshot');
});
await check('Archive is blocked for published dependencies; archive/restore keeps data and requires republish', async () => {
  await open(`#/destinations`);
  await page.getByRole('button', { name: 'Archive Serengeti National Park' }).click();
  await dialogButton('Archive');
  await page.waitForSelector('dialog[open]');
  const msg = await text('dialog[open]');
  expect(/used by published/.test(msg) && /Northern Circuit Safari/.test(msg) && /Plains Camp/.test(msg), msg);
  await dialogButton('OK');
  await open(`#/tours`);
  await page.getByRole('button', { name: 'Archive Northern Circuit Safari (copy)' }).click();
  await dialogButton('Archive');
  await page.getByRole('button', { name: 'Archive Northern Circuit Safari (copy)' }).waitFor({ state: 'detached' });
  await page.selectOption('#tours-status', 'archived');
  const archivedRows = await page.locator('#moduleRoot tbody tr').allInnerTexts();
  expect(archivedRows.length === 1, `archived filter rows: ${JSON.stringify(archivedRows).slice(0, 300)}`);
  await page.getByRole('button', { name: 'Restore Northern Circuit Safari (copy) to draft' }).click();
  await page.getByRole('button', { name: 'Restore Northern Circuit Safari (copy) to draft' }).waitFor({ state: 'detached' });
  await page.selectOption('#tours-status', 'draft');
  expect(/Northern Circuit Safari \(copy\)/.test(await text('#moduleRoot tbody')), 'restored copy not a draft');
  await open(`#/tours/${tourId}`);
  await page.getByRole('button', { name: 'Unpublish' }).click();
  await dialogButton('Unpublish');
  await page.waitForTimeout(300);
  await open(`#/destinations/${destId}`);
  await page.getByRole('button', { name: 'Unpublish' }).click();
  await dialogButton('Unpublish');
  await page.waitForSelector('dialog[open]');
  expect(/Plains Camp/.test(await text('dialog[open]')), 'accommodation dependency not reported');
  await dialogButton('OK');
});
await check('Slug conflicts with existing (including archived) records are rejected', async () => {
  await open(`#/destinations/new`);
  await page.fill('#f-title', 'Another Serengeti');
  await page.fill('#f-slug', 'serengeti-national-park');
  await save();
  expect(/already used/.test(await text('#f-slug-error')), await text('#f-slug-error'));
  await page.fill('#f-title', '');
  await page.fill('#f-slug', '');
});
await check('Stale saves from a second tab are rejected with a reload option; cross-tab change is announced', async () => {
  const other = watch(await context.newPage());
  await open(`#/destinations/${destId}`);
  await other.goto(`${base}/#/destinations/${destId}`);
  await other.waitForSelector('#f-title');
  await other.fill('#f-title', 'Serengeti NP (edited in tab B)');
  await other.click('[data-action="save"]');
  await other.waitForSelector('.save-status[data-state="saved"]');
  await page.waitForSelector('.editor-banners .notice-warning', { timeout: 5000 });
  expect(/changed in another tab/.test(await text('.editor-banners')), 'no cross-tab warning');
  await page.fill('#f-title', 'Serengeti NP (edited in tab A)');
  await save();
  expect(/changed elsewhere/.test(await status()), await status());
  expect(await page.getByRole('button', { name: 'Reload latest version' }).count() > 0, 'no reload option');
  const stored = await page.evaluate(async id => (await (await window.__vionApp.workspace()).content.get(id)).record.title, destId);
  expect(stored === 'Serengeti NP (edited in tab B)', `tab A overwrote: ${stored}`);
  await page.getByRole('button', { name: 'Reload latest version' }).first().click();
  await dialogButton('Discard and reload');
  expect(await page.inputValue('#f-title') === 'Serengeti NP (edited in tab B)', 'reload latest');
  await other.close();
});
await check('Simulated storage quota failure never reports success and keeps stored data', async () => {
  await page.evaluate(async () => (await window.__vionApp.workspace()).faults.failNext('saveDraft', 'QuotaExceededError'));
  await page.fill('#f-title', 'Should not persist');
  await save();
  const s = await status();
  expect(/no storage space/.test(s) && !/saved/i.test(s.replace('Not saved', '')), s);
  const stored = await page.evaluate(async id => (await (await window.__vionApp.workspace()).content.get(id)).record.title, destId);
  expect(stored === 'Serengeti NP (edited in tab B)', `failed save persisted: ${stored}`);
  await page.fill('#f-title', stored);
});

// ---- 6. Navigation guard ----
await check('Dirty editor warns on navigation; cancel keeps the form; back button is guarded', async () => {
  await open(`#/destinations/new`);
  await page.waitForSelector('#f-title');
  await open(`#/destinations/${destId}`);
  await page.waitForSelector('#f-title');
  await page.fill('#f-title', 'Unsaved title edit');
  await openNav(page, 'Accommodations', 'Accommodations List');
  await page.waitForSelector('dialog[open]');
  await dialogButton('Stay and keep editing');
  expect(await page.inputValue('#f-title') === 'Unsaved title edit', 'form lost after cancel');
  expect((await page.evaluate(() => location.hash)).includes(destId), 'URL changed after cancel');
  await page.goBack();
  await page.waitForSelector('dialog[open]');
  await dialogButton('Stay and keep editing');
  expect(await page.inputValue('#f-title') === 'Unsaved title edit', 'form lost after back');
  await page.locator('.submenu button', { hasText: 'Accommodations List' }).click();
  await dialogButton('Leave and discard changes');
  await page.waitForSelector('#moduleRoot h1');
  expect(await page.evaluate(() => location.hash) === '#/accommodations', 'did not navigate after confirm');
  await page.goBack();
  await page.waitForSelector('#f-title');
  expect((await page.inputValue('#f-title')).startsWith('Serengeti NP'), 'discarded edit persisted');
});

// ---- 7. Escaping ----
await check('Markup in titles and text is displayed as text, never executed', async () => {
  await open(`#/destinations/new`);
  await page.fill('#f-title', '<img src=x onerror="window.__xss=1">Hack');
  await tab('Content');
  await page.fill('#f-overview', '<script>window.__xss=2</script> plain');
  await save();
  const id = await currentId();
  await open(`#/destinations`);
  await page.waitForSelector('#moduleRoot tbody');
  expect((await text('#moduleRoot tbody')).includes('<img src=x onerror="window.__xss=1">Hack'), 'title not shown literally');
  await open(`#/destinations/${id}/preview`);
  await page.waitForSelector('.preview-page');
  expect((await text('.preview-page')).includes('<script>window.__xss=2</script>'), 'overview not literal');
  expect(await page.evaluate(() => window.__xss === undefined && !document.querySelector('img[src="x"]')), 'markup executed');
});

await check('Changing a published slug plans a local 308 redirect, listed and resolved in the local preview', async () => {
  await open(`#/destinations/${destId}`);
  await page.fill('#f-slug', 'serengeti');
  await markStatus(page);
  await page.click('[data-action="publish"]');
  await page.waitForSelector('dialog[open]');
  expect(/308 redirect/.test(await text('dialog[open]')), 'redirect not explained before publishing');
  await dialogButton('Publish locally');
  await page.waitForFunction(() => /Published locally/.test(document.querySelector('.save-status').textContent), null, { timeout: 10000 });
  await open('#/redirects');
  const table = await text('#moduleRoot tbody');
  expect(table.includes('/destinations/serengeti-national-park') && table.includes('/destinations/serengeti') && table.includes('308'), table);
  await open('#/site/destinations/serengeti-national-park');
  await page.waitForSelector('.preview-page');
  expect(/Planned local 308 redirect/.test(await text('#moduleRoot')), 'old route not resolved via the planned redirect');
});

// ---- 8. Persistence, backup and import ----
await check('Records and uploaded images survive a full browser reload', async () => {
  await open(`#/media`);
  await page.reload();
  await page.waitForSelector('.library-card');
  await page.waitForFunction(() => [...document.querySelectorAll('.library-card img')].every(img => img.naturalWidth > 0), null, { timeout: 5000 });
  expect(/Used in 3 places|Used in [3-9]/.test(await text('.library-grid')), await text('.library-grid'));
  await open(`#/tours`);
  await page.waitForSelector('#tours-search');
  const listed = await text('#moduleRoot');
  expect(/Northern Circuit Safari/.test(listed), `tour missing after reload: ${listed.slice(0, 300)}`);
});
await check('Referenced images cannot be deleted', async () => {
  await open(`#/media`);
  await page.waitForSelector('.library-card');
  expect(await page.locator('.library-card').first().getByRole('button', { name: 'Delete' }).isDisabled(), 'delete enabled for used image');
});
let dataFile;
let mediaFile;
await check('JSON export states binary exclusion; media backup is separate', async () => {
  await open(`#/backup`);
  await page.waitForSelector('.storage-status p');
  const [d1] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download data backup/ }).click()]);
  dataFile = join(outDir, 'data.json');
  await d1.saveAs(dataFile);
  const data = JSON.parse(readFileSync(dataFile, 'utf8'));
  expect(data.format === 'vion-cms-local-backup' && data.schemasVersion === 3 && data.binaryAssetsIncluded === false && /does NOT contain image files/.test(data.notice), 'data backup header');
  expect(data.records.length >= 6 && data.assets.length === 1 && !JSON.stringify(data).includes('dataBase64'), 'data backup contents');
  const [d2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download media backup/ }).click()]);
  mediaFile = join(outDir, 'media.json');
  await d2.saveAs(mediaFile);
  const media = JSON.parse(readFileSync(mediaFile, 'utf8'));
  expect(media.binaryAssetsIncluded === true && media.assets.length === 1 && media.assets[0].dataBase64.length > 1000, 'media backup contents');
  return `${data.records.length} records, ${data.published.length} snapshots, ${data.redirects.length} redirects`;
});
await check('Import round-trip into a fresh browser profile restores records, snapshots and images', async () => {
  const fresh = await newContext();
  const p2 = watch(await fresh.newPage());
  await p2.goto(`${base}/#/backup`);
  await p2.waitForSelector('#import-data-file', { state: 'attached' });
  await p2.setInputFiles('#import-data-file', dataFile);
  await p2.waitForSelector('dialog[open]');
  await p2.locator('dialog[open]').getByRole('button', { name: 'Replace local content' }).click();
  await p2.waitForSelector('text=Import complete');
  await p2.setInputFiles('#import-media-file', mediaFile);
  await p2.waitForSelector('text=Media restored');
  await p2.goto(`${base}/#/site/destinations/serengeti-national-park`);
  await p2.waitForSelector('.preview-page');
  await p2.waitForFunction(() => document.querySelector('.preview-hero img')?.naturalWidth > 0, null, { timeout: 5000 });
  expect(/Serengeti NP/.test(await p2.locator('.preview-page').innerText()), 'imported published destination missing');
  expect(/Planned local 308 redirect/.test(await p2.locator('#moduleRoot').innerText()), 'imported redirect not resolved');
  await p2.goto(`${base}/#/tours`);
  await p2.waitForSelector('#moduleRoot tbody');
  expect(/Northern Circuit Safari/.test(await p2.locator('#moduleRoot tbody').innerText()), 'imported tour missing');
  await open('#/destinations', p2);
  expect((await p2.locator('#moduleRoot tbody').innerText()).includes('<img src=x onerror="window.__xss=1">Hack'), 'imported markup not shown as text');
  expect(await p2.evaluate(() => window.__xss === undefined && !document.querySelector('img[src="x"]')), 'imported markup executed');
  await fresh.close();
});
await check('Malicious or invalid imports are rejected completely with actionable errors', async () => {
  const data = JSON.parse(readFileSync(dataFile, 'utf8'));
  const acc = data.records.find(r => r.kind === 'accommodation');
  acc.record.website = 'javascript:alert(document.cookie)';
  data.assets.push({ ...data.assets[0], id: '11111111-1111-4111-8111-111111111111', fileName: 'evil.svg', type: 'image/svg+xml' });
  const bad = join(outDir, 'bad.json');
  writeFileSync(bad, JSON.stringify(data));
  await open(`#/backup`);
  await page.waitForSelector('#import-data-file', { state: 'attached' });
  const before = await page.evaluate(async () => (await (await window.__vionApp.workspace()).loadContext()).records.size);
  await page.setInputFiles('#import-data-file', bad);
  await page.waitForSelector('text=Backup rejected');
  const out = await text('#moduleRoot');
  expect(/rejected for safety/.test(out) && /SVG/.test(out), 'errors not specific');
  expect(await page.locator('dialog[open]').count() === 0, 'confirm shown for invalid backup');
  const after = await page.evaluate(async () => (await (await window.__vionApp.workspace()).loadContext()).records.size);
  expect(before === after, 'data changed by rejected import');
  const svgMedia = join(outDir, 'svg-media.json');
  writeFileSync(svgMedia, JSON.stringify({ format: 'vion-cms-local-media-backup', schemasVersion: 1, assets: [{ id: '22222222-2222-4222-8222-222222222222', fileName: 'x.png', type: 'image/png', dataBase64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>').toString('base64') }] }));
  await page.setInputFiles('#import-media-file', svgMedia);
  await page.waitForSelector('text=media backup was rejected');
});
await check('Invalid image uploads (SVG, fake image) are rejected in the picker', async () => {
  await open(`#/media`);
  await page.setInputFiles('#library-upload', [
    { name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') },
    { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('this is not an image') }
  ]);
  await page.waitForSelector('.upload-results');
  const out = await text('.upload-results');
  expect(/SVG files are not accepted/.test(out) && /not a JPEG, PNG or WebP/.test(out), out);
});

// ---- 8b. Site settings and team ----
async function uploadInto(selector, fileName, width = 1200, height = 1200) {
  await page.locator(selector).first().click();
  await page.waitForSelector('dialog[open]');
  await page.setInputFiles('#media-upload-input', { name: fileName, mimeType: 'image/png', buffer: await makeImage(width, height) });
  await page.waitForSelector('dialog[open] .upload-results');
  await dialogButton('Use image');
}
async function reuseInto(selector, fileName) {
  await page.locator(selector).first().click();
  await page.waitForSelector('dialog[open] .asset-tile');
  await page.locator('dialog[open] .asset-tile', { hasText: fileName }).first().click();
  await dialogButton('Use image');
}
const gridNames = (target = page) => target.$$eval('.team-grid .team-card h3', els => els.map(e => e.textContent));
const tableNames = () => page.$$eval('.team-table tbody .cell-title a', els => els.map(e => e.textContent));
async function waitTableOrder(names) {
  await page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('.team-table tbody .cell-title a')].map(a => a.textContent)) === JSON.stringify(expected), names, { timeout: 10000 });
}
async function publishOrder() {
  await page.click('[data-action="publish-lineup"]');
  await page.waitForSelector('dialog[open]');
  await dialogButton('Publish order & visibility');
  await page.waitForSelector('[data-action="publish-lineup"][disabled]', { timeout: 10000 });
}

await check('Settings submenu keeps Setting Options and adds Team; both open working screens; account Settings works', async () => {
  await open('#/dashboard');
  expect(await page.locator('.nav-toggle').count() === 15, 'sidebar groups changed');
  const settingsItems = await page.locator('.nav-group', { has: page.locator('.nav-toggle', { hasText: 'Settings' }) }).locator('.submenu button').allTextContents();
  expect(JSON.stringify(settingsItems) === JSON.stringify(['Setting Options', 'Team']), JSON.stringify(settingsItems));
  await openNav(page, 'Settings', 'Setting Options');
  await page.waitForSelector('#f-company-name');
  expect(await page.evaluate(() => location.hash) === '#/settings', 'Setting Options route');
  await openNav(page, 'Settings', 'Team');
  await page.waitForSelector('.lineup-panel');
  expect(await page.evaluate(() => location.hash) === '#/team' && (await text('#moduleRoot h1')) === 'Team', 'Team route');
  expect(await page.locator('.submenu button.selected', { hasText: 'Team' }).count() === 1, 'Team not highlighted');
  await open('#/dashboard');
  await page.click('#accountButton');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.waitForSelector('#f-company-name');
});

await check('Settings: empty draft; invalid values show field errors, a summary and focus; edits are kept; reload persists', async () => {
  await open('#/settings');
  expect(/Nothing entered yet/.test(await status()), await status());
  expect(await page.inputValue('#f-company-timezone') === 'Africa/Dar_es_Salaam', 'default timezone');
  expect(await page.inputValue('#f-company-name') === '', 'company name prefilled');
  await page.fill('#f-company-name', 'Example Safari Co');
  await tab('Contact');
  await page.fill('#f-contact-email', 'not-an-email');
  await page.fill('#f-contact-mapsUrl', 'javascript:alert(1)');
  await save();
  expect(/Not saved/.test(await status()), await status());
  expect(await page.evaluate(() => document.activeElement.id) === 'f-contact-email', `focused ${await page.evaluate(() => document.activeElement.id)}`);
  expect(/public email/.test(await text('#f-contact-email-error')) && /https/.test(await text('#f-contact-mapsUrl-error')), 'field errors');
  expect(await page.locator('.issue-summary.has-errors').count() === 1, 'no error summary');
  await tab('Company');
  expect(await page.inputValue('#f-company-name') === 'Example Safari Co', 'edit lost after failed save');
  await tab('Contact');
  await page.fill('#f-contact-email', 'info@example.com');
  await page.fill('#f-contact-mapsUrl', '');
  await save();
  expect(/Draft saved/.test(await status()), await status());
  await page.reload();
  await page.waitForSelector('#f-company-name');
  expect(await page.inputValue('#f-company-name') === 'Example Safari Co' && await page.evaluate(() => location.hash) === '#/settings', 'not persisted');
});

await check('Settings: publish minimum listed; bundled logo + sharing image; publish locally; footer links; draft vs published preview', async () => {
  await page.click('[data-action="publish"]');
  await page.waitForFunction(() => /Not ready to publish/.test(document.querySelector('.issue-summary')?.textContent || ''), null, { timeout: 10000 });
  const summary = await text('.issue-summary');
  for (const part of ['office address', 'primary public telephone', 'at least one usable logo', 'sharing image']) expect(summary.includes(part), `missing “${part}” in ${summary}`);
  expect(!/tagline|emergency/i.test(summary), 'optional fields required');
  await tab('Company');
  await page.fill('#f-company-officeAddress', '1 Example Road\nArusha');
  await page.fill('#f-company-tagline', 'Example tagline');
  await tab('Contact');
  await page.fill('#f-contact-primaryPhone', '+255 700 000 000');
  await tab('Branding');
  await page.locator('#f-branding-logoLight').locator('xpath=ancestor::div[contains(@class,"media-field")]').getByRole('button', { name: 'Use bundled Vion logo' }).click();
  expect(await page.inputValue('#f-branding-logoLight-alt') === 'Vion Africa Travel', 'bundled logo alt');
  await uploadInto('#f-branding-shareImage', 'share.png', 1200, 630);
  await tab('Social');
  await page.getByRole('button', { name: 'Add Instagram' }).click();
  await page.fill('#f-social-0-url', 'https://www.instagram.com/example');
  await tab('Review');
  await page.getByRole('button', { name: 'Add review link' }).click();
  await page.fill('#f-reviews-0-platform', 'Example Reviews');
  await page.fill('#f-reviews-0-url', 'https://reviews.example.com/vion');
  await page.fill('#f-reviews-0-buttonLabel', 'Read our reviews');
  await publish();
  expect(/Published locally/.test(await status()), await status());
  await open('#/site');
  await page.waitForSelector('.company-summary');
  expect(/Example Safari Co/.test(await text('.company-summary')), 'company summary');
  const footerLinks = await page.$$eval('.site-footer a', as => as.map(a => [a.textContent, a.getAttribute('href')]));
  expect(footerLinks.some(([t, h]) => h === 'tel:+255700000000') && footerLinks.some(([t, h]) => t === 'Instagram' && h === 'https://www.instagram.com/example') && footerLinks.some(([t, h]) => t === 'Read our reviews'), JSON.stringify(footerLinks));
  await page.waitForFunction(() => document.querySelector('.site-footer img')?.getAttribute('src') === 'assets/logo-dark.svg', null, { timeout: 5000 });
  await open('#/settings');
  await page.fill('#f-company-name', 'DRAFT Name Co');
  await save();
  expect(/published version unchanged/.test(await status()), await status());
  await open('#/settings/preview?rev=published');
  expect(/Example Safari Co/.test(await text('.preview-frame')) && !/DRAFT Name Co/.test(await text('.preview-frame')), 'published preview changed by draft');
  expect(/NOT shown here/.test(await page.locator('#moduleRoot .notice-info').first().innerText()), 'unpublished-changes notice');
  await open('#/settings/preview?rev=draft');
  expect(/DRAFT Name Co/.test(await text('.preview-frame')), 'draft preview');
  expect(/Production metadata and the live website are not fetched or changed/.test(await text('.preview-frame')), 'SEO disclaimer');
  await open('#/site');
  expect(!/DRAFT Name Co/.test(await text('#moduleRoot')), 'local site shows unpublished settings draft');
});

await check('Settings: duplicate visible networks and unsafe social links are rejected at save', async () => {
  await open('#/settings');
  await tab('Social');
  await page.getByRole('button', { name: 'Add Instagram' }).click();
  await page.fill('#f-social-1-url', 'javascript:alert(1)');
  await save();
  expect(/Not saved/.test(await status()), await status());
  expect(/duplicate visible networks/.test(await text('#f-social-1-network-error')) && /rejected for safety/.test(await text('#f-social-1-url-error')), 'social errors');
  await page.getByRole('button', { name: /Remove Social profile 2/ }).click();
  await dialogButton('Remove');
  expect(!(await page.evaluate(() => window.__vionApp.currentView().isDirty())), 'removing the extra entry should leave nothing to save');
});

await check('Settings editor: unsaved changes guard for navigation and Back; cancel keeps the form', async () => {
  await open('#/team');
  await open('#/settings');
  await page.fill('#f-company-tagline', 'Unsaved tagline');
  await openNav(page, 'Settings', 'Team');
  await page.waitForSelector('dialog[open]');
  await dialogButton('Stay and keep editing');
  expect(await page.inputValue('#f-company-tagline') === 'Unsaved tagline' && await page.evaluate(() => location.hash) === '#/settings', 'form lost after Stay');
  await page.goBack();
  await page.waitForSelector('dialog[open]');
  await dialogButton('Stay and keep editing');
  expect(await page.inputValue('#f-company-tagline') === 'Unsaved tagline', 'form lost after Back');
  await page.locator('.submenu button', { hasText: 'Team' }).click();
  await dialogButton('Leave and discard changes');
  await page.waitForSelector('.lineup-panel');
  await open('#/settings');
  expect(await page.inputValue('#f-company-tagline') === 'Example tagline', 'discarded edit persisted');
});

const teamIds = {};
await check('Team: create profiles with portraits and alt text, save, reload and publish profile content', async () => {
  for (const [i, name] of ['Asha Example', 'Baraka Example', 'Chausiku Example'].entries()) {
    await open('#/team/new');
    await page.fill('#f-name', name);
    await page.fill('#f-position', 'Safari planner');
    await page.fill('#f-bio', `${name} plans safaris.\n\nSecond paragraph.`);
    await tab('Portrait');
    if (i === 0) await uploadInto('#f-portrait', 'asha.png', 800, 1000);
    else await reuseInto('#f-portrait', 'asha.png');
    await page.fill('#f-portrait-alt', `Portrait of ${name}`);
    await save();
    expect(/Draft saved/.test(await status()), await status());
    teamIds[name] = await currentId();
    expect(/^[0-9a-f-]{36}$/.test(teamIds[name]), `URL not updated: ${teamIds[name]}`);
  }
  await page.reload();
  await page.waitForSelector('#f-name');
  expect(await page.inputValue('#f-name') === 'Chausiku Example', 'profile lost after reload');
  for (const name of Object.keys(teamIds)) {
    await open(`#/team/${teamIds[name]}`);
    await publish();
    expect(/Published locally/.test(await status()), `${name}: ${await status()}`);
  }
  expect(/not in the published team order|appears on the local team page once/.test(await text('.editor-banners') + await page.locator('#toast').textContent()), 'two-step publication not explained');
  await open('#/site/team');
  expect((await gridNames()).length === 0, 'profiles shown before the order was published');
});

await check('Team: keyboard Move up/down keeps focus; published page changes only after “Publish order & visibility”', async () => {
  await open('#/team');
  await waitTableOrder(['Asha Example', 'Baraka Example', 'Chausiku Example']);
  await publishOrder();
  await open('#/site/team');
  expect(JSON.stringify(await gridNames()) === JSON.stringify(['Asha Example', 'Baraka Example', 'Chausiku Example']), JSON.stringify(await gridNames()));
  await open('#/team');
  await page.getByRole('button', { name: 'Move Chausiku Example up' }).focus();
  await page.keyboard.press('Enter');
  await waitTableOrder(['Asha Example', 'Chausiku Example', 'Baraka Example']);
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Move Chausiku Example up', null, { timeout: 5000 });
  await page.keyboard.press('Enter');
  await waitTableOrder(['Chausiku Example', 'Asha Example', 'Baraka Example']);
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Move Chausiku Example down', null, { timeout: 5000 });
  expect(/Unpublished order changes/.test(await text('.lineup-panel')), 'draft order change not flagged');
  await open('#/site/team');
  expect(JSON.stringify(await gridNames()) === JSON.stringify(['Asha Example', 'Baraka Example', 'Chausiku Example']), 'published order changed before publishing');
  await open('#/team/preview?rev=draft');
  expect(JSON.stringify(await gridNames()) === JSON.stringify(['Chausiku Example', 'Asha Example', 'Baraka Example']), 'draft team preview order');
  await open('#/team');
  await page.getByLabel('Show Baraka Example on the team page (draft)').uncheck();
  await page.waitForFunction(() => /Draft team order saved/.test(document.querySelector('.lineup-panel .save-status')?.textContent || ''), null, { timeout: 5000 });
  await publishOrder();
  await open('#/site/team');
  expect(JSON.stringify(await gridNames()) === JSON.stringify(['Chausiku Example', 'Asha Example']), JSON.stringify(await gridNames()));
});

await check('Team: profile draft edits are not published by order changes; unpublish and archive remove profiles; restore needs republish', async () => {
  await open(`#/team/${teamIds['Asha Example']}`);
  await page.fill('#f-bio', 'DRAFT ONLY biography.');
  await save();
  expect(/published version unchanged/.test(await status()), await status());
  await open('#/team');
  await page.getByRole('button', { name: 'Move Asha Example up' }).click();
  await waitTableOrder(['Asha Example', 'Chausiku Example', 'Baraka Example']);
  await publishOrder();
  await open(`#/site/team/${teamIds['Asha Example']}`);
  await page.waitForSelector('.member-page');
  const body = await text('.member-page');
  expect(/Asha Example plans safaris/.test(body) && !/DRAFT ONLY/.test(body), 'publishing the order published a profile draft');
  await open(`#/team/${teamIds['Asha Example']}`);
  await page.getByRole('button', { name: 'Unpublish' }).click();
  await dialogButton('Unpublish');
  await page.waitForFunction(() => /Unpublished/.test(document.querySelector('.save-status').textContent), null, { timeout: 10000 });
  await open('#/site/team');
  expect(JSON.stringify(await gridNames()) === JSON.stringify(['Chausiku Example']), JSON.stringify(await gridNames()));
  await open('#/team');
  await page.getByRole('button', { name: 'Archive Chausiku Example' }).click();
  await dialogButton('Archive');
  await page.getByRole('button', { name: 'Archive Chausiku Example' }).waitFor({ state: 'detached' });
  await open('#/site/team');
  expect((await gridNames()).length === 0 && /No profiles to show/.test(await text('#moduleRoot')), 'archived profile still shown');
  await open('#/team?status=archived');
  await page.getByRole('button', { name: 'Restore Chausiku Example to draft' }).click();
  await page.getByRole('button', { name: 'Restore Chausiku Example to draft' }).waitFor({ state: 'detached' });
  await open(`#/team/${teamIds['Chausiku Example']}`);
  expect((await text('.editor-badges')).includes('Draft') && /not published/.test(await text('.editor-banners')), 'restored profile not a draft');
});

await check('Team: unsafe links rejected with focus; biography and names shown as text, never executed', async () => {
  await open('#/team/new');
  await page.fill('#f-name', '<img src=x onerror="window.__xss=3">Tester');
  await page.fill('#f-bio', '<script>window.__xss=4</script> plain text');
  await tab('Links');
  await page.getByRole('button', { name: 'Add link' }).click();
  await page.fill('#f-links-0-label', 'Profile');
  await page.fill('#f-links-0-url', 'javascript:alert(1)');
  await save();
  expect(/Not saved/.test(await status()) && await page.evaluate(() => document.activeElement.id) === 'f-links-0-url', `status ${await status()}`);
  expect(/rejected for safety/.test(await text('#f-links-0-url-error')), 'link error');
  await page.fill('#f-links-0-url', 'https://www.example.com/profile');
  await save();
  const id = await currentId();
  await open(`#/team/${id}/preview`);
  await page.waitForSelector('.member-page');
  const body = await text('.member-page');
  expect(body.includes('<img src=x onerror="window.__xss=3">Tester') && body.includes('<script>window.__xss=4</script>'), 'markup not literal');
  expect(await page.evaluate(() => window.__xss === undefined && !document.querySelector('img[src="x"]')), 'markup executed');
  expect(JSON.stringify(await page.$$eval('.member-page a', as => as.map(a => a.getAttribute('href')))) === '["https://www.example.com/profile"]', 'links');
  await open('#/team');
  await page.getByRole('button', { name: /Archive <img/ }).click();
  await dialogButton('Archive');
  await page.getByRole('button', { name: /Archive <img/ }).waitFor({ state: 'detached' });
});

await check('Media: portraits and settings images in use cannot be deleted', async () => {
  await open('#/media');
  await page.waitForSelector('.library-card');
  for (const fileName of ['asha.png', 'share.png']) {
    const card = page.locator('.library-card', { hasText: fileName });
    expect(await card.getByRole('button', { name: 'Delete' }).isDisabled(), `${fileName} deletable while used`);
  }
  const usage = await page.locator('.library-card', { hasText: 'asha.png' }).locator('.usage').textContent();
  expect(/Team profile “Asha Example”/.test(usage) && /portrait, published snapshot|portrait, working draft/.test(usage), usage);
  const shareUsage = await page.locator('.library-card', { hasText: 'share.png' }).locator('.usage').textContent();
  expect(/Site settings/.test(shareUsage) && /default sharing image/.test(shareUsage), shareUsage);
});

await check('Backup: data + media round-trip restores settings, team order and portraits; an older backup keeps site data', async () => {
  await open('#/backup');
  await page.waitForSelector('.storage-status p');
  expect(/Site settings: saved and published/.test(await text('.storage-status')), await text('.storage-status'));
  const [d1] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download data backup/ }).click()]);
  const siteData = join(outDir, 'site-data.json');
  await d1.saveAs(siteData);
  const [d2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download media backup/ }).click()]);
  const siteMedia = join(outDir, 'site-media.json');
  await d2.saveAs(siteMedia);
  const data = JSON.parse(readFileSync(siteData, 'utf8'));
  expect(data.schemasVersion === 3 && data.siteRecords.length === 6 && data.sitePublished.some(p => p.id === 'team-lineup'), `site collections: ${data.siteRecords.length}`);
  const fresh = await newContext();
  const p2 = watch(await fresh.newPage());
  await p2.goto(`${base}/#/backup`);
  await p2.waitForSelector('#import-data-file', { state: 'attached' });
  await p2.setInputFiles('#import-data-file', siteData);
  await p2.waitForSelector('dialog[open]');
  expect(/site settings, \d+ team profiles?/.test(await p2.locator('dialog[open]').innerText()), 'confirm does not mention site data');
  await p2.locator('dialog[open]').getByRole('button', { name: 'Replace local content' }).click();
  await p2.waitForSelector('text=Import complete');
  await p2.setInputFiles('#import-media-file', siteMedia);
  await p2.waitForSelector('text=Media restored');
  await open('#/site/team', p2);
  const restored = await gridNames(p2);
  expect(restored.length === 0, `published team page should match the source (no published, visible profiles): ${JSON.stringify(restored)}`);
  await open('#/team/preview?rev=draft', p2);
  expect(JSON.stringify(await gridNames(p2)) === JSON.stringify(['Asha Example', 'Baraka Example', 'Chausiku Example']), `draft order not restored: ${JSON.stringify(await gridNames(p2))}`);
  await p2.waitForFunction(() => [...document.querySelectorAll('.team-grid img')].length > 0 && [...document.querySelectorAll('.team-grid img')].every(img => img.naturalWidth > 0), null, { timeout: 5000 });
  await open('#/site', p2);
  expect(/Example Safari Co/.test(await p2.locator('.company-summary').innerText()), 'published settings not restored');
  await open('#/settings', p2);
  expect(await p2.inputValue('#f-company-name') === 'DRAFT Name Co', 'settings draft not restored');
  // An older (schemasVersion 1) backup: the confirm explains that settings and team are kept.
  const legacy = JSON.parse(readFileSync(dataFile, 'utf8'));
  for (const key of ['siteRecords', 'sitePublished', 'taxonomyPublication', 'dayTripDefaults']) delete legacy[key];
  legacy.schemasVersion = 1;
  legacy.taxonomies = legacy.taxonomies.map(({ key, order, active, ...t }) => t);
  const legacyFile = join(outDir, 'legacy-v1.json');
  writeFileSync(legacyFile, JSON.stringify(legacy));
  await open('#/backup', p2);
  await p2.setInputFiles('#import-data-file', legacyFile);
  await p2.waitForSelector('dialog[open]');
  expect(/made before Site Settings, Team and Day Trips existed/.test(await p2.locator('dialog[open]').innerText()), 'legacy notice missing');
  await p2.locator('dialog[open]').getByRole('button', { name: 'Replace local content' }).click();
  await p2.waitForSelector('text=Import complete');
  expect(/6 site records/.test(await p2.locator('#moduleRoot').innerText()), await p2.locator('#moduleRoot .notice-success').innerText());
  await open('#/settings', p2);
  expect(await p2.inputValue('#f-company-name') === 'DRAFT Name Co', 'legacy import removed settings');
  await open('#/team/preview?rev=draft', p2);
  await p2.waitForFunction(() => [...document.querySelectorAll('.team-grid img')].length > 0 && [...document.querySelectorAll('.team-grid img')].every(img => img.naturalWidth > 0), null, { timeout: 5000 });
  await fresh.close();
});

await check('Mobile: settings, team list and local site fit 390px; ordering buttons work', async () => {
  const mobile = await newContext({ width: 390, height: 844 });
  const m = watch(await mobile.newPage());
  await m.goto(`${base}/`);
  await m.click('#menuButton');
  await openNav(m, 'Settings', 'Setting Options');
  await m.waitForSelector('#f-company-name');
  expect(await m.locator('#sidebar.open').count() === 0, 'sidebar did not close');
  expect(await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, 'settings page overflows');
  await m.getByRole('tab', { name: 'Branding' }).click();
  expect(await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, 'branding tab overflows');
  await m.screenshot({ path: join(outDir, 'mobile-settings.png') });
  for (const name of ['Mobile One', 'Mobile Two']) {
    await open('#/team/new', m);
    await m.fill('#f-name', name);
    await m.click('[data-action="save"]');
    await m.waitForSelector('.save-status[data-state="saved"]');
  }
  await open('#/team', m);
  await m.waitForSelector('.team-table');
  await m.getByRole('button', { name: 'Move Mobile Two up' }).click();
  await m.waitForFunction(() => document.querySelector('.team-table tbody .cell-title a')?.textContent === 'Mobile Two', null, { timeout: 5000 });
  expect(await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, 'team list overflows');
  expect(await m.evaluate(() => getComputedStyle(document.querySelector('#moduleRoot .table-scroll')).overflowX) === 'auto', 'team table does not scroll');
  await m.screenshot({ path: join(outDir, 'mobile-team.png') });
  await open('#/site', m);
  expect(await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, 'local site overflows');
  await mobile.close();
});
await page.screenshot({ path: join(outDir, 'desktop-team.png') });

// ---- 8b. Phase 3: taxonomies and day trips ----
const noOverflow = target => target.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 0);

await check('Taxonomies: Tour Packages entry; per-group terms; blank, duplicate and malformed values rejected; keyboard order keeps focus; search; publish', async () => {
  await open('#/dashboard');
  await openNav(page, 'Tour Packages', 'Taxonomies');
  await page.waitForFunction(() => { const r = document.getElementById('moduleRoot'); return r.dataset.ready === 'true' && r.dataset.renderedRoute === '#/taxonomies'; });
  expect((await page.locator('#moduleRoot h1').textContent()) === 'Taxonomies', 'heading');
  const labels = await page.$$eval('#submenu-1 button', els => els.map(e => e.textContent));
  expect(JSON.stringify(labels) === JSON.stringify(['Tours List', 'Add Tour', 'Activities / day trips', 'Add Activity', 'Taxonomies']), JSON.stringify(labels));
  expect(/await owner confirmation/.test(await text('#moduleRoot')) && /nothing is pre-filled/.test(await text('#moduleRoot')), 'neutral explanation missing');
  await tab('Tour tags');
  const add = async (label, key = '') => {
    await page.fill('#term-new-tag-label', label);
    await page.fill('#term-new-tag-key', key);
    await page.click('#taxonomy-panel-tag button:has-text("Add tour tag")');
  };
  await page.fill('#term-new-tag-label', 'Birding');
  expect(await page.inputValue('#term-new-tag-key') === 'birding', 'key not suggested');
  for (const label of ['Birding', 'Culture', 'Marine']) {
    await add(label);
    await page.waitForSelector(`#taxonomy-panel-tag td.cell-title strong:text-is("${label}")`);
  }
  await add(' birding ');
  await page.waitForSelector('#term-new-tag-label-error:not([hidden])');
  expect(/already exists as a tour tag/.test(await text('#term-new-tag-label-error')), await text('#term-new-tag-label-error'));
  await add('Night walks', 'Night Walks');
  await page.waitForSelector('#term-new-tag-key-error:not([hidden])');
  expect(/lowercase letters/.test(await text('#term-new-tag-key-error')) && await page.evaluate(() => document.activeElement.id) === 'term-new-tag-key', 'malformed key not focused');
  await add('   ');
  await page.waitForFunction(() => /Blank labels/.test(document.getElementById('term-new-tag-label-error').textContent));
  await page.getByRole('button', { name: 'Move Marine up' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('#taxonomy-panel-tag td.cell-title strong')].map(e => e.textContent).join() === 'Birding,Marine,Culture');
  expect(await page.evaluate(() => document.activeElement.getAttribute('aria-label')) === 'Move Marine up', 'focus did not stay on the moved term');
  await page.fill('#taxonomy-search', 'mar');
  await page.waitForFunction(() => document.querySelectorAll('#taxonomy-panel-tag tbody tr').length === 1);
  expect(await page.locator('#taxonomy-panel-tag button[aria-label^="Move"]').count() === 0, 'ordering offered while filtered');
  await page.fill('#taxonomy-search', '');
  const cultureId = await page.getAttribute('button[aria-label="Edit Culture"]', 'data-term');
  await page.click('button[aria-label="Edit Culture"]');
  await page.fill('#term-edit-label', 'Cultural visits');
  await dialogButton('Save');
  await page.waitForSelector('button[aria-label="Edit Cultural visits"]');
  expect(await page.getAttribute('button[aria-label="Edit Cultural visits"]', 'data-term') === cultureId, 'rename changed the ID');
  expect(/Key culture/.test(await text('#taxonomy-panel-tag')), 'key changed on rename');
  await tab('Tour types');
  await page.fill('#term-new-type-label', 'Private safari');
  await page.click('#taxonomy-panel-type button:has-text("Add tour type")');
  await page.waitForSelector('#taxonomy-panel-type td.cell-title strong:text-is("Private safari")');
  expect(/4 unpublished changes/.test(await text('.taxonomy-publication')), await text('.taxonomy-publication'));
  await page.click('[data-action="publish-taxonomy"]');
  await dialogButton('Publish taxonomy changes');
  await page.waitForFunction(() => /Published taxonomy is up to date/.test(document.querySelector('.taxonomy-publication').textContent));
  await tab('Tour tags');
  expect(!/\bnull\b|undefined/.test(await text('#moduleRoot')), 'stray null/undefined text rendered');
  await page.screenshot({ path: join(outDir, 'desktop-taxonomies.png'), fullPage: true });
});

await check('Tours: selectors offer active managed terms; an inactive saved selection stays, is flagged and does not block unrelated saves', async () => {
  await open('#/tours/new');
  await page.fill('#f-title', 'Culture walk tour');
  await tab('Destinations & classification');
  await page.selectOption('#f-typeId', { label: 'Private safari' });
  await page.locator('#f-tagIds label.check', { hasText: 'Cultural visits' }).locator('input').check();
  await save();
  expect(/Draft saved/.test(await status()), await status());
  const tourHash = await page.evaluate(() => location.hash);
  await open('#/taxonomies?group=tag');
  await page.getByRole('button', { name: 'Deactivate Cultural visits' }).click();
  expect(/Used by 1 record version; it keeps the term/.test(await page.locator('dialog[open]').innerText()), 'usage not explained');
  await dialogButton('Deactivate');
  await page.waitForSelector('button[aria-label="Activate Cultural visits"]');
  await open(tourHash);
  expect(/Term selections need attention/.test(await text('.editor-banners')), 'no inactive warning');
  await tab('Destinations & classification');
  const kept = page.locator('#f-tagIds label.check', { hasText: 'Cultural visits (inactive — kept)' }).locator('input');
  expect(await kept.isChecked(), 'inactive selection dropped');
  await tab('Basics');
  await page.fill('#f-title', 'Culture walk tour (edited)');
  await save();
  expect(/Draft saved/.test(await status()), await status());
  expect(/is inactive/.test(await text('.issue-summary')), 'warning not shown after saving');
  await open('#/tours/new');
  await tab('Destinations & classification');
  expect(await page.locator('#f-tagIds', { hasText: 'Cultural visits' }).count() === 0, 'inactive tag offered for a new selection');
  expect(await page.locator('#f-tagIds label.check', { hasText: 'Birding' }).count() === 1, 'active tag missing');
});

await check('Day-trip defaults: nothing pre-filled; lists save and survive reload', async () => {
  await open('#/day-trips/defaults');
  expect(/approved text was not provided/.test(await text('#moduleRoot')), 'proposed-behaviour notice');
  expect(await page.locator('#moduleRoot .repeater-item').count() === 0, 'defaults pre-filled');
  for (const value of ['Boat hire', 'Soft drinks']) { await page.fill('#f-defaults-inclusions', value); await page.keyboard.press('Enter'); }
  await page.fill('#f-defaults-whatToBring', 'Sun hat');
  await page.keyboard.press('Enter');
  await save();
  expect(/Defaults saved/.test(await status()) && /no day trip was changed/.test(await status()), await status());
  await page.reload();
  await page.waitForSelector('#f-defaults-inclusions');
  expect(await page.locator('#moduleRoot .repeater-item').count() === 3, 'defaults not persisted');
  await page.screenshot({ path: join(outDir, 'desktop-defaults.png'), fullPage: true });
  await page.fill('#f-defaults-whatToBring', 'Torch');
  await page.keyboard.press('Enter');
  await openNav(page, 'Tour Packages', 'Tours List');
  await page.waitForSelector('dialog[open]');
  await dialogButton('Stay and keep editing');
  expect(await page.evaluate(() => location.hash) === '#/day-trips/defaults' && await page.locator('#moduleRoot .repeater-item').count() === 4, 'unsaved-changes guard did not keep the edit');
  await page.getByRole('button', { name: 'Remove item 2: Torch' }).click();
  await page.waitForFunction(() => document.querySelector('.save-status').dataset.state !== 'dirty');
});

let tripId;
await check('Day trips: Add Activity opens the editor; invalid duration rejected; defaults copied on request; schedule reorder keeps focus; publish and preview', async () => {
  await open('#/destinations/new');
  await page.fill('#f-title', 'Zanzibar Stone Town');
  await tab('Content');
  await page.fill('#f-overview', 'Historic streets and carved doors.');
  await page.fill('#f-bestTime', 'June to October.');
  await reuseCover('serengeti.png');
  await page.fill('#f-cover-alt', 'Carved wooden door in Stone Town');
  await publish();
  expect(/Published locally/.test(await status()), await status());

  await open('#/dashboard');
  await openNav(page, 'Tour Packages', 'Add Activity');
  await page.waitForFunction(() => { const r = document.getElementById('moduleRoot'); return r.dataset.ready === 'true' && r.dataset.renderedRoute === '#/day-trips/new'; });
  expect((await page.locator('#moduleRoot h1').textContent()) === 'New day trip', 'heading');
  await page.fill('#f-title', 'Sunset Dhow Cruise');
  expect(await page.inputValue('#f-slug') === 'sunset-dhow-cruise', 'slug not generated');
  expect(/\/tours\/day-trips\/sunset-dhow-cruise/.test(await text('.route-preview')), 'route preview');
  await page.fill('#f-duration-value', '0');
  await save();
  expect(/Not saved/.test(await status()) && /more than zero/.test(await text('#f-duration-value-error')), 'zero duration accepted');
  await page.fill('#f-duration-value', '2.5');
  await save();
  expect(/Draft saved/.test(await status()), await status());
  tripId = await currentId();
  await page.reload();
  await page.waitForSelector('#f-title');
  expect(await page.inputValue('#f-duration-value') === '2.5', 'duration lost on reload');

  await tab('Inclusions & preparation');
  await page.fill('#f-inclusions', 'Own inclusion');
  await page.keyboard.press('Enter');
  await page.click('#copy-defaults');
  await page.waitForSelector('dialog[open]');
  expect(/already has entries/.test(await page.locator('dialog[open]').innerText()) && /lists 1 inclusion/.test(await page.locator('dialog[open]').innerText()), 'no warning before changing populated lists');
  await dialogButton('Add missing defaults');
  await page.waitForFunction(() => /Added 2 default inclusions/.test(document.getElementById('copy-defaults-status')?.textContent || ''));
  const values = sel => page.$$eval(`fieldset:has(${sel}) .repeater-item input`, els => els.map(e => e.value));
  expect(JSON.stringify(await values('#f-inclusions')) === JSON.stringify(['Own inclusion', 'Boat hire', 'Soft drinks']), JSON.stringify(await values('#f-inclusions')));
  expect(JSON.stringify(await values('#f-whatToBring')) === JSON.stringify(['Sun hat']), 'what to bring not copied');
  await page.screenshot({ path: join(outDir, 'desktop-daytrip-inclusions.png'), fullPage: true });

  await tab('Overview & schedule');
  await page.fill('#f-overview', 'An evening sailing past Stone Town.');
  await page.click('#f-schedule');
  await page.fill('#f-schedule-0-heading', 'Boarding');
  await page.click('#f-schedule');
  await page.fill('#f-schedule-1-heading', 'Sunset');
  await page.getByRole('button', { name: 'Move Schedule item 2 up' }).focus();
  await page.keyboard.press('Enter');
  expect(await page.inputValue('#f-schedule-0-heading') === 'Sunset', 'schedule not reordered');
  expect(await page.evaluate(() => document.activeElement.closest('.repeater-item')?.querySelector('input')?.value) === 'Sunset', 'focus left the moved item');

  await page.click('[data-action="publish"]');
  await page.waitForSelector('.issue-summary.has-errors');
  const summary = await text('.issue-summary');
  expect(/Link at least one published destination/.test(summary) && /Choose a cover image/.test(summary) && !/exclusion/i.test(summary), summary);

  await tab('Destinations & tags');
  await page.locator('fieldset.relation-picker label.option', { hasText: 'Zanzibar Stone Town' }).locator('input').check();
  expect(await page.locator('#f-tagIds', { hasText: 'Cultural visits' }).count() === 0, 'inactive tag offered');
  await page.locator('#f-tagIds label.check', { hasText: 'Birding' }).locator('input').check();
  await reuseCover('serengeti.png');
  await page.fill('#f-cover-alt', 'Dhow sails against the sunset');
  await tab('Pricing');
  await page.check('#f-pricing-mode input[value="manualFrom"]');
  await page.fill('#f-pricing-currency', 'USD');
  await page.fill('#f-pricing-amount', '0');
  await page.selectOption('#f-pricing-basis', 'perGroup');
  await page.fill('#f-pricing-applicability', 'Private boat for up to 6 guests.');
  expect(/From USD.0 per group/.test(await text('.price-display')), await text('.price-display'));
  await publish();
  expect(/Published locally/.test(await status()), await status());
  await open(`#/day-trips/${tripId}/preview?rev=published`);
  const body = await text('.preview-page');
  for (const pattern of [/per group/, /Birding/, /2\.5 hours/, /Zanzibar Stone Town/, /Sunset[\s\S]*Boarding/, /What to bring[\s\S]*Sun hat/, /Own inclusion/]) expect(pattern.test(body), `${pattern} missing from preview`);
  expect(!/per person/.test(body), 'per person shown for a per-group price');
  expect(!/\bnull\b|undefined/.test(await text('#moduleRoot')), 'stray null/undefined text rendered');
  await page.screenshot({ path: join(outDir, 'desktop-daytrip-preview.png'), fullPage: true });
});

await check('Day trips: draft edits do not change the published preview; list search and status filters; duplicate', async () => {
  await open(`#/day-trips/${tripId}`);
  await tab('Overview & schedule');
  await page.fill('#f-overview', 'Changed draft overview.');
  await save();
  expect(/published version unchanged/.test(await status()), await status());
  await open(`#/day-trips/${tripId}/preview?rev=published`);
  expect(!/Changed draft overview/.test(await text('.preview-page')), 'draft leaked into the published snapshot');
  await open('#/day-trips/new');
  await page.fill('#f-title', 'Spice Farm Tour');
  await save();
  await open('#/day-trips?status=changes');
  const changed = await text('#moduleRoot .list-results');
  expect(/Sunset Dhow Cruise/.test(changed) && !/Spice Farm Tour/.test(changed), changed);
  await open('#/day-trips?q=spice');
  expect(/Spice Farm Tour/.test(await text('#moduleRoot .list-results')) && !/Sunset Dhow/.test(await text('#moduleRoot .list-results')), 'search');
  await open('#/day-trips?q=spice');
  await page.getByRole('button', { name: 'Duplicate Spice Farm Tour' }).click();
  await page.waitForFunction(() => /Spice Farm Tour \(copy\)/.test(document.querySelector('#moduleRoot h1')?.textContent || ''));
  expect(await page.inputValue('#f-slug') === 'spice-farm-tour-copy', 'duplicate slug');
});

await check('Local day-trip listing: published only; ?filter=tag&value= works; unknown filter and value stay readable; no management controls', async () => {
  await open('#/site/tours/day-trips');
  const listing = await text('#moduleRoot');
  expect(/Sunset Dhow Cruise/.test(listing) && !/Spice Farm Tour/.test(listing), 'drafts shown or published trip missing');
  expect(/#\/site\/tours\/day-trips/.test(listing), 'local URL equivalent not documented on the page');
  await page.locator('.filter-chip', { hasText: 'Birding' }).click();
  await page.waitForFunction(() => { const r = document.getElementById('moduleRoot'); return location.hash === '#/site/tours/day-trips?filter=tag&value=birding' && r.dataset.ready === 'true' && r.dataset.renderedRoute === location.hash; });
  expect(/1 day trip tagged “Birding”/.test(await text('.list-count')), await text('.list-count'));
  await page.screenshot({ path: join(outDir, 'desktop-daytrip-listing.png'), fullPage: true });
  await open('#/site/tours/day-trips?filter=tag&value=no-such-tag');
  expect(/No published tag has the key “no-such-tag”/.test(await text('#moduleRoot')) && await page.locator('#moduleRoot a', { hasText: 'Show all day trips' }).count() === 1, 'unknown value state');
  await open('#/site/tours/day-trips?filter=colour&value=red');
  expect(/not supported/.test(await text('.notice-warning')) && /Sunset Dhow Cruise/.test(await text('.card-grid')), 'invalid filter state');
  await open('#/site/tours/day-trips/sunset-dhow-cruise');
  const detail = await text('.preview-page');
  expect(/per group/.test(detail) && /Birding/.test(detail) && !/inactive|Unresolved|\bEdit\b|Key /.test(detail), detail.slice(0, 300));
  expect(await page.locator('#moduleRoot .site-footer').count() === 1, 'shared footer missing');
  await open('#/site');
  expect(/Sunset Dhow Cruise/.test(await text('#moduleRoot')), 'home page lacks published day trips');
});

await check('A destination used by a published day trip cannot be unpublished or archived; no cascade', async () => {
  const destinationId = await page.evaluate(async () => [...(await (await window.__vionApp.workspace()).loadContext()).records.values()].find(e => e.record.title === 'Zanzibar Stone Town').id);
  await open(`#/destinations/${destinationId}`);
  for (const [action, label, title] of [['unpublish', 'Unpublish', 'Cannot unpublish yet'], ['archive', 'Archive', 'Cannot archive yet']]) {
    await page.click(`[data-action="${action}"]`);
    await dialogButton(label);
    await page.waitForSelector('dialog[open]');
    const message = await page.locator('dialog[open]').innerText();
    expect(message.includes(title) && /Day trip “Sunset Dhow Cruise”/.test(message), message);
    await dialogButton('OK');
  }
  expect(await page.evaluate(async id => (await (await window.__vionApp.workspace()).loadContext()).published.has(id), destinationId), 'destination unpublished');
  expect(await page.evaluate(async id => (await (await window.__vionApp.workspace()).loadContext()).records.get(id).record.status, tripId) === 'published', 'day trip changed by the attempt');
});

await check('Team: after publishing a profile, “Review team visibility” opens the order and visibility panel without publishing the order', async () => {
  const id = await page.evaluate(async () => [...(await (await window.__vionApp.workspace()).loadContext()).siteRecords.values()].find(e => e.kind === 'teamMember' && e.record.status !== 'archived' && e.record.portrait && e.record.position)?.id);
  expect(id, 'no publishable profile');
  const lineupRevision = () => page.evaluate(async () => (await (await window.__vionApp.workspace()).site.getPublishedLineup())?.revision ?? null);
  const before = await lineupRevision();
  await open(`#/team/${id}`);
  await page.fill('#f-bio', `Updated biography ${Date.now()}.`);
  await publish();
  expect(/Published locally/.test(await status()), await status());
  await page.locator('.editor-banners a[data-action="review-visibility"]').click();
  await page.waitForFunction(() => location.hash === '#/team?focus=lineup' && document.getElementById('moduleRoot').dataset.ready === 'true');
  await page.waitForFunction(() => document.activeElement?.id === 'lineup-heading', null, { timeout: 5000 });
  await page.screenshot({ path: join(outDir, 'desktop-team-review.png') });
  expect(await lineupRevision() === before, 'the team order was published');
});

await check('Backup: day trips, defaults, terms and the published taxonomy round-trip; an older (v2) backup keeps local day trips', async () => {
  await open('#/backup');
  await page.waitForSelector('.storage-status p');
  const [d1] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download data backup/ }).click()]);
  const dtData = join(outDir, 'daytrip-data.json');
  await d1.saveAs(dtData);
  const [d2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download media backup/ }).click()]);
  const dtMedia = join(outDir, 'daytrip-media.json');
  await d2.saveAs(dtMedia);
  const data = JSON.parse(readFileSync(dtData, 'utf8'));
  const trips = data.records.filter(r => r.kind === 'dayTrip');
  expect(data.schemasVersion === 3 && trips.length === 3 && data.dayTripDefaults?.inclusions.length === 2 && data.taxonomyPublication?.terms.length === 4, `v3 contents: ${trips.length} trips`);
  const fresh = await newContext();
  const p2 = watch(await fresh.newPage());
  await p2.goto(`${base}/#/backup`);
  await p2.waitForSelector('#import-data-file', { state: 'attached' });
  await p2.setInputFiles('#import-data-file', dtData);
  await p2.waitForSelector('dialog[open]');
  expect(/3 day trips/.test(await p2.locator('dialog[open]').innerText()) && /day-trip defaults/.test(await p2.locator('dialog[open]').innerText()), 'confirm lacks day trips');
  await p2.locator('dialog[open]').getByRole('button', { name: 'Replace local content' }).click();
  await p2.waitForSelector('text=Import complete');
  await p2.setInputFiles('#import-media-file', dtMedia);
  await p2.waitForSelector('text=Media restored');
  await open('#/site/tours/day-trips/sunset-dhow-cruise', p2);
  await p2.waitForFunction(() => document.querySelector('.preview-hero img')?.naturalWidth > 0, null, { timeout: 5000 });
  expect(/Birding/.test(await p2.locator('.preview-page').innerText()), 'tag label not restored');
  await open('#/day-trips/defaults', p2);
  expect(await p2.locator('#moduleRoot .repeater-item').count() === 3, 'defaults not restored');
  const legacy = structuredClone(data);
  legacy.schemasVersion = 2;
  delete legacy.taxonomyPublication;
  delete legacy.dayTripDefaults;
  legacy.records = legacy.records.filter(r => r.kind !== 'dayTrip');
  legacy.published = legacy.published.filter(p => p.kind !== 'dayTrip');
  legacy.redirects = legacy.redirects.filter(r => r.kind !== 'dayTrip');
  legacy.taxonomies = legacy.taxonomies.map(({ key, order, active, ...t }) => t);
  const legacyFile = join(outDir, 'legacy-v2.json');
  writeFileSync(legacyFile, JSON.stringify(legacy));
  await open('#/backup', p2);
  await p2.setInputFiles('#import-data-file', legacyFile);
  await p2.waitForSelector('dialog[open]');
  const confirmText = await p2.locator('dialog[open]').innerText();
  expect(/made before Day Trips existed/.test(confirmText) && /Kept from this browser: 3 day trips/.test(confirmText), confirmText);
  await p2.locator('dialog[open]').getByRole('button', { name: 'Replace local content' }).click();
  await p2.waitForSelector('text=Import complete');
  expect(/Kept 3 day trips/.test(await p2.locator('#moduleRoot .notice-success').innerText()), await p2.locator('#moduleRoot .notice-success').innerText());
  await open('#/day-trips?status=all', p2);
  expect(/Sunset Dhow Cruise/.test(await p2.locator('#moduleRoot tbody').innerText()), 'day trips lost by the older import');
  await fresh.close();
});

await check('Mobile: Taxonomies, day-trip list and editor, and the local day-trip listing fit 390px', async () => {
  const mobile = await newContext({ width: 390, height: 844 });
  const m = watch(await mobile.newPage());
  await m.goto(`${base}/`);
  await m.click('#menuButton');
  await openNav(m, 'Tour Packages', 'Taxonomies');
  await m.waitForSelector('#taxonomy-search');
  expect(await m.locator('#sidebar.open').count() === 0, 'sidebar did not close');
  await m.fill('#term-new-type-label', 'Mobile type');
  await m.click('#taxonomy-panel-type button:has-text("Add tour type")');
  await m.waitForSelector('#taxonomy-panel-type td.cell-title strong:text-is("Mobile type")');
  expect(await noOverflow(m), 'taxonomy screen overflows');
  await m.screenshot({ path: join(outDir, 'mobile-taxonomies.png') });
  await m.click('#menuButton');
  await openNav(m, 'Tour Packages', 'Add Activity');
  await m.waitForSelector('#f-title');
  await m.fill('#f-title', 'Mobile day trip');
  await m.click('[data-action="save"]');
  await m.waitForSelector('.save-status[data-state="saved"]');
  for (const name of ['Basics', 'Inclusions & preparation', 'Pricing']) {
    await m.getByRole('tab', { name }).click();
    expect(await noOverflow(m), `${name} tab overflows`);
  }
  await m.screenshot({ path: join(outDir, 'mobile-daytrip-editor.png') });
  await open('#/day-trips', m);
  await m.waitForSelector('#moduleRoot .table-scroll');
  expect(!/\bnull\b|undefined/.test(await m.locator('#moduleRoot').innerText()), 'stray null/undefined text rendered');
  expect(await m.evaluate(() => getComputedStyle(document.querySelector('#moduleRoot .table-scroll')).overflowX) === 'auto' && await noOverflow(m), 'day-trip list overflows');
  await m.screenshot({ path: join(outDir, 'mobile-daytrip-list.png') });
  await open('#/site/tours/day-trips?filter=tag&value=nothing', m);
  expect(await noOverflow(m), 'listing overflows');
  await mobile.close();
});
await page.screenshot({ path: join(outDir, 'desktop-daytrips.png') });

// ---- 9. Mobile ----
await check('Narrow mobile: sidebar menu works, forms fit without page-level horizontal scroll, tables scroll', async () => {
  const mobile = await newContext({ width: 390, height: 844 });
  const m = watch(await mobile.newPage());
  await m.goto(`${base}/`);
  await m.click('#menuButton');
  expect(await m.locator('#sidebar.open').count() === 1, 'sidebar did not open');
  await openNav(m, 'Tour Packages', 'Add Tour');
  await m.waitForSelector('#f-title');
  expect(await m.locator('#sidebar.open').count() === 0, 'sidebar did not close');
  await m.fill('#f-title', 'Mobile tour');
  await m.click('[data-action="save"]');
  await m.waitForSelector('.save-status[data-state="saved"]');
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow <= 0, `page overflows by ${overflow}px`);
  await m.screenshot({ path: join(outDir, 'mobile-editor.png'), fullPage: false });
  await open('#/tours', m);
  await m.waitForSelector('#moduleRoot .table-scroll');
  const tableScroll = await m.evaluate(() => { const s = document.querySelector('#moduleRoot .table-scroll'); return getComputedStyle(s).overflowX; });
  expect(tableScroll === 'auto', `table overflow ${tableScroll}`);
  expect(await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, 'list page overflows');
  await m.screenshot({ path: join(outDir, 'mobile-list.png') });
  await mobile.close();
});
await check('Keyboard focus is visible on form controls', async () => {
  await open(`#/tours/new`);
  await page.waitForSelector('#f-title');
  await page.focus('[data-action="save"]');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  expect(outline !== 'none', `no outline on ${await page.evaluate(() => document.activeElement.outerHTML.slice(0, 60))}`);
  await page.focus('#f-title');
  await page.keyboard.press('Tab');
  const second = await page.evaluate(() => [document.activeElement.id, getComputedStyle(document.activeElement).outlineStyle]);
  expect(second[1] !== 'none', `no outline on ${second[0]}`);
});

await check('Dialogs never outlive their view (media picker closes on Back)', async () => {
  await open(`#/destinations/${destId}`);
  await tab('Media');
  await page.locator('#f-gallery').click();
  await page.waitForSelector('dialog[open]');
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('dialog[open]'), null, { timeout: 5000 });
});
await check('Keyboard focus is visible on the hidden-input upload buttons', async () => {
  await open('#/media');
  await page.keyboard.press('Tab'); // keyboard modality, so programmatic focus counts as :focus-visible
  await page.focus('#library-upload');
  const outline = await page.evaluate(() => getComputedStyle(document.querySelector('label[for="library-upload"]')).outlineStyle);
  expect(outline === 'solid', `upload label outline: ${outline}`);
});

await check('A stale cached module shows the real error and “Refresh CMS files and reload” recovers', async () => {
  // Simulates a browser that reused an old cached copy of one module after an update: the first response for
  // content-repository.js lacks an export that newer modules import. Not watched: the page error is expected.
  const ctx = await newContext();
  const p = await ctx.newPage();
  const current = await (await fetch(`${base}/src/storage/content-repository.js`)).text();
  let served = 0;
  await p.route(url => url.pathname === '/src/storage/content-repository.js', route => (served++ === 0
    ? route.fulfill({ status: 200, contentType: 'text/javascript', body: current.replace('export const CONTEXT_STORES', 'const CONTEXT_STORES') })
    : route.continue()));
  await p.goto(`${base}/#/settings`);
  await p.waitForSelector('.boot-error', { timeout: 5000 });
  const note = await p.locator('.boot-error').innerText();
  expect(/does not provide an export named 'CONTEXT_STORES'/.test(note) && /cached copies/.test(note), note);
  await Promise.all([p.waitForEvent('load'), p.click('.boot-error button')]);
  await p.waitForSelector('#f-company-name', { timeout: 10000 });
  expect(await p.locator('.boot-error').count() === 0, 'boot error still shown after refresh');
  await ctx.close();
});

await page.screenshot({ path: join(outDir, 'desktop-final.png') });
await check('No production/external network requests and no uncaught page errors', async () => {
  expect(!external.length, `external: ${external.join(', ')}`);
  const real = pageErrors.filter(e => !/^native dialog/.test(e));
  expect(!real.length, real.join(' | '));
});

await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed. Artifacts: ${outDir}`);
process.exit(failed ? 1 : 0);
