// Phase 3: tour taxonomies (namespaces, keys, order, activation, publication) and day trips (validation,
// snapshots, dependencies, media, pricing, defaults, routes, upgrade, backup, tag filter) plus the team
// visibility follow-up. Runs against real IndexedDB in temporary databases.
import { assert, assertEqual, assertIssue, assertNoErrors, assertRejects, hasIssue, test } from './harness.js';
import { completeAccommodation, completeDayTrip, completeDestination, completeMember, completeTour, context, cover, envelope, imageFile, schema, siteSchema, storedAsset, term, validator, withWorkspace } from './fixtures.js';
import { formToRecord, hasUnpublishedChanges, newRecord, recordToForm } from '../src/modules/shared/records.js';
import { validateDraft, validatePublish } from '../src/modules/shared/validation.js';
import { comparePricing, describePrice } from '../src/modules/shared/pricing.js';
import { HUB_ROUTES, RESERVED_ROUTES, routeFor } from '../src/modules/shared/routes.js';
import { copyDefaults, filterDayTrips, newScheduleItem } from '../src/modules/shared/day-trips.js';
import { labelIdentity, newTaxonomyPublication, normalizeTermLabel, taxonomyChanges, termIssues, upgradeLegacyTerms } from '../src/modules/shared/taxonomy.js';
import { newLineup, newSettings } from '../src/modules/shared/site.js';
import { createResolver, renderCard, renderRecordPage } from '../src/modules/preview.js';
import { MediaUrlScope } from '../src/components/media.js';
import { parseRoute } from '../src/modules/registry.js';
import { teamModule } from '../src/modules/team.js';
import { DB_VERSION } from '../src/storage/idb.js';
import { deleteWorkspace, openWorkspace } from '../src/storage/workspace.js';

// A published destination and a published tag, the minimum a day trip needs to be published with a tag.
async function publishedBasics(ws) {
  const img = await storedAsset(ws);
  const dest = await ws.content.publish((await ws.content.saveDraft(completeDestination(img))).id, { expectedVersion: 1 });
  const tag = await ws.taxonomies.create('tag', 'Birding');
  await ws.taxonomies.publish();
  return { img, dest, tag };
}

