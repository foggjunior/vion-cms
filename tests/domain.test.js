import { assert, assertEqual, assertIssue, assertNoErrors, hasIssue, test } from './harness.js';
import { asset, completeAccommodation, completeDestination, completeTour, context, envelope, schema, validator } from './fixtures.js';
import { createSchemaValidator } from '../src/modules/shared/schema-validator.js';
import { applyRedirectPlan, findRouteConflict, planRedirects, redirectProblems, slugify, uniqueSlug } from '../src/modules/shared/routes.js';
import { comparePricing, compareDecimalStrings, describePrice, amountMessage, isSupportedCurrency } from '../src/modules/shared/pricing.js';
import { convertLegacyTips, duplicateRecord, formToRecord, newRecord, recordToForm, relationRefs } from '../src/modules/shared/records.js';
import { validateDraft, validatePublish, webUrlMessage } from '../src/modules/shared/validation.js';

const published = (record, route) => ({ id: record.id, kind: record.kind, revision: 1, publishedAt: record.updatedAt, sourceVersion: record.version, route, snapshot: { ...record, status: 'published' } });

test('schema: new records of every kind are valid draft shapes', () => {
  for (const kind of ['destination', 'accommodation', 'tour']) assertEqual(validator.validateRecord(newRecord(kind, { title: 'X' })), [], kind);
});

test('schema: rejects unknown fields, bad slugs, zero duration and float-like amounts', () => {
  const tour = newRecord('tour', { title: 'T' });
  const errors = validator.validateRecord({ ...tour, slug: 'Bad Slug', durationDays: 0, price: 5, pricing: { mode: 'manualFrom', amount: '01.5' } });
  for (const path of ['slug', 'durationDays', 'price', 'pricing.amount']) assert(errors.some(e => e.path === path), `expected schema error at ${path}: ${JSON.stringify(errors)}`);
});

test('schema: cover may be null but a cover object needs assetId and alt', () => {
  const d = newRecord('destination', { title: 'D' });
  assertEqual(validator.validateRecord({ ...d, cover: null }), []);
  const errors = validator.validateRecord({ ...d, cover: { assetId: 'a' } });
  assert(errors.some(e => e.path === 'cover.alt'), JSON.stringify(errors));
});

test('schema: unsupported keywords are refused at start-up', () => {
  let threw = false;
  try { createSchemaValidator({ ...schema, $defs: { x: { type: 'string', maxLength: 3 } } }); } catch { threw = true; }
  assert(threw, 'validator should refuse maxLength (not used by the documented schema)');
});

test('slugify: lowercase, diacritics, ampersands and hyphen collapsing', () => {
  assertEqual(slugify('Serengeti National Park'), 'serengeti-national-park');
  assertEqual(slugify('  Ngorongoro & Côte d’Ivoire!! '), 'ngorongoro-and-cote-divoire');
  assertEqual(slugify('---'), '');
  assert(slugify('a'.repeat(200)).length <= 96);
});

test('routes: reserved hub paths are rejected only for tours', () => {
  const ctx = context();
  assert(findRouteConflict('tour', 'day-trips', 'x', ctx)?.reason === 'reserved');
  assert(findRouteConflict('tour', 'zanzibar-trips', 'x', ctx)?.reason === 'reserved');
  assert(findRouteConflict('tour', 'climbing-trips', 'x', ctx)?.reason === 'reserved');
  assertEqual(findRouteConflict('destination', 'day-trips', 'x', ctx), null);
});

test('routes: uniqueness spans archived records and previous published routes', () => {
  const archived = { ...newRecord('destination', { title: 'Old' }), slug: 'tarangire', status: 'archived' };
  const moved = { ...newRecord('destination', { title: 'Moved' }), slug: 'lake-manyara-new' };
  const ctx = context({ records: [envelope(archived), envelope(moved, { routeHistory: [{ route: '/destinations/lake-manyara', firstPublishedAt: new Date().toISOString() }] })] });
  assert(/archived/.test(findRouteConflict('destination', 'tarangire', 'other', ctx).message));
  assertEqual(findRouteConflict('destination', 'lake-manyara', 'other', ctx).reason, 'previously published route');
  assertEqual(findRouteConflict('destination', 'lake-manyara', moved.id, ctx), null, 'a record may reclaim its own old route');
  assertEqual(uniqueSlug('Tarangire', 'destination', 'new', ctx), 'tarangire-2');
});

