import test from 'node:test';
import assert from 'node:assert/strict';
import { domain } from '../domain.mjs';
import { DEFINITIONS, newDocument, validateDocument, reviewBackupIssues } from '../../src/review/model.js';

test('An older blog draft retains its excerpt after reopening and passes publication and backup validation', async () => {
  const actor = {uid:'legacy-blog-editor',name:'Editor',email:'editor@example.com',role:'admin'};
  const original = newDocument('blogs');
  Object.assign(original, {
    title:'Safari guide', slug:'safari-guide', excerpt:'An existing article summary.',
    categoryId:'default-blog-safari', publishDate:'2026-11-17',
    body:'@vion-rich:<h2>Wildlife</h2><p>Wildlife information.</p><h2>Seasons</h2><p>Season information.</p><h2>Planning</h2><p>Planning information.</p>',
    coverAssetId:crypto.randomUUID(), imageAlt:'Savannah landscape'
  });
  assert.deepEqual(validateDocument(original, {publish:true}), []);
  assert(!DEFINITIONS.blogs.fields.some(field => field.key === 'excerpt'));
  // Save without media first so this test needs no external image service.
  const draft = {...original, coverAssetId:''};
  const first = await domain([], actor);
  let entries;
  try {
    await first.ws.review.save(draft, 0);
    entries = await first.dump();
  } finally { first.close(); }
  const reopened = await domain(entries, actor);
  try {
    const saved = await reopened.ws.review.get(draft.id);
    assert.equal(saved.record.excerpt, original.excerpt);
    const edited = await reopened.ws.review.save({...saved.record,title:'Updated safari guide'}, saved.version);
    assert.equal(edited.record.excerpt, original.excerpt);
    assert.deepEqual(reviewBackupIssues([edited]), []);
    assert.deepEqual(validateDocument({...edited.record,coverAssetId:original.coverAssetId}, {publish:true}), []);
  } finally { reopened.close(); }
  assert(validateDocument({...original, excerpt:{invalid:true}}).includes('Excerpt must be text.'));
  assert(validateDocument({...original, unexpected:'value'}).includes('Unexpected field: unexpected'));
});