// ---- taxonomy rules ----
test('taxonomy rules: documented normalisation, uniqueness within a namespace only, legacy terms upgraded in place', () => {
  assertEqual(normalizeTermLabel('  Big \n  Five '), 'Big Five');
  assertEqual(labelIdentity('Café Tours'), labelIdentity('CAFÉ  tours'), 'NFC, case and whitespace are normalised');
  const wildlife = term('tag', 'Wildlife');
  const others = [wildlife, term('type', 'Private', { key: 'private' })];
  assertIssue(termIssues(term('tag', '   '), others), 'label', /Blank labels/);
  for (const key of ['Bad Key', 'a--b', '-a', 'ü']) assertIssue(termIssues(term('tag', 'Fine', { key }), others), 'key', /lowercase letters/);
  assertIssue(termIssues(term('tag', ' wildLIFE ', { key: 'other' }), others), 'label', /already exists as a tour tag/);
  assertIssue(termIssues(term('tag', 'Other', { key: 'wildlife' }), others), 'key', /already used by the tour tag “Wildlife”/);
  assertEqual(termIssues(term('type', 'Wildlife'), others), [], 'the same label and key are allowed in another namespace');
  assertEqual(termIssues(term('category', 'Private', { key: 'private' }), others), []);

  const legacy = [
    { id: crypto.randomUUID(), namespace: 'tag', label: 'Zebra crossing', createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-02T10:00:00.000Z', version: 3 },
    { id: crypto.randomUUID(), namespace: 'tag', label: 'Big Five', createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', version: 1 },
    { id: crypto.randomUUID(), namespace: 'tag', label: 'Big Five!', createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', version: 1 },
    { id: crypto.randomUUID(), namespace: 'type', label: 'Private safari', createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', version: 2 }
  ];
  const upgraded = upgradeLegacyTerms(legacy);
  for (const [i, t] of upgraded.entries()) {
    for (const key of ['id', 'namespace', 'label', 'createdAt', 'updatedAt', 'version']) assertEqual(t[key], legacy[i][key], `${key} unchanged`);
    assertEqual(t.active, true);
    assertEqual(validator.validate(t, '#/$defs/taxonomyTerm'), [], 'upgraded term matches the schema');
  }
  const tags = upgraded.filter(t => t.namespace === 'tag').sort((a, b) => a.order - b.order);
  assertEqual(tags.map(t => t.label), ['Big Five', 'Big Five!', 'Zebra crossing'], 'order follows the old alphabetical display');
  assertEqual(tags.map(t => t.key).sort(), ['big-five', 'big-five-2', 'zebra-crossing'], 'keys derived and made unique');
  assertEqual(upgraded.find(t => t.namespace === 'type').key, 'private-safari');
  assertEqual(legacy[0].key, undefined, 'input not mutated');
});

test('taxonomy repository: create/edit with stable IDs, key lock after publication, malformed input rejected, no deletion', () => withWorkspace(async ws => {
  const term1 = await ws.taxonomies.create('type', { label: '  Private   safari ', key: '' });
  assertEqual([term1.label, term1.key, term1.order, term1.active, term1.version], ['Private safari', 'private-safari', 1, true, 1]);
  const blank = await assertRejects(ws.taxonomies.create('type', { label: '   ' }), { code: 'validation' });
  assert(blank.issues.some(i => i.path === 'label'));
  const badKey = await assertRejects(ws.taxonomies.create('type', { label: 'Group', key: 'Group Tours' }), { code: 'validation' });
  assert(badKey.issues.some(i => i.path === 'key' && /group-tours/.test(i.message)), 'suggests a valid key');
  await assertRejects(ws.taxonomies.create('type', { label: 'PRIVATE SAFARI' }), { code: 'conflict' });
  await assertRejects(ws.taxonomies.create('type', { label: 'Something else', key: 'private-safari' }), { code: 'conflict', match: /key “private-safari”/ });
  await assertRejects(ws.taxonomies.create('colour', 'Red'), { code: 'validation' });
  const sameInCategory = await ws.taxonomies.create('category', 'Private safari');
  assertEqual(sameInCategory.key, 'private-safari', 'namespaces are separate');

  let edited = await ws.taxonomies.update(term1.id, { key: 'private' }, { expectedVersion: 1 });
  assertEqual([edited.id, edited.key, edited.version], [term1.id, 'private', 2], 'key editable before publication');
  await ws.taxonomies.publish();
  await assertRejects(ws.taxonomies.update(term1.id, { key: 'private-tours' }, { expectedVersion: 2 }), { code: 'invalid-state', match: /locked/ });
  edited = await ws.taxonomies.update(term1.id, { label: 'Private tour' }, { expectedVersion: 2 });
  assertEqual([edited.id, edited.label, edited.key], [term1.id, 'Private tour', 'private'], 'renaming keeps the ID and key');
  await assertRejects(ws.taxonomies.rename(term1.id, 'Stale rename', { expectedVersion: 2 }), { code: 'stale' });
  assertEqual(typeof ws.taxonomies.remove, 'undefined', 'terms cannot be permanently deleted in this phase');
  assertEqual((await ws.taxonomies.list()).length, 2);
}));

test('taxonomy repository: keyboard ordering per namespace with stale protection; publishing terms never publishes content', () => withWorkspace(async ws => {
  const img = await storedAsset(ws);
  const dest = await ws.content.publish((await ws.content.saveDraft(completeDestination(img))).id, { expectedVersion: 1 });
  const draftTour = await ws.content.saveDraft(newRecord('tour', { title: 'Draft tour' }));
  const [a, b, c] = [await ws.taxonomies.create('tag', 'A'), await ws.taxonomies.create('tag', 'B'), await ws.taxonomies.create('tag', 'C')];
  const type = await ws.taxonomies.create('type', 'T');
  const moved = await ws.taxonomies.move(c.id, -1, { expectedOrder: [a.id, b.id, c.id] });
  assertEqual([moved.position, moved.count], [2, 3]);
  const ordered = async ns => (await ws.taxonomies.list()).filter(t => t.namespace === ns).map(t => [t.label, t.order]);
  assertEqual(await ordered('tag'), [['A', 1], ['C', 2], ['B', 3]]);
  assertEqual(await ordered('type'), [['T', 1]], 'other namespaces are untouched');
  await assertRejects(ws.taxonomies.move(b.id, -1, { expectedOrder: [a.id, b.id, c.id] }), { code: 'stale' });
  await assertRejects(ws.taxonomies.move(a.id, -1), { code: 'invalid-state' });

  assertEqual(taxonomyChanges(await ws.taxonomies.list(), null).length, 4);
  const terms = await ws.taxonomies.list();
  await assertRejects(ws.taxonomies.publish({ expectedFingerprint: 'stale' }), { code: 'stale' });
  const pub = await ws.taxonomies.publish({ expectedFingerprint: terms.map(t => `${t.id}:${t.version}`).sort().join(',') });
  assertEqual([pub.revision, pub.origin, pub.terms.length], [1, 'publish', 4]);
  await assertRejects(ws.taxonomies.publish(), { code: 'invalid-state', match: /no unpublished/ });
  await ws.taxonomies.rename(type.id, 'Renamed', { expectedVersion: type.version });
  assertEqual((await ws.taxonomies.changes()).map(ch => ch.kind), ['label']);
  const ctx = await ws.loadContext();
  assertEqual([ctx.records.get(draftTour.id).record.status, ctx.published.has(draftTour.id)], ['draft', false], 'content drafts are not published');
  assertEqual([ctx.published.get(dest.id).revision, ctx.records.get(dest.id).record.version], [1, dest.record.version], 'published content untouched');
  assertEqual(ctx.publishedTerms.get(type.id).label, 'T', 'the local site keeps the published label until the taxonomy is republished');
}));

// ---- term references ----
test('inactive terms: kept on existing records with a warning, unavailable for new selections, still displayed', () => withWorkspace(async ws => {
  const { img, dest, tag } = await publishedBasics(ws);
  const tripImg = await storedAsset(ws);
  const trip = await ws.content.saveDraft(completeDayTrip(tripImg, [dest.id], { tagIds: [tag.id] }));
  await ws.taxonomies.setActive(tag.id, false, { expectedVersion: tag.version });
  await ws.taxonomies.publish();
  const edited = await ws.content.saveDraft({ ...trip.record, title: 'Sunset Dhow Cruise (edited)' }, { expectedVersion: 1 });
  assertEqual(edited.record.tagIds, [tag.id], 'unrelated edits keep the inactive selection');
  let ctx = await ws.loadContext();
  assertIssue(validateDraft(edited.record, ctx), 'tagIds', /inactive\. It stays on this record/, 'warning');
  const fresh = await assertRejects(ws.content.saveDraft(completeDayTrip(img, [dest.id], { slug: 'another-trip', tagIds: [tag.id] })), { code: 'validation' });
  assert(fresh.issues.some(i => i.path === 'tagIds' && /cannot be newly selected/.test(i.message)), JSON.stringify(fresh.issues));
  const tour = await ws.content.saveDraft(newRecord('tour', { title: 'Tour' }));
  await assertRejects(ws.content.saveDraft({ ...tour.record, tagIds: [tag.id] }, { expectedVersion: 1 }), { code: 'validation' });

  await ws.content.publish(trip.id, { expectedVersion: edited.record.version });
  ctx = await ws.loadContext();
  const scope = new MediaUrlScope(ws.media);
  const published = renderRecordPage(ctx.published.get(trip.id).snapshot, { resolver: createResolver(ctx, 'published'), scope });
  assert(published.textContent.includes('Birding') && !/inactive|Unresolved/.test(published.textContent), 'published page shows the label without management details');
  const draft = renderRecordPage(edited.record, { resolver: createResolver(ctx, 'draft'), scope });
  assert(draft.textContent.includes('Birding (inactive)'), 'draft preview flags it');
  scope.revokeAll();
  const copy = await ws.content.duplicate(trip.id);
  assertEqual(copy.record.tagIds, [tag.id], 'a duplicate keeps the existing selection');
}));

test('term references: cross-namespace values rejected; unresolved stored values kept with a warning and blocking publication', () => {
  const type = term('type', 'Private');
  const tag = term('tag', 'Wildlife');
  const ctx = context({ taxonomies: [type, tag] });
  assertIssue(validateDraft({ ...newRecord('tour', { title: 'T' }), typeId: tag.id }, ctx), 'typeId', /is a tour tag, not a tour type/);
  assertIssue(validateDraft({ ...newRecord('tour', { title: 'T' }), tagIds: [type.id] }, ctx), 'tagIds', /is a tour type, not a tour tag/);
  assertIssue(validateDraft({ ...newRecord('dayTrip', { title: 'D' }), tagIds: [type.id] }, ctx), 'tagIds', /not a tour tag/);

  const legacyId = crypto.randomUUID();
  const stored = { ...newRecord('tour', { title: 'Legacy' }), categoryId: legacyId };
  const withStored = context({ records: [envelope(stored)], taxonomies: [type, tag] });
  assertIssue(validateDraft(stored, withStored), 'categoryId', /Unresolved tour category value .*kept as saved/, 'warning');
  assert(!hasIssue(validateDraft(stored, withStored), 'categoryId'), 'not an error for the saved record');
  assertIssue(validatePublish(stored, withStored), 'categoryId', /before publishing/);
  assertIssue(validateDraft({ ...newRecord('tour', { title: 'New' }), categoryId: legacyId }, withStored), 'categoryId', /Choose a managed tour category/);

  const published = context({ taxonomies: [type, tag], taxonomyPublication: newTaxonomyPublication([type], { now: new Date().toISOString() }) });
  assertIssue(validatePublish({ ...newRecord('dayTrip', { title: 'X' }), tagIds: [tag.id] }, published), 'tagIds', /not in the published taxonomy/);
  assert(!hasIssue(validatePublish({ ...newRecord('tour', { title: 'X' }), typeId: type.id }, published), 'typeId'), 'published term accepted');
});

// ---- day trips ----
test('day trips: title-only drafts; optional duration and schedule validated; publication minimum reported per field', () => {
  const empty = newRecord('dayTrip', { title: 'Sunset cruise' });
  assertEqual(validator.validateRecord(empty), []);
  const extra = validator.validateRecord({ ...empty, accommodationIds: [], typeId: null, categoryId: null, standardId: null, durationDays: 1, itinerary: [] });
  for (const path of ['accommodationIds', 'typeId', 'categoryId', 'standardId', 'durationDays', 'itinerary']) assert(extra.some(e => e.path === path), `day trips must not accept ${path}`);
  assertNoErrors(validateDraft(empty, context()));

  const convert = (value, unit = 'hours') => formToRecord({ ...recordToForm(empty), duration: { value, unit } });
  assertEqual(convert('').record.duration, null, 'blank means no duration');
  assertEqual(convert('1.5').record.duration, { value: 1.5, unit: 'hours' });
  for (const junk of ['abc', '1.255', '-2', '1,5']) assert(convert(junk).issues.some(i => i.path === 'duration.value'), junk);
  const check = (value, unit) => validateDraft(convert(value, unit).record, context());
  assertIssue(check('0', 'hours'), 'duration.value', /more than zero/);
  assertIssue(check('25', 'hours'), 'duration.value', /more than 24 hours/);
  assertIssue(check('8', 'days'), 'duration.value', /more than 7 days/);
  assertNoErrors(check('7', 'days'));
  assertNoErrors(check('0.5', 'hours'));
  assertIssue(validateDraft({ ...empty, duration: { value: 2, unit: 'weeks' } }, context()), 'duration.unit');

  const scheduled = { ...empty, duration: { value: 2, unit: 'hours' }, schedule: [1, 2, 3].map(n => ({ ...newScheduleItem(), heading: `Part ${n}` })) };
  assertNoErrors(validateDraft(scheduled, context()), 'three schedule items with a two-hour duration');

  const issues = validatePublish({ ...empty, schedule: [newScheduleItem()] }, context());
  for (const path of ['slug', 'overview', 'destinationIds', 'cover', 'inclusions', 'schedule.0.heading']) assertIssue(issues, path);
  for (const path of ['exclusions', 'whatToBring', 'summary', 'duration.value']) assert(!hasIssue(issues, path), `${path} stays optional`);
  assertIssue(issues, 'summary', /No summary/, 'warning');
  assertIssue(issues, 'duration.value', /No duration/, 'warning');
  const priced = validatePublish({ ...empty, pricing: { mode: 'manualFrom', amount: '10' } }, context());
  for (const path of ['pricing.currency', 'pricing.basis', 'pricing.applicability']) assertIssue(priced, path);
  assertIssue(validatePublish({ ...empty, pricing: {} }, context()), 'pricing.mode', /Choose a pricing mode/);
});

test('day trips: isolated publication snapshots, destination dependency safeguards and media protection', () => withWorkspace(async ws => {
  const { dest, tag } = await publishedBasics(ws);
  const tripImg = await storedAsset(ws);
  const otherImg = await storedAsset(ws);
  let trip = await ws.content.saveDraft(completeDayTrip(tripImg, [dest.id], { tagIds: [tag.id] }));
  trip = await ws.content.publish(trip.id, { expectedVersion: 1 });
  assertEqual((await ws.content.getPublished(trip.id)).route, '/tours/day-trips/sunset-dhow-cruise');
  trip = await ws.content.saveDraft({ ...trip.record, overview: 'Changed in the draft.', cover: cover(otherImg, 'Harbour view') }, { expectedVersion: trip.record.version });
  assertEqual((await ws.content.getPublished(trip.id)).snapshot.overview, 'An evening on the water.', 'saving a draft never republishes');
  assert(hasUnpublishedChanges(trip));

  const blocked = await assertRejects(ws.content.unpublish(dest.id, { expectedVersion: dest.record.version }), { code: 'dependency' });
  assert(/Day trip “Sunset Dhow Cruise”/.test(blocked.message), blocked.message);
  await assertRejects(ws.content.archive(dest.id, { expectedVersion: dest.record.version }), { code: 'dependency' });
  await assertRejects(ws.media.remove(tripImg.id), { code: 'dependency', match: /published snapshot/ });
  await assertRejects(ws.media.remove(otherImg.id), { code: 'dependency', match: /working draft/ });
  assert((await ws.media.usage(tripImg.id)).every(u => u.href === `#/day-trips/${trip.id}`), 'usage links open the day-trip editor');

  const unpublished = await ws.content.unpublish(trip.id, { expectedVersion: trip.record.version });
  assertEqual(await ws.content.getPublished(trip.id), null);
  await ws.content.unpublish(dest.id, { expectedVersion: dest.record.version });
  await ws.media.remove(tripImg.id);
  const archived = await ws.content.archive(trip.id, { expectedVersion: unpublished.record.version });
  const restored = await ws.content.restore(trip.id, { expectedVersion: archived.record.version });
  assertEqual([restored.record.status, restored.record.overview, await ws.content.getPublished(trip.id)], ['draft', 'Changed in the draft.', null]);
}));

test('pricing: day trips reuse decimal-safe pricing; only the per-person basis says “per person”; missing differs from zero', () => {
  const p = (basis, amount = '0') => ({ mode: 'manualFrom', currency: 'USD', amount, basis, applicability: 'Shared boat' });
  const text = pricing => describePrice(pricing).text.replace(/\s/g, ' '); // Intl uses a no-break space after the code
  assertEqual(text(p('perGroup')), 'From USD 0 per group');
  assertEqual(text(p('perVehicle', '45.50')), 'From USD 45.50 per vehicle');
  assertEqual(text(p('perPerson', '1250')), 'From USD 1,250 per person');
  assertEqual(describePrice({ mode: 'manualFrom', currency: 'USD', basis: 'perGroup' }).kind, 'incomplete', 'missing amount is not zero');
  const form = recordToForm(newRecord('dayTrip', { title: 'X' }));
  form.pricing = { mode: 'request', amount: '12' };
  assertEqual(formToRecord(form).record.pricing, { mode: 'request' }, 'price on request stores no amount');
  form.pricing = { mode: 'manualFrom', currency: 'usd', amount: '0', basis: 'perGroup', applicability: ' Up to 6 guests ' };
  assertEqual(formToRecord(form).record.pricing, { mode: 'manualFrom', currency: 'USD', amount: '0', basis: 'perGroup', applicability: 'Up to 6 guests' });
  assertIssue(validateDraft({ ...newRecord('dayTrip', { title: 'X' }), pricing: { mode: 'manualFrom', amount: '1,200' } }, context()), 'pricing.amount', /commas/);
  assertIssue(validateDraft({ ...newRecord('dayTrip', { title: 'X' }), pricing: { mode: 'manualFrom', currency: 'JPY', amount: '10.5' } }, context()), 'pricing.amount', /cannot have decimals/);
  assert(comparePricing(p('perPerson', '1250.10'), p('perPerson', '1250.9')) < 0, 'exact decimal comparison');
  const scope = new MediaUrlScope({ getBlob: async () => null });
  const card = renderCard({ ...newRecord('dayTrip', { title: 'Boat' }), pricing: p('perVehicle', '80') }, { resolver: createResolver(context(), 'draft'), scope });
  assert(/per vehicle/.test(card.textContent) && !/per person/.test(card.textContent), card.textContent);
});

test('day-trip defaults: nothing seeded; copying is explicit and changes only that draft; saving defaults changes no day trip', () => withWorkspace(async ws => {
  assertEqual(await ws.defaults.getDayTripDefaults(), null, 'no guessed defaults are seeded');
  const lists = { inclusions: ['Boat hire'], whatToBring: [] };
  const defaults = { inclusions: ['Boat hire', 'Soft drinks'], whatToBring: ['Sun hat'] };
  const merged = copyDefaults(lists, defaults, 'merge');
  assertEqual([merged.lists, merged.added], [{ inclusions: ['Boat hire', 'Soft drinks'], whatToBring: ['Sun hat'] }, { inclusions: 1, whatToBring: 1 }]);
  assertEqual(copyDefaults({ inclusions: ['Old'], whatToBring: ['Old item'] }, defaults, 'replace').lists, { inclusions: ['Boat hire', 'Soft drinks'], whatToBring: ['Sun hat'] });
  assertEqual(lists.inclusions, ['Boat hire'], 'inputs are not mutated');

  const a = await ws.content.saveDraft({ ...newRecord('dayTrip', { title: 'A' }), inclusions: ['Own item'] });
  const b = await ws.content.saveDraft(newRecord('dayTrip', { title: 'B' }));
  const saved = await ws.defaults.saveDayTripDefaults({ inclusions: [' Soft  drinks ', 'Soft drinks', ''], whatToBring: ['Sun hat'] });
  assertEqual([saved.inclusions, saved.version], [['Soft drinks'], 1]);
  await assertRejects(ws.defaults.saveDayTripDefaults({ inclusions: [], whatToBring: [] }), { code: 'conflict' });
  await assertRejects(ws.defaults.saveDayTripDefaults({ inclusions: ['X'], whatToBring: [] }, { expectedVersion: 7 }), { code: 'stale' });
  ws.faults.failNext('saveDayTripDefaults', 'QuotaExceededError');
  await assertRejects(ws.defaults.saveDayTripDefaults({ inclusions: ['Y'], whatToBring: [] }, { expectedVersion: 1 }), { code: 'quota' });
  assertEqual((await ws.defaults.getDayTripDefaults()).inclusions, ['Soft drinks'], 'a failed save changes nothing');

  await ws.content.saveDraft({ ...a.record, ...copyDefaults(a.record, saved, 'merge').lists }, { expectedVersion: 1 });
  await ws.defaults.saveDayTripDefaults({ inclusions: ['Changed default'], whatToBring: [] }, { expectedVersion: 1 });
  const [a2, b2] = [await ws.content.get(a.id), await ws.content.get(b.id)];
  assertEqual([a2.record.inclusions, a2.record.whatToBring, a2.record.version], [['Own item', 'Soft drinks'], ['Sun hat'], 2], 'editing defaults later does not change the copy');
  assertEqual([b2.record.inclusions, b2.record.whatToBring, b2.record.version], [[], [], 1], 'other day trips untouched');
}));

test('routes: day trips use /tours/day-trips/{slug}; no collision with tour slugs or hub routes; hash routes parse', () => withWorkspace(async ws => {
  assertEqual(routeFor('dayTrip', 'sunset-cruise'), '/tours/day-trips/sunset-cruise');
  assert(RESERVED_ROUTES.includes(HUB_ROUTES.dayTrips), 'listing hub reserved');
  await ws.content.saveDraft({ ...newRecord('tour', { title: 'Tour' }), slug: 'sunset-cruise' });
  const trip = await ws.content.saveDraft({ ...newRecord('dayTrip', { title: 'Trip' }), slug: 'sunset-cruise' });
  assertEqual(trip.record.slug, 'sunset-cruise', 'same slug as a tour is a different route');
  await assertRejects(ws.content.saveDraft({ ...newRecord('tour', { title: 'Hub' }), slug: 'day-trips' }), { code: 'validation' });
  const archived = await ws.content.archive(trip.id, { expectedVersion: 1 });
  const err = await assertRejects(ws.content.saveDraft({ ...newRecord('dayTrip', { title: 'Again' }), slug: 'sunset-cruise' }), { code: 'validation' });
  assert(err.issues.some(i => i.path === 'slug' && /archived/.test(i.message)));
  await ws.content.restore(trip.id, { expectedVersion: archived.record.version });
  assertEqual((await ws.content.duplicate(trip.id)).record.slug, 'sunset-cruise-copy');

  const site = parseRoute('#/site/tours/day-trips?filter=tag&value=a%26b');
  assertEqual([site.type, site.path, site.params.get('filter'), site.params.get('value')], ['site', '/tours/day-trips', 'tag', 'a&b']);
  assertEqual([parseRoute('#/day-trips').type, parseRoute('#/day-trips/new').def.kind, parseRoute('#/day-trips/defaults').type], ['list', 'dayTrip', 'day-trip-defaults']);
  assertEqual(parseRoute(`#/day-trips/${trip.id}/preview?rev=draft`).type, 'preview');
  assertEqual(parseRoute('#/taxonomies?group=tag').params.get('group'), 'tag');
}));

test('storage: stale day-trip and taxonomy writes and simulated transaction failures never report success', () => withWorkspace(async ws => {
  const trip = await ws.content.saveDraft(newRecord('dayTrip', { title: 'Original' }));
  await ws.content.saveDraft({ ...trip.record, title: 'Tab A' }, { expectedVersion: 1 });
  await assertRejects(ws.content.saveDraft({ ...trip.record, title: 'Tab B' }, { expectedVersion: 1 }), { code: 'stale' });
  ws.faults.failNext('saveDraft', 'QuotaExceededError');
  await assertRejects(ws.content.saveDraft({ ...trip.record, title: 'Lost' }, { expectedVersion: 2 }), { code: 'quota' });
  assertEqual((await ws.content.get(trip.id)).record.title, 'Tab A');
  ws.faults.failNext('createTerm', 'UnknownError');
  await assertRejects(ws.taxonomies.create('tag', 'Never stored'), { code: 'unknown' });
  assertEqual(await ws.taxonomies.list(), []);
  const a = await ws.taxonomies.create('tag', 'A');
  const b = await ws.taxonomies.create('tag', 'B');
  ws.faults.failNext('moveTerm', 'AbortError');
  await assertRejects(ws.taxonomies.move(b.id, -1), { code: 'aborted' });
  assertEqual((await ws.taxonomies.list()).map(t => [t.label, t.order, t.version]), [['A', 1, 1], ['B', 2, 1]]);
  ws.faults.failNext('setTermActive', 'QuotaExceededError');
  await assertRejects(ws.taxonomies.setActive(a.id, false, { expectedVersion: 1 }), { code: 'quota' });
  ws.faults.failNext('publishTaxonomy', 'QuotaExceededError');
  await assertRejects(ws.taxonomies.publish(), { code: 'quota' });
  assertEqual([await ws.taxonomies.getPublication(), (await ws.taxonomies.list())[0].active], [null, true]);
  await assertRejects(ws.taxonomies.setActive(a.id, false, { expectedVersion: 99 }), { code: 'stale' });
}));

// ---- upgrade ----
test('storage: upgrading a populated version-2 database keeps every module and upgrades terms in place', async () => {
  const dbName = `vion-test-${crypto.randomUUID()}`;
  const file = await imageFile();
  const at = '2026-10-20T08:00:00.000Z';
  const img = { id: crypto.randomUUID(), fileName: 'old.png', type: 'image/png', size: file.size, width: 1600, height: 900, alt: 'Old', credit: '', caption: '', createdAt: at, updatedAt: at, version: 1 };
  const legacyTerm = (namespace, label, version = 1) => ({ id: crypto.randomUUID(), namespace, label, createdAt: at, updatedAt: at, version });
  const terms = [legacyTerm('type', 'Private safari', 2), legacyTerm('tag', 'Wildlife'), legacyTerm('tag', 'Big Five')];
  const dest = { ...completeDestination(img), slug: 'serengeti', status: 'published', version: 3 };
  const pubRoute = '/destinations/serengeti';
  const destEnv = envelope(dest, { lastPublishedRoute: pubRoute, routeHistory: [{ route: '/destinations/serengeti-national-park', firstPublishedAt: at }, { route: pubRoute, firstPublishedAt: at }], publishedRevision: 2, lastPublishedAt: at, publishedSourceVersion: 3 });
  const acc = completeAccommodation(img, dest.id);
  const tour = { ...completeTour(img, [dest.id], { typeId: terms[0].id, tagIds: [terms[1].id] }), status: 'published', version: 2 };
  const tourEnv = envelope(tour, { lastPublishedRoute: '/tours/two-day-serengeti-safari', routeHistory: [{ route: '/tours/two-day-serengeti-safari', firstPublishedAt: at }], publishedRevision: 1, lastPublishedAt: at, publishedSourceVersion: 2 });
  const redirect = { id: crypto.randomUUID(), from: '/destinations/serengeti-national-park', to: pubRoute, statusCode: 308, recordId: dest.id, kind: 'destination', createdAt: at, updatedAt: at };
  const member = { ...completeMember(img), status: 'published' };
  const siteWorkflow = { priorStatus: null, publishedRevision: 1, lastPublishedAt: at, publishedSourceVersion: 1, archivedAt: null, priorVisible: null };
  const lineup = { ...newLineup(), entries: [{ memberId: member.id, visible: true }] };
  // Frozen copy of the version-2 layout (what browsers that ran the Site Settings & Team release hold).
  await new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ['records', 'published']) db.createObjectStore(name, { keyPath: 'id' }).createIndex('kind', 'kind');
      db.createObjectStore('redirects', { keyPath: 'id' }).createIndex('from', 'from', { unique: true });
      db.createObjectStore('assets', { keyPath: 'id' });
      db.createObjectStore('assetBlobs', { keyPath: 'id' });
      db.createObjectStore('taxonomies', { keyPath: 'id' }).createIndex('namespace', 'namespace');
      db.createObjectStore('meta', { keyPath: 'key' });
      for (const name of ['siteRecords', 'sitePublished']) db.createObjectStore(name, { keyPath: 'id' }).createIndex('kind', 'kind');
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['records', 'published', 'redirects', 'assets', 'assetBlobs', 'taxonomies', 'siteRecords', 'sitePublished'], 'readwrite');
      for (const env of [destEnv, envelope(acc), tourEnv]) tx.objectStore('records').put(env);
      tx.objectStore('published').put({ id: dest.id, kind: 'destination', revision: 2, publishedAt: at, sourceVersion: 3, route: pubRoute, snapshot: dest });
      tx.objectStore('published').put({ id: tour.id, kind: 'tour', revision: 1, publishedAt: at, sourceVersion: 2, route: '/tours/two-day-serengeti-safari', snapshot: tour });
      tx.objectStore('redirects').put(redirect);
      tx.objectStore('assets').put(img);
      tx.objectStore('assetBlobs').put({ id: img.id, blob: file });
      for (const t of terms) tx.objectStore('taxonomies').put(t);
      tx.objectStore('siteRecords').put({ id: 'site-settings', kind: 'siteSettings', record: newSettings(), workflow: { ...siteWorkflow, publishedRevision: 0, lastPublishedAt: null, publishedSourceVersion: null } });
      tx.objectStore('siteRecords').put({ id: member.id, kind: 'teamMember', record: member, workflow: siteWorkflow });
      tx.objectStore('siteRecords').put({ id: lineup.id, kind: 'teamLineup', record: lineup, workflow: { ...siteWorkflow, publishedRevision: 0, lastPublishedAt: null, publishedSourceVersion: null } });
      tx.objectStore('sitePublished').put({ id: member.id, kind: 'teamMember', revision: 1, publishedAt: at, sourceVersion: 1, snapshot: member });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });
  let ws;
  try {
    ws = await openWorkspace({ dbName, schema, siteSchema });
    assertEqual([ws.db.version, DB_VERSION], [3, 3]);
    assert(['taxonomyPublished', 'defaults', 'records', 'siteRecords', 'assetBlobs'].every(n => ws.db.objectStoreNames.contains(n)), 'stores missing after upgrade');
    const upgraded = await ws.taxonomies.list();
    for (const t of terms) {
      const u = upgraded.find(x => x.id === t.id);
      assertEqual([u.namespace, u.label, u.version, u.updatedAt, u.active], [t.namespace, t.label, t.version, t.updatedAt, true], `term ${t.label} kept`);
    }
    assertEqual(upgraded.filter(t => t.namespace === 'tag').map(t => [t.label, t.key, t.order]), [['Big Five', 'big-five', 1], ['Wildlife', 'wildlife', 2]]);
    const pub = await ws.taxonomies.getPublication();
    assertEqual([pub.revision, pub.origin, pub.terms.length], [1, 'upgrade', 3], 'existing labels stay visible on the local site');
    const ctx = await ws.loadContext();
    assertEqual([ctx.records.size, ctx.published.size, ctx.redirects.length, ctx.siteRecords.size, ctx.sitePublished.size], [3, 2, 1, 3, 1]);
    assertEqual(ctx.published.get(tour.id).snapshot, tour, 'published tour snapshot untouched');
    assertEqual(ctx.records.get(dest.id).workflow.routeHistory.length, 2);
    assertEqual((await ws.media.getBlob(img.id)).size, file.size);
    await assertRejects(ws.media.remove(img.id), { code: 'dependency' });
    const scope = new MediaUrlScope(ws.media);
    const page = renderRecordPage(tour, { resolver: createResolver(ctx, 'published'), scope });
    assert(page.textContent.includes('Private safari') && page.textContent.includes('Wildlife'), 'published tour labels resolve after the upgrade');
    scope.revokeAll();
    const trip = await ws.content.saveDraft(completeDayTrip(img, [dest.id], { tagIds: [terms[1].id] }));
    await ws.content.publish(trip.id, { expectedVersion: 1 });
    assertEqual(await ws.defaults.getDayTripDefaults(), null);
    const backup = JSON.parse(JSON.stringify(await ws.backup.exportData()));
    assertEqual([backup.schemasVersion, backup.records.length, backup.siteRecords.length, backup.taxonomyPublication.origin], [3, 4, 3, 'upgrade']);
  } finally {
    ws?.close();
    await deleteWorkspace(dbName);
  }
});