test('redirects: planning avoids chains and loops when slugs change repeatedly', () => {
  let redirects = [];
  const step = (prevRoute, nextRoute) => {
    redirects = applyRedirectPlan(redirects, planRedirects({ recordId: 'r1', kind: 'tour', prevRoute, nextRoute, redirects, now: 'now', newId: () => crypto.randomUUID() }));
  };
  step('/tours/a', '/tours/b');
  assertEqual(redirects.map(r => `${r.from}>${r.to}`), ['/tours/a>/tours/b']);
  step('/tours/b', '/tours/c');
  assertEqual(redirects.map(r => `${r.from}>${r.to}`).sort(), ['/tours/a>/tours/c', '/tours/b>/tours/c']);
  step('/tours/c', '/tours/a');
  assertEqual(redirects.map(r => `${r.from}>${r.to}`).sort(), ['/tours/b>/tours/a', '/tours/c>/tours/a']);
  assertEqual(redirectProblems(redirects), []);
  assert(redirectProblems([{ from: '/tours/x', to: '/tours/y' }, { from: '/tours/y', to: '/tours/x' }]).some(p => /loop/.test(p)));
});

test('pricing: request, per person/group/vehicle and zero render distinctly', () => {
  assertEqual(describePrice({ mode: 'request' }).text, 'Price on request');
  const pp = describePrice({ mode: 'manualFrom', amount: '1250', currency: 'USD', basis: 'perPerson', applicability: 'x' });
  assert(/^From USD\s1,250 per person$/.test(pp.text), pp.text);
  const pg = describePrice({ mode: 'manualFrom', amount: '1250.5', currency: 'USD', basis: 'perGroup' });
  assert(/1,250\.50 per group$/.test(pg.text) && !/person/.test(pg.text), pg.text);
  const pv = describePrice({ mode: 'manualFrom', amount: '0', currency: 'EUR', basis: 'perVehicle' });
  assertEqual(pv.kind, 'from', 'zero is a real amount');
  assert(/EUR\s0 per vehicle$/.test(pv.text), pv.text);
  assertEqual(describePrice({ mode: 'manualFrom', currency: 'EUR', basis: 'perVehicle' }).kind, 'incomplete', 'missing amount is not zero');
});

test('pricing: amounts are validated as decimal strings against currency precision', () => {
  assert(amountMessage('1,250', 'USD'), 'commas rejected');
  assert(amountMessage('12.345', 'USD'), 'three decimals rejected for USD');
  assert(amountMessage('100.5', 'JPY'), 'JPY has no decimals');
  assertEqual(amountMessage('0', 'USD'), null);
  assertEqual(amountMessage('999999999999.99', 'USD'), null);
  assert(amountMessage('1234567890123', 'USD'), 'more than 12 integer digits rejected');
  assert(isSupportedCurrency('TZS') && !isSupportedCurrency('XYZ') && !isSupportedCurrency('usd'));
});

test('pricing: decimal comparison is exact and missing prices sort last', () => {
  assertEqual(compareDecimalStrings('100.5', '100.50'), 0);
  assert(compareDecimalStrings('99', '100') < 0 && compareDecimalStrings('0.05', '0.1') < 0);
  const list = [{ mode: 'request' }, { mode: 'manualFrom', amount: '900', currency: 'USD', basis: 'perPerson' }, { mode: 'manualFrom', currency: 'USD' }, { mode: 'manualFrom', amount: '0', currency: 'USD', basis: 'perGroup' }];
  const sorted = [...list].sort(comparePricing);
  assertEqual(sorted.slice(0, 2).map(p => p.amount), ['0', '900']);
  assert(sorted.slice(2).every(p => p.amount === undefined));
});

test('form conversion: request mode stores no amount; numbers keep zero and reject junk', () => {
  const tour = recordToForm(newRecord('tour', { title: 'T' }));
  tour.pricing = { mode: 'request', amount: '500', currency: 'usd' };
  tour.durationDays = 'abc';
  tour.recommendedRank = '0';
  const { record, issues } = formToRecord(tour);
  assertEqual(record.pricing, { mode: 'request' });
  assertEqual(record.recommendedRank, 0);
  assertIssue(issues, 'durationDays', /whole number/);
  const manual = formToRecord({ ...recordToForm(newRecord('tour', { title: 'T' })), pricing: { mode: 'manualFrom', amount: ' 10 ', currency: 'usd', basis: 'perGroup' } }).record;
  assertEqual(manual.pricing, { mode: 'manualFrom', currency: 'USD', amount: '10', basis: 'perGroup' });
});

test('form conversion: lists trim and drop exact duplicates but keep case variants; itinerary renumbers', () => {
  const form = recordToForm(newRecord('tour', { title: 'T' }));
  form.inclusions = [' Park fees ', 'Park fees', 'park fees', ''];
  form.itinerary = [{ id: 'a', dayNumber: 5, title: 'x', description: '' }, { id: 'b', dayNumber: 9, title: 'y', description: '' }];
  const { record } = formToRecord(form);
  assertEqual(record.inclusions, ['Park fees', 'park fees']);
  assertEqual(record.itinerary.map(d => d.dayNumber), [1, 2]);
  assert(hasIssue(validateDraft(record, context()), 'inclusions', /capitalisation/, 'warning'));
});

