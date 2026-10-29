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
    await page.waitForSelector('#moduleRoot h1');
    expect(await page.evaluate(() => location.hash) === hash, `${item} → ${await page.evaluate(() => location.hash)}`);
    expect((await page.locator('#moduleRoot h1').first().textContent()).trim() === heading, `${item} heading`);
  }
});
await check('Other modules remain honest placeholders; Add Tour quick action opens the tour editor', async () => {
  await open(`#/dashboard`);
  await openNav(page, 'Bookings', 'All Bookings');
  await page.locator('#modulePreview').waitFor({ state: 'visible', timeout: 3000 });
  expect(/NOT BUILT IN THIS PROTOTYPE/.test(await text('#modulePreview')), 'placeholder wording');
  await openNav(page, 'Tour Packages', 'Activities / day trips');
  await page.locator('#modulePreview h2', { hasText: 'Activities / day trips' }).waitFor({ timeout: 3000 });
  expect(/out of scope/.test(await text('#modulePreview')), 'day-trip placeholder note');
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
  await page.waitForSelector('.issue-summary.has-errors');
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
  expect(data.format === 'vion-cms-local-backup' && data.schemasVersion === 1 && data.binaryAssetsIncluded === false && /does NOT contain image files/.test(data.notice), 'data backup header');
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
