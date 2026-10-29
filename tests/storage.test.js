import { assert, assertEqual, assertRejects, test } from './harness.js';
import { completeDestination, completeTour, imageFile, storedAsset, withWorkspace } from './fixtures.js';
import { inspectImageFile } from '../src/storage/media-validation.js';
import { newRecord } from '../src/modules/shared/records.js';

test('storage: drafts persist across database reconnects and versions increment', () => withWorkspace(async (ws, reopen) => {
  const draft = newRecord('destination', { title: 'Tarangire' });
  const saved = await ws.content.saveDraft(draft);
  assertEqual(saved.record.version, 1);
  const again = await ws.content.saveDraft({ ...saved.record, overview: 'Baobabs.' }, { expectedVersion: 1 });
  assertEqual(again.record.version, 2);
  const fresh = await reopen();
  const loaded = await fresh.content.get(draft.id);
  assertEqual([loaded.record.overview, loaded.record.version, loaded.record.status], ['Baobabs.', 2, 'draft']);
}));

test('storage: stale saves are rejected and leave the stored record unchanged', () => withWorkspace(async ws => {
  const saved = await ws.content.saveDraft(newRecord('tour', { title: 'Original' }));
  await ws.content.saveDraft({ ...saved.record, title: 'Tab A' }, { expectedVersion: 1 });
  await assertRejects(ws.content.saveDraft({ ...saved.record, title: 'Tab B' }, { expectedVersion: 1 }), { code: 'stale' });
  assertEqual((await ws.content.get(saved.id)).record.title, 'Tab A');
}));

test('storage: invalid supplied values and reserved slugs are rejected at save', () => withWorkspace(async ws => {
  const acc = newRecord('accommodation', { title: 'Lodge' });
  const err = await assertRejects(ws.content.saveDraft({ ...acc, website: 'javascript:alert(1)' }), { code: 'validation' });
  assert(err.issues.some(i => i.path === 'website'));
  assertEqual(await ws.content.get(acc.id), null);
  await assertRejects(ws.content.saveDraft({ ...newRecord('tour', { title: 'Hub' }), slug: 'day-trips' }), { code: 'validation', match: /invalid values/ });
}));

test('storage: simulated quota failure aborts the transaction and never reports success', () => withWorkspace(async ws => {
  const saved = await ws.content.saveDraft(newRecord('destination', { title: 'Before' }));
  ws.faults.failNext('saveDraft', 'QuotaExceededError');
  const err = await assertRejects(ws.content.saveDraft({ ...saved.record, title: 'After' }, { expectedVersion: 1 }), { code: 'quota' });
  assert(/no storage space/.test(err.message));
  const stored = await ws.content.get(saved.id);
  assertEqual([stored.record.title, stored.record.version], ['Before', 1]);
}));

test('storage: publishing creates an isolated snapshot; draft edits never republish', () => withWorkspace(async ws => {
  const img = await storedAsset(ws);
  const dest = await ws.content.saveDraft(completeDestination(img));
  await assertRejects(ws.content.publish(dest.id, { expectedVersion: 99 }), { code: 'stale' });
  const pub = await ws.content.publish(dest.id, { expectedVersion: 1 });
  assertEqual(pub.record.status, 'published');
  const edited = await ws.content.saveDraft({ ...pub.record, overview: 'Changed draft text.' }, { expectedVersion: pub.record.version });
  assertEqual((await ws.content.getPublished(dest.id)).snapshot.overview, 'Vast plains.');
  assert(edited.workflow.publishedSourceVersion !== edited.record.version, 'unpublished changes are detectable');
  await ws.content.publish(dest.id, { expectedVersion: edited.record.version });
  const snapshot = await ws.content.getPublished(dest.id);
  assertEqual([snapshot.snapshot.overview, snapshot.revision], ['Changed draft text.', 2]);
}));