test('draft validation: title only is enough; supplied invalid values are rejected', () => {
  assertNoErrors(validateDraft(newRecord('accommodation', { title: 'Just a title' }), context()));
  assertIssue(validateDraft(newRecord('tour', { title: '  ' }), context()), 'title', /title/);
  const acc = newRecord('accommodation', { title: 'A' });
  assertIssue(validateDraft({ ...acc, website: 'javascript:alert(1)' }, context()), 'website', /rejected for safety/);
  assertIssue(validateDraft({ ...acc, website: 'data:text/html,hi' }, context()), 'website', /rejected/);
  assertIssue(validateDraft({ ...acc, publicPhone: 'call me' }, context()), 'publicPhone', /phone/);
  assertEqual(webUrlMessage('https://www.example.com/lodge'), null);
  assertIssue(validateDraft({ ...acc, destinationId: crypto.randomUUID() }, context()), 'destinationId', /no longer exists/);
});

test('publish validation: destination minimums are reported per field', () => {
  const issues = validatePublish(newRecord('destination', { title: 'Empty' }), context());
  for (const path of ['slug', 'overview', 'bestTime', 'cover']) assertIssue(issues, path);
  const a = asset();
  const ok = validatePublish(completeDestination(a), context({ assets: [a] }));
  assertNoErrors(ok);
  assert(hasIssue(ok, 'gallery', /Three or more/, 'warning'), 'fewer than three images is only a warning');
  assertIssue(validatePublish(completeDestination(a, { cover: { assetId: a.id, alt: '' } }), context({ assets: [a] })), 'cover.alt', /alt/);
  assertIssue(validatePublish(completeDestination(a), context({ assets: [a], blobs: false })), 'cover', /not stored/);
});

test('publish validation: accommodation needs a published destination or a reason', () => {
  const a = asset();
  const dest = completeDestination(a);
  const acc = completeAccommodation(a, dest.id);
  assertIssue(validatePublish(acc, context({ assets: [a], records: [envelope(dest)] })), 'destinationId', /not published/);
  assertNoErrors(validatePublish(acc, context({ assets: [a], records: [envelope(dest)], published: [published(dest, '/destinations/x')] })));
  const none = completeAccommodation(a, null);
  assertIssue(validatePublish(none, context({ assets: [a] })), 'destinationId', /explain/);
  assertNoErrors(validatePublish({ ...none, noDestinationReason: 'Mobile camp that moves with the migration.' }, context({ assets: [a] })));
  assertIssue(validatePublish({ ...none, noDestinationReason: 'x', publicPhoneVisible: true }, context({ assets: [a] })), 'publicPhone', /public phone/);
});

test('publish validation: tour itinerary, destinations and manual pricing', () => {
  const a = asset();
  const dest = completeDestination(a);
  const ctx = context({ assets: [a], records: [envelope(dest)], published: [published(dest, '/destinations/x')] });
  const tour = completeTour(a, [dest.id]);
  assertNoErrors(validatePublish(tour, ctx));
  assertIssue(validatePublish({ ...tour, durationDays: 3 }, ctx), 'itinerary', /2 days but the duration is 3/);
  assertIssue(validatePublish({ ...tour, destinationIds: [] }, ctx), 'destinationIds', /at least one/);
  assertIssue(validatePublish(tour, context({ assets: [a], records: [envelope(dest)] })), 'destinationIds', /not published/);
  const untitledDay = { ...tour, itinerary: [tour.itinerary[0], { ...tour.itinerary[1], title: '' }] };
  assertIssue(validatePublish(untitledDay, ctx), 'itinerary.1.title', /Day 2 needs a title/);
  const manual = validatePublish({ ...tour, pricing: { mode: 'manualFrom', amount: '1200', currency: 'USD', basis: 'perPerson' } }, ctx);
  assertIssue(manual, 'pricing.applicability', /what the “from” price applies to/);
  assertIssue(manual, 'pricing.mode', /provisional/, 'warning');
  assertIssue(validatePublish({ ...tour, inclusions: [], exclusions: [] }, ctx), 'exclusions', /exclusion/);
});

test('records: references, duplicates and legacy tip conversion', () => {
  const tour = completeTour(asset(), ['d1']);
  tour.itinerary[0].accommodationIds = ['acc1'];
  assertEqual(relationRefs(tour).map(r => `${r.path}:${r.id}`), ['destinationIds:d1', 'itinerary.0.accommodationIds:acc1']);
  const copy = duplicateRecord(tour, { now: new Date().toISOString(), slug: 'copy', title: 'Copy' });
  assert(copy.id !== tour.id && copy.status === 'draft' && copy.itinerary[0].id !== tour.itinerary[0].id);
  const legacy = 'Visas\nMost visitors need a visa.\n\nCarry cash for tips.';
  const tips = convertLegacyTips(legacy);
  assertEqual(tips.map(t => [t.title, t.body]), [['Visas', 'Most visitors need a visa.'], ['', 'Carry cash for tips.']]);
});