// ---- backup ----
test('backup: v3 data + media round-trip restores day trips, defaults, terms, the published taxonomy and redirects', () => withWorkspace(async source => {
  const { dest, tag } = await publishedBasics(source);
  const tripImg = await storedAsset(source);
  await source.taxonomies.create('type', 'Not yet published');
  let trip = await source.content.publish((await source.content.saveDraft(completeDayTrip(tripImg, [dest.id], { tagIds: [tag.id], duration: { value: 3, unit: 'hours' } }))).id, { expectedVersion: 1 });
  trip = await source.content.saveDraft({ ...trip.record, slug: 'evening-dhow' }, { expectedVersion: trip.record.version });
  trip = await source.content.publish(trip.id, { expectedVersion: trip.record.version });
  await source.content.saveDraft({ ...trip.record, overview: 'Unpublished draft text.' }, { expectedVersion: trip.record.version });
  await source.defaults.saveDayTripDefaults({ inclusions: ['Boat hire'], whatToBring: ['Sun hat'] });
  const data = JSON.parse(JSON.stringify(await source.backup.exportData()));
  const media = JSON.parse(JSON.stringify(await source.backup.exportMedia()));
  assertEqual([data.schemasVersion, data.taxonomyPublication.revision, data.dayTripDefaults.whatToBring, data.taxonomies.length], [3, 1, ['Sun hat'], 2]);
  const before = await source.loadContext();
  await withWorkspace(async target => {
    const stray = await target.content.saveDraft(newRecord('dayTrip', { title: 'Replaced by the import' }));
    await target.defaults.saveDayTripDefaults({ inclusions: ['Replaced'], whatToBring: [] });
    const applied = await target.backup.importData(data);
    assertEqual([applied.dayTrips, applied.keptDayTrips, applied.taxonomyPublished, applied.dayTripDefaults], [1, 0, true, true]);
    assert(applied.missingFiles > 0, 'the data backup alone has no image files and says so');
    const ctx = await target.loadContext();
    const sorted = map => JSON.stringify([...map.values()].sort((x, y) => x.id.localeCompare(y.id)));
    assertEqual(sorted(ctx.records), sorted(before.records), 'records identical');
    assertEqual(sorted(ctx.taxonomies), sorted(before.taxonomies), 'terms identical (IDs kept)');
    assertEqual(ctx.taxonomyPublication, before.taxonomyPublication);
    assert(!ctx.records.has(stray.id));
    assertEqual([ctx.published.get(trip.id).route, ctx.published.get(trip.id).snapshot.overview], ['/tours/day-trips/evening-dhow', 'An evening on the water.']);
    assertEqual(ctx.redirects.map(r => [r.from, r.to]), [['/tours/day-trips/sunset-dhow-cruise', '/tours/day-trips/evening-dhow']]);
    assertEqual((await target.defaults.getDayTripDefaults()).inclusions, ['Boat hire']);
    await target.backup.importMedia(media);
    const after = await target.loadContext();
    assert([...after.assets.values()].every(a => a.hasBlob), 'no missing files after the media import');
    await assertRejects(target.media.remove(tripImg.id), { code: 'dependency' });
  });
}));