test('storage: incomplete records cannot be published and report field issues', () => withWorkspace(async ws => {
  const saved = await ws.content.saveDraft(newRecord('tour', { title: 'Incomplete' }));
  const err = await assertRejects(ws.content.publish(saved.id, { expectedVersion: 1 }), { code: 'validation' });
  for (const path of ['slug', 'overview', 'durationDays', 'destinationIds', 'cover', 'inclusions']) assert(err.issues.some(i => i.path === path), `missing ${path}`);
  assertEqual(await ws.content.getPublished(saved.id), null);
}));

test('storage: changing a published slug plans a local 308 redirect and reserves the old route', () => withWorkspace(async ws => {
  const img = await storedAsset(ws);
  let dest = await ws.content.publish((await ws.content.saveDraft(completeDestination(img))).id, { expectedVersion: 1 });
  dest = await ws.content.saveDraft({ ...dest.record, slug: 'serengeti' }, { expectedVersion: dest.record.version });
  assertEqual(await ws.content.listRedirects(), [], 'saving a draft does not plan redirects');
  await ws.content.publish(dest.id, { expectedVersion: dest.record.version });
  const redirects = await ws.content.listRedirects();
  assertEqual(redirects.map(r => [r.from, r.to, r.statusCode]), [['/destinations/serengeti-national-park', '/destinations/serengeti', 308]]);
  await assertRejects(ws.content.saveDraft({ ...newRecord('destination', { title: 'Other' }), slug: 'serengeti-national-park' }), { code: 'validation' });
}));

test('storage: slugs stay unique against archived records', () => withWorkspace(async ws => {
  const old = await ws.content.saveDraft({ ...newRecord('accommodation', { title: 'Old Camp' }), slug: 'old-camp' });
  await ws.content.archive(old.id, { expectedVersion: 1 });
  const err = await assertRejects(ws.content.saveDraft({ ...newRecord('accommodation', { title: 'New' }), slug: 'old-camp' }), { code: 'validation' });
  assert(err.issues.some(i => i.path === 'slug' && /archived/.test(i.message)));
}));

test('storage: published dependencies block unpublish/archive until dependents are unpublished', () => withWorkspace(async ws => {
  const img = await storedAsset(ws);
  let dest = await ws.content.publish((await ws.content.saveDraft(completeDestination(img))).id, { expectedVersion: 1 });
  const tourDraft = await ws.content.saveDraft(completeTour(img, [dest.id]));
  let tour = await ws.content.publish(tourDraft.id, { expectedVersion: 1 });
  const err = await assertRejects(ws.content.unpublish(dest.id, { expectedVersion: dest.record.version }), { code: 'dependency' });
  assert(/Two Day Serengeti Safari/.test(err.message));
  await assertRejects(ws.content.archive(dest.id, { expectedVersion: dest.record.version }), { code: 'dependency' });
  tour = await ws.content.unpublish(tour.id, { expectedVersion: tour.record.version });
  assertEqual(tour.record.status, 'draft');
  dest = await ws.content.archive(dest.id, { expectedVersion: dest.record.version });
  assertEqual([dest.record.status, dest.workflow.priorStatus], ['archived', 'published']);
  assertEqual(await ws.content.getPublished(dest.id), null);
  await assertRejects(ws.content.saveDraft({ ...dest.record, title: 'x' }, { expectedVersion: dest.record.version }), { code: 'invalid-state' });
  dest = await ws.content.restore(dest.id, { expectedVersion: dest.record.version });
  assertEqual([dest.record.status, dest.record.overview], ['draft', 'Vast plains.'], 'restore returns to draft and keeps data');
  assertEqual(await ws.content.getPublished(dest.id), null, 'restore does not republish');
}));

test('storage: duplicate creates a new draft with a unique slug and no snapshot', () => withWorkspace(async ws => {
  const img = await storedAsset(ws);
  const dest = await ws.content.publish((await ws.content.saveDraft(completeDestination(img))).id, { expectedVersion: 1 });
  const copy = await ws.content.duplicate(dest.id);
  assert(copy.id !== dest.id);
  assertEqual([copy.record.status, copy.record.slug, copy.record.version, copy.workflow.publishedRevision], ['draft', 'serengeti-national-park-copy', 1, 0]);
  assertEqual(await ws.content.getPublished(copy.id), null);
  const second = await ws.content.duplicate(dest.id);
  assertEqual(second.record.slug, 'serengeti-national-park-copy-2');
}));

