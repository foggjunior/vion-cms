// Blog article sections, destination highlights and image delivery URLs. In-memory domain only:
// no environment files, Firebase or Cloudinary calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { domain } from '../domain.mjs';
import { project } from '../publication.mjs';
import { DISPLAY_WIDTHS, deliveryUrl, displayWidth } from '../media-delivery.mjs';
import { newRecord } from '../../src/modules/shared/records.js';
import { newDocument, validateDocument } from '../../src/review/model.js';

const actor = { uid: 'article-editor', name: 'Editor', email: 'editor@example.com', role: 'admin' };

function seededImages(count) {
  const now = new Date().toISOString();
  const ids = Array.from({ length: count }, () => crypto.randomUUID());
  const entries = ids.flatMap((id, index) => [
    { store: 'assets', key: id, value: { id, fileName: `photo-${index}.jpg`, type: 'image/jpeg', size: 2000, width: 2400, height: 1600, alt: 'Photo', credit: '', caption: '', createdAt: now, updatedAt: now, version: 1 } },
    { store: 'assetBlobs', key: id, value: { id, url: `https://res.cloudinary.com/example/image/upload/v1/vion-cms/${id}.jpg`, publicId: 'vion-cms/' + id, provider: 'cloudinary' } }
  ]);
  return { ids, entries };
}

test('Display widths snap to the fixed Cloudinary renditions', () => {
  assert.deepEqual(DISPLAY_WIDTHS, [480, 1000, 1600]);
  assert.equal(displayWidth('300'), 480);
  assert.equal(displayWidth('480'), 480);
  assert.equal(displayWidth('900'), 1000);
  assert.equal(displayWidth('5000'), 1600);
  for (const value of [null, '', '0', '-20', 'large']) assert.equal(displayWidth(value), null);
});

test('Delivery URLs insert a resize transformation and reject other hosts', () => {
  const original = 'https://res.cloudinary.com/example/image/upload/v1731/vion-cms/abc.jpg';
  assert.equal(deliveryUrl(original, 480), 'https://res.cloudinary.com/example/image/upload/f_auto,q_auto,c_limit,w_480/v1731/vion-cms/abc.jpg');
  assert.equal(deliveryUrl(original, 777), original, 'only the fixed widths are produced');
  assert.equal(deliveryUrl('https://res.cloudinary.com/example/video/upload/v1/clip.mp4', 480), 'https://res.cloudinary.com/example/video/upload/v1/clip.mp4');
  assert.throws(() => deliveryUrl('https://example.com/image/upload/v1/a.jpg', 480), /Invalid stored image host/);
  assert.throws(() => deliveryUrl('http://res.cloudinary.com/example/image/upload/v1/a.jpg', 480), /Invalid stored image host/);
});

test('A blog with H1/H3 headings, aligned text and a photo pair publishes with its section photos', async () => {
  const { ids: [cover, first, second], entries } = seededImages(3);
  const blog = newDocument('blogs');
  Object.assign(blog, {
    title: 'Arusha National Park guide', slug: 'arusha-guide', categoryId: 'default-blog-safari', publishDate: '2026-11-18',
    coverAssetId: cover, imageAlt: 'Mount Meru', author: 'Vion',
    body: '@vion-rich:<h1>Arusha at a glance</h1><p style="text-align: justify;">Opening text.</p>' +
      `<div class="article-section-photos"><figure data-asset-id="${first}" data-alt="Giraffes"></figure>` +
      `<figure data-asset-id="${second}" data-alt="Canoes"><figcaption>Lake Duluti</figcaption></figure></div>` +
      '<p>Text after the photos.</p><h2>Walking safaris</h2><p>Walk.</p><h3>Climbing Mount Meru</h3><p>Climb.</p>'
  });
  assert.deepEqual(validateDocument(blog, { publish: true }), []);
  assert(validateDocument({ ...blog, body: '@vion-rich:<h1>One</h1><h3>Two</h3>' }, { publish: true })
    .includes('Add at least three distinct section headings before publishing.'));

  const d = await domain(entries, actor);
  try {
    let saved = await d.ws.review.save(blog, 0);
    saved = await d.ws.review.action(saved.id, 'publish', saved.version);
    assert.equal(saved.status, 'published');
    const feed = project(await d.dump());
    const article = feed.get('/blog/arusha-guide');
    assert.equal(article.data.body, blog.body, 'the article body is published exactly as written');
    for (const id of [cover, first, second]) assert(feed.get('/_media/' + id)?.data.url.endsWith(id + '.jpg'), 'section photo is in the public feed');
  } finally { d.close(); }
});

test('Destination highlights and signature experiences save, reopen and publish', async () => {
  const { ids: [cover], entries } = seededImages(1);
  const destination = newRecord('destination');
  assert.equal(destination.highlights, '');
  assert.equal(destination.signatureExperiences, '');
  Object.assign(destination, {
    title: 'Arusha National Park', slug: 'arusha-national-park', overview: 'A compact park below Mount Meru.',
    bestTime: 'June to October.', cover: { assetId: cover, alt: 'Mount Meru' },
    highlights: 'Momela Lakes: Flamingos and canoe trips.\n- Walking safaris',
    signatureExperiences: 'Canoeing on Momela Lakes: Paddle past hippos at sunrise.'
  });
  const d = await domain(entries, actor);
  let dumped;
  try {
    const saved = await d.ws.content.saveDraft(destination, { expectedVersion: null });
    await d.ws.content.publish(saved.id, { expectedVersion: saved.record.version });
    dumped = await d.dump();
  } finally { d.close(); }
  const published = project(dumped).get('/destinations/arusha-national-park');
  assert.equal(published.data.highlights, destination.highlights);
  assert.equal(published.data.signatureExperiences, destination.signatureExperiences);

  const reopened = await domain(dumped, actor);
  try {
    const record = (await reopened.ws.content.get(destination.id)).record;
    assert.equal(record.highlights, destination.highlights);
    const older = { ...record };
    delete older.highlights;
    delete older.signatureExperiences;
    await reopened.ws.content.saveDraft(older, { expectedVersion: record.version });
    assert.equal((await reopened.ws.content.get(destination.id)).record.highlights, undefined, 'older destinations without the fields still save');
  } finally { reopened.close(); }
});