test('backup: an older (schemasVersion 2) backup keeps current day trips, defaults and their terms; broken links reject it', () => withWorkspace(async ws => {
  const { img, dest, tag } = await publishedBasics(ws);
  const trip = await ws.content.publish((await ws.content.saveDraft(completeDayTrip(img, [dest.id], { tagIds: [tag.id] }))).id, { expectedVersion: 1 });
  await ws.defaults.saveDayTripDefaults({ inclusions: ['Boat hire'], whatToBring: ['Sun hat'] });
  const marine = await ws.taxonomies.create('tag', { label: 'Marine', key: 'sea-life' });
  await ws.taxonomies.setActive(marine.id, false, { expectedVersion: 1 });
  await ws.taxonomies.publish();
  const toV2 = source => {
    const v2 = structuredClone(source);
    v2.schemasVersion = 2;
    delete v2.taxonomyPublication;
    delete v2.dayTripDefaults;
    v2.records = v2.records.filter(e => e.kind !== 'dayTrip');
    v2.published = v2.published.filter(p => p.kind !== 'dayTrip');
    v2.redirects = v2.redirects.filter(r => r.kind !== 'dayTrip');
    v2.taxonomies = v2.taxonomies.map(({ key, order, active, ...t }) => t);
    return v2;
  };
  const current = JSON.parse(JSON.stringify(await ws.backup.exportData()));
  const legacy = toV2(current);
  legacy.taxonomies = legacy.taxonomies.filter(t => t.id !== tag.id); // the tag exists only in this browser
  legacy.taxonomies.push({ id: crypto.randomUUID(), namespace: 'type', label: 'Private safari', createdAt: current.exportedAt, updatedAt: current.exportedAt, version: 1 });
  legacy.records.find(e => e.id === dest.id).record.bestTime = 'From the older backup.';
  const preview = await ws.backup.previewImport(legacy);
  assert(preview.ok && preview.legacy, JSON.stringify(preview.errors));
  assertEqual([preview.kept.dayTrips, preview.kept.terms, preview.kept.defaults], [1, 1, true]);
  const applied = await ws.backup.importData(legacy);
  assertEqual([applied.schemasVersion, applied.keptDayTrips, applied.keptTerms, applied.keptDefaults], [2, 1, 1, true]);
  const ctx = await ws.loadContext();
  assertEqual(ctx.records.get(dest.id).record.bestTime, 'From the older backup.', 'content replaced');
  assertEqual([ctx.records.get(trip.id).record.status, ctx.published.get(trip.id).snapshot.tagIds], ['published', [tag.id]], 'day trip and its published version kept');
  assert(ctx.taxonomies.has(tag.id) && ctx.publishedTerms.has(tag.id), 'its tag kept, still published');
  const type = [...ctx.taxonomies.values()].find(t => t.namespace === 'type');
  assertEqual([type.key, type.order, type.active, ctx.publishedTerms.has(type.id)], ['private-safari', 1, true, true], 'older terms upgraded and published');
  const marineAfter = ctx.taxonomies.get(marine.id);
  assertEqual([marineAfter.key, marineAfter.active, ctx.publishedTerms.get(marine.id).key], ['sea-life', false, 'sea-life'], 'a known term keeps its key and active flag');
  assertEqual([ctx.taxonomyPublication.origin, ctx.taxonomyPublication.revision], ['import', 3]);
  assertEqual((await ws.defaults.getDayTripDefaults()).whatToBring, ['Sun hat'], 'defaults kept');

  const broken = toV2(JSON.parse(JSON.stringify(await ws.backup.exportData())));
  broken.records = broken.records.filter(e => e.id !== dest.id);
  broken.published = broken.published.filter(p => p.id !== dest.id);
  broken.redirects = broken.redirects.filter(r => r.recordId !== dest.id);
  const check = await ws.backup.previewImport(broken);
  assert(!check.ok && check.errors.some(e => /Published day trip “Sunset Dhow Cruise”: it links destination/.test(e)) && check.errors.some(e => /Kept day trip “Sunset Dhow Cruise” destinationIds/.test(e)), JSON.stringify(check.errors));
  await assertRejects(ws.backup.importData(broken), { code: 'validation' });
  assert((await ws.loadContext()).records.has(dest.id), 'a rejected import changes nothing');

  const exported = JSON.parse(JSON.stringify(await ws.backup.exportData()));
  const sneaky = toV2(exported);
  sneaky.records.push(exported.records.find(e => e.kind === 'dayTrip'));
  assert(ws.backup.validateDataBackup(sneaky).errors.some(e => /day trips need a schemasVersion 3 backup/.test(e)));
  const withV3Keys = { ...toV2(exported), dayTripDefaults: null };
  assert(ws.backup.validateDataBackup(withV3Keys).errors.some(e => /dayTripDefaults: is not part of a schemasVersion 2 backup/.test(e)));
}));