test('media: valid images persist as Blobs; SVG, fake and oversized files are rejected', () => withWorkspace(async (ws, reopen) => {
  const stored = await storedAsset(ws, { width: 640, height: 480 });
  assertEqual([stored.width, stored.height, stored.type], [640, 480, 'image/png']);
  const fresh = await reopen();
  const blob = await fresh.media.getBlob(stored.id);
  assertEqual([blob.size, blob.type], [stored.size, 'image/png']);
  const svg = await inspectImageFile(new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], 'logo.svg', { type: 'image/svg+xml' }));
  assert(!svg.ok && /SVG/.test(svg.errors[0]));
  const disguisedSvg = await inspectImageFile(new File(['<?xml version="1.0"?><svg></svg>'], 'photo.png', { type: 'image/png' }));
  assert(!disguisedSvg.ok && /SVG/.test(disguisedSvg.errors[0]), 'SVG content renamed to .png is rejected');
  const fake = await inspectImageFile(new File(['not really an image'], 'photo.jpg', { type: 'image/jpeg' }));
  assert(!fake.ok && /not a JPEG, PNG or WebP/.test(fake.errors[0]));
  const truncated = await imageFile({ type: 'image/png' });
  const broken = await inspectImageFile(new File([(await truncated.arrayBuffer()).slice(0, 40)], 'broken.png', { type: 'image/png' }));
  assert(!broken.ok && /decoded/.test(broken.errors.join(' ')), `truncated image rejected: ${broken.errors}`);
  const big = await inspectImageFile(await imageFile(), { maxBytes: 100, allowedTypes: ['image/png'], lowResolutionWidth: 1200 });
  assert(!big.ok && /upload limit/.test(big.errors[0]));
  const small = await inspectImageFile(await imageFile({ width: 300, height: 200, type: 'image/webp', name: 'small.webp' }));
  assert(small.ok && small.warnings.some(w => /Low resolution/.test(w)), 'WebP accepted with a low-resolution warning');
}));

test('media: referenced assets cannot be deleted; unreferenced ones can', () => withWorkspace(async ws => {
  const used = await storedAsset(ws);
  const unused = await storedAsset(ws);
  await ws.content.saveDraft(completeDestination(used));
  await assertRejects(ws.media.remove(used.id), { code: 'dependency', match: /Serengeti/ });
  await ws.media.remove(unused.id);
  assertEqual((await ws.media.list()).map(a => a.id), [used.id]);
}));

test('taxonomy: stable terms, unique labels and referenced-term protection', () => withWorkspace(async ws => {
  const term = await ws.taxonomies.create('type', 'Private safari');
  await assertRejects(ws.taxonomies.create('type', 'private SAFARI'), { code: 'conflict' });
  await ws.taxonomies.create('tag', 'Private safari');
  const tour = await ws.content.saveDraft({ ...newRecord('tour', { title: 'Typed' }), typeId: term.id });
  await assertRejects(ws.taxonomies.remove(term.id), { code: 'dependency' });
  const renamed = await ws.taxonomies.rename(term.id, 'Private tour', { expectedVersion: 1 });
  assertEqual([renamed.id, renamed.label], [term.id, 'Private tour']);
  await ws.content.saveDraft({ ...tour.record, typeId: null }, { expectedVersion: 1 });
  await ws.taxonomies.remove(term.id);
}));

