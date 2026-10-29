import { createSchemaValidator } from '../src/modules/shared/schema-validator.js';
import { makeContext, newItineraryDay, newRecord, newWorkflow } from '../src/modules/shared/records.js';
import { deleteWorkspace, openWorkspace } from '../src/storage/workspace.js';
import { inspectImageFile } from '../src/storage/media-validation.js';

export const schema = await (await fetch('../schemas/content.schema.json')).json();
export const validator = createSchemaValidator(schema);

export const envelope = (record, workflow = {}) => ({ id: record.id, kind: record.kind, record, workflow: { ...newWorkflow(), ...workflow } });

export function context({ records = [], published = [], assets = [], taxonomies = [], redirects = [], blobs = true } = {}) {
  return makeContext({ records, published, redirects, assets, blobKeys: blobs ? assets.map(a => a.id) : [], taxonomies, validator });
}

export function asset(overrides = {}) {
  return { id: crypto.randomUUID(), fileName: 'photo.jpg', type: 'image/jpeg', size: 2048, width: 1600, height: 900, alt: 'Default alt', credit: '', caption: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1, ...overrides };
}

export const cover = (a, alt = 'Wildebeest crossing the Mara River') => ({ assetId: a.id, alt });

export function completeDestination(a, overrides = {}) {
  return { ...newRecord('destination', { title: 'Serengeti National Park' }), slug: 'serengeti-national-park', overview: 'Vast plains.', bestTime: 'June to October.', cover: cover(a), ...overrides };
}

export function completeAccommodation(a, destinationId, overrides = {}) {
  return { ...newRecord('accommodation', { title: 'Plains Camp' }), slug: 'plains-camp', description: 'Tented camp.', type: 'Lodge', standard: 'Luxury', destinationId, cover: cover(a, 'Tent at dusk'), ...overrides };
}

export function completeTour(a, destinationIds, overrides = {}) {
  const itinerary = [1, 2].map(n => ({ ...newItineraryDay(n), title: `Day ${n} title`, description: `Day ${n} narrative.` }));
  return {
    ...newRecord('tour', { title: 'Two Day Serengeti Safari' }), slug: 'two-day-serengeti-safari', overview: 'A short safari.', durationDays: 2,
    destinationIds, itinerary, inclusions: ['Park fees'], exclusions: ['Flights'], cover: cover(a, 'Jeep on the plains'), ...overrides
  };
}

export async function imageFile({ width = 1600, height = 900, type = 'image/png', name = 'test.png' } = {}) {
  const canvas = new OffscreenCanvas(width, height);
  const g = canvas.getContext('2d');
  g.fillStyle = '#aa791b';
  g.fillRect(0, 0, width, height);
  g.fillStyle = '#ffffff';
  g.fillRect(width / 4, height / 4, width / 2, height / 2);
  const blob = await canvas.convertToBlob({ type, quality: 0.8 });
  return new File([blob], name, { type });
}

export async function withWorkspace(fn) {
  const dbName = `vion-test-${crypto.randomUUID()}`;
  let ws = await openWorkspace({ dbName, schema });
  const reopen = async () => { ws.close(); ws = await openWorkspace({ dbName, schema }); return ws; };
  try {
    return await fn(ws, reopen, dbName);
  } finally {
    ws.close();
    await deleteWorkspace(dbName);
  }
}

export async function storedAsset(ws, options) {
  const inspected = await inspectImageFile(await imageFile(options));
  return ws.media.add(inspected, { alt: 'Stored image' });
}