test('backup: v3 imports reject cross-namespace terms, unpublished or re-keyed published terms, malformed keys and missing images', () => withWorkspace(async ws => {
  const { img, dest, tag } = await publishedBasics(ws);
  const type = await ws.taxonomies.create('type', 'Private');
  await ws.taxonomies.publish();
  await ws.content.publish((await ws.content.saveDraft(completeTour(img, [dest.id], { typeId: type.id }))).id, { expectedVersion: 1 });
  await ws.content.publish((await ws.content.saveDraft(completeDayTrip(img, [dest.id], { tagIds: [tag.id] }))).id, { expectedVersion: 1 });
  await ws.defaults.saveDayTripDefaults({ inclusions: ['Boat hire'], whatToBring: [] });
  const base = JSON.parse(JSON.stringify(await ws.backup.exportData()));
  const attempt = async (mutate, pattern) => {
    const data = structuredClone(base);
    mutate(data);
    const err = await assertRejects(ws.backup.importData(data), { code: 'validation' });
    assert(err.errors.some(e => pattern.test(e)), `expected ${pattern} in ${JSON.stringify(err.errors)}`);
  };
  await attempt(d => { d.published.find(p => p.kind === 'tour').snapshot.typeId = tag.id; }, /where a tour type is required/);
  await attempt(d => { d.records.find(e => e.kind === 'dayTrip').record.tagIds = [type.id]; }, /is a tour type, not a tour tag/);
  await attempt(d => { d.taxonomyPublication.terms.find(t => t.id === tag.id).key = 'renamed-key'; }, /keys of published terms cannot change/);
  await attempt(d => { d.taxonomyPublication.terms = d.taxonomyPublication.terms.filter(t => t.id !== tag.id); }, /not in the published taxonomy of this backup/);
  await attempt(d => { d.published.find(p => p.kind === 'dayTrip').snapshot.cover.assetId = crypto.randomUUID(); }, /not in this backup’s image list/);
  await attempt(d => { d.taxonomies.find(t => t.id === type.id).key = 'Bad Key'; }, /lowercase letters|invalid format/);
  await attempt(d => { d.taxonomies.push({ ...d.taxonomies.find(t => t.id === tag.id), id: crypto.randomUUID(), label: 'BIRDING ', key: 'birding-2' }); }, /already exists as a tour tag/);
  await attempt(d => { d.dayTripDefaults.secret = 'x'; }, /dayTripDefaults\.secret: is not an allowed field/);
  await attempt(d => { delete d.dayTripDefaults; }, /dayTripDefaults: is missing/);
  await attempt(d => { d.records.find(e => e.kind === 'dayTrip').record.duration = { value: 30, unit: 'hours' }; }, /more than 24 hours/);
  const ctx = await ws.loadContext();
  assertEqual([ctx.records.size, ctx.taxonomies.size, ctx.taxonomyPublication.revision], [3, 2, 2], 'rejected imports changed nothing');
}));