test('backup: data and media exports round-trip into an empty workspace', () => withWorkspace(async source => {
  const img = await storedAsset(source);
  const term = await source.taxonomies.create('tag', 'Wildlife');
  let dest = await source.content.publish((await source.content.saveDraft(completeDestination(img))).id, { expectedVersion: 1 });
  dest = await source.content.saveDraft({ ...dest.record, slug: 'serengeti' }, { expectedVersion: dest.record.version });
  await source.content.publish(dest.id, { expectedVersion: dest.record.version });
  await source.content.saveDraft({ ...completeTour(img, [dest.id]), tagIds: [term.id] });
  const data = JSON.parse(JSON.stringify(await source.backup.exportData()));
  const media = JSON.parse(JSON.stringify(await source.backup.exportMedia()));
  assertEqual([data.binaryAssetsIncluded, /does NOT contain image files/.test(data.notice), media.binaryAssetsIncluded], [false, true, true]);
  await withWorkspace(async target => {
    assertEqual(await target.backup.importData(data), { records: 2, published: 1, redirects: 1, taxonomies: 1, assets: 1 });
    const ctx = await target.loadContext();
    assertEqual(ctx.assets.get(img.id).hasBlob, false, 'data backup alone restores metadata only');
    assertEqual(ctx.published.get(dest.id).route, '/destinations/serengeti');
    assertEqual(ctx.redirects[0].from, '/destinations/serengeti-national-park');
    assertEqual(await target.backup.importMedia(media), { restored: 1, added: 0 });
    assertEqual((await target.media.getBlob(img.id)).size, img.size);
    assertEqual(JSON.parse(JSON.stringify(await target.backup.exportData())).records.length, 2);
  });
}));

test('backup: unsafe or inconsistent imports are rejected completely and change nothing', () => withWorkspace(async ws => {
  const keep = await ws.content.saveDraft(newRecord('destination', { title: 'Keep me' }));
  const base = JSON.parse(JSON.stringify(await ws.backup.exportData()));
  const attempt = async (mutate, pattern) => {
    const data = structuredClone(base);
    mutate(data);
    const err = await assertRejects(ws.backup.importData(data), { code: 'validation' });
    assert(err.errors.some(e => pattern.test(e)), `expected ${pattern} in ${JSON.stringify(err.errors)}`);
  };
  const acc = { id: crypto.randomUUID(), kind: 'accommodation', record: null, workflow: base.records[0].workflow };
  acc.record = { ...newRecord('accommodation', { id: acc.id, title: 'Bad link' }), website: 'javascript:alert(document.cookie)' };
  await attempt(d => d.records.push(acc), /rejected for safety/);
  await attempt(d => { d.schemasVersion = 2; }, /schemasVersion/);
  await attempt(d => { d.records[0].record.status = 'published'; }, /no published snapshot/);
  await attempt(d => { d.records[0].record.extra = '<script>'; }, /not an allowed field/);
  await attempt(d => d.assets.push({ id: crypto.randomUUID(), fileName: 'x.svg', type: 'image/svg+xml', size: 10, width: 1, height: 1, alt: '', credit: '', caption: '', createdAt: base.exportedAt, updatedAt: base.exportedAt, version: 1 }), /SVG/);
  await attempt(d => d.records.push({ ...structuredClone(d.records[0]) }), /duplicated/);
  const ctx = await ws.loadContext();
  assertEqual([ctx.records.size, ctx.records.get(keep.id).record.title], [1, 'Keep me']);
}));

test('backup: imported markup is kept verbatim as text for escaped rendering', () => withWorkspace(async ws => {
  const data = JSON.parse(JSON.stringify(await ws.backup.exportData()));
  const rec = newRecord('destination', { title: '<img src=x onerror=alert(1)>' });
  rec.overview = '<script>alert("x")</script>';
  data.records.push({ id: rec.id, kind: rec.kind, record: rec, workflow: { priorStatus: null, lastPublishedRoute: null, routeHistory: [], publishedRevision: 0, lastPublishedAt: null, publishedSourceVersion: null, archivedAt: null } });
  await ws.backup.importData(data);
  assertEqual((await ws.content.get(rec.id)).record.overview, '<script>alert("x")</script>');
}));