// ---- local listing ----
test('local listing: the ?filter=tag&value= contract validates the filter and value and keeps readable states', () => {
  const now = new Date().toISOString();
  const birding = term('tag', 'Birding');
  const culture = term('tag', 'Culture', { active: false, order: 2 });
  const priv = term('type', 'Private');
  const publication = newTaxonomyPublication([birding, culture, priv], { now });
  const trip = (title, tagIds) => ({ ...newRecord('dayTrip', { title }), tagIds });
  const trips = [trip('A', [birding.id]), trip('B', [culture.id]), trip('C', [])];
  const run = qs => filterDayTrips(trips, new URLSearchParams(qs), publication);
  assertEqual([run('').status, run('').items.length], ['all', 3]);
  assertEqual([run('filter=tag&value=birding').status, run('filter=tag&value=birding').items.map(t => t.title)], ['filtered', ['A']]);
  assertEqual(run('filter=tag&value=%20BIRDING%20').items.map(t => t.title), ['A'], 'value is trimmed and case-insensitive');
  assertEqual(run('filter=tag&value=culture').items.map(t => t.title), ['B'], 'inactive published tags still match');
  const unknown = run('filter=tag&value=private');
  assertEqual([unknown.status, unknown.items.length], ['unknown-value', 0], 'a type key is not a tag');
  assert(/No published tag has the key “private”/.test(unknown.message));
  const invalid = run('filter=colour&value=red');
  assertEqual([invalid.status, invalid.items.length], ['invalid-filter', 3]);
  assert(/only filter=tag is/.test(invalid.message));
  assertEqual([run('filter=tag').status, run('value=birding').status], ['invalid-filter', 'invalid-filter']);
  assertEqual(filterDayTrips(trips, new URLSearchParams('filter=tag&value=birding'), null).status, 'unknown-value', 'nothing published yet');
});

// ---- team follow-up ----
test('team: publishing a profile offers “Review team visibility” and never publishes the team order', () => withWorkspace(async ws => {
  const portrait = await storedAsset(ws);
  const member = await ws.site.saveMember(completeMember(portrait));
  const published = await ws.site.publishMember(member.id, { expectedVersion: 1 });
  const nodes = teamModule.adapter.afterPublish(published, await ws.loadContext());
  const link = nodes[0].querySelector('a[data-action="review-visibility"]');
  assertEqual([link.getAttribute('href'), link.textContent], ['#/team?focus=lineup', 'Review team visibility']);
  assertEqual(await ws.site.getPublishedLineup(), null, 'the order is still published separately');
  assertEqual(parseRoute('#/team?focus=lineup').params.get('focus'), 'lineup');
}));
