// Record factories, form conversion and reference helpers shared by the UI and the repositories.
import { newId } from './format.js';
import { SITE_KIND_LABELS, editorHref, siteAssetRefs, siteRecordTitle } from './site.js';
import { TAXONOMY_PUBLICATION_ID } from './taxonomy.js';
import { parseDuration } from './day-trips.js';

export { TAXONOMY_NAMESPACES } from './taxonomy.js';
export const KINDS = Object.freeze(['destination', 'accommodation', 'tour', 'dayTrip']);
// Kinds that existed before day trips; backups older than schemasVersion 3 may only contain these.
export const LEGACY_KINDS = Object.freeze(['destination', 'accommodation', 'tour']);
export const KIND_LABELS = Object.freeze({ destination: 'Destination', accommodation: 'Accommodation', tour: 'Tour', dayTrip: 'Day trip' });
export const ACCOMMODATION_SETTINGS = Object.freeze({ unspecified: 'Not specified', insidePark: 'Inside park', outsidePark: 'Outside park' });
// Audit examples only, offered as suggestions; values remain free text (not confirmed business rules).
export const ACCOMMODATION_TYPE_EXAMPLES = Object.freeze(['Hotel', 'Lodge', 'Campsite']);
export const ACCOMMODATION_STANDARD_EXAMPLES = Object.freeze(['Luxury', 'Semi Luxury', 'Normal']);
export const MEAL_OPTIONS = Object.freeze(['Breakfast', 'Lunch', 'Dinner']);

// Numeric fields edited as raw text so malformed input can be reported instead of silently dropped.
const NUMERIC_FIELDS = { tour: ['durationDays', 'recommendedRank'], destination: ['order'], accommodation: [], dayTrip: ['displayOrder'] };

const emptySeo = () => ({ title: '', description: '', shareAssetId: null, noindex: false });

export function newRecord(kind, { id = newId(), now = new Date().toISOString(), title = '' } = {}) {
  const base = { id, kind, title, slug: '', status: 'draft', createdAt: now, updatedAt: now, version: 1, schemaVersion: 1, cover: null, gallery: [], seo: emptySeo() };
  if (kind === 'destination') return { ...base, internalName: '', displayName: '', overview: '', wildlife: '', activities: [], bestTime: '', travelTips: [] };
  if (kind === 'accommodation') return {
    ...base, destinationId: null, noDestinationReason: '', type: '', standard: '', setting: 'unspecified', description: '',
    amenities: [], activities: [], publicPhone: '', publicPhoneVisible: false, website: '', publicPageEnabled: true
  };
  if (kind === 'tour') return {
    ...base, summary: '', overview: '', durationDays: null, destinationIds: [], typeId: null, categoryId: null, standardId: null,
    tagIds: [], itinerary: [], inclusions: [], exclusions: [], featured: false, pricing: { mode: 'request' }
  };
  // Day trips deliberately have no accommodation, tour type, category or standard fields.
  if (kind === 'dayTrip') return {
    ...base, summary: '', overview: '', destinationIds: [], tagIds: [], duration: null, schedule: [],
    inclusions: [], exclusions: [], whatToBring: [], featured: false, pricing: { mode: 'request' }
  };
  throw new Error(`Unknown kind ${kind}`);
}

export function newWorkflow() {
  return { priorStatus: null, lastPublishedRoute: null, routeHistory: [], publishedRevision: 0, lastPublishedAt: null, publishedSourceVersion: null, archivedAt: null };
}

export function newItineraryDay(dayNumber) {
  return { id: newId(), dayNumber, title: '', description: '', destinationIds: [], accommodationIds: [], meals: [], activities: [] };
}

export function newTravelTip() { return { id: newId(), title: '', body: '' }; }

export function publicName(record) {
  return (record.kind === 'destination' && record.displayName?.trim()) || record.title || 'Untitled';
}

// Text used for generated SEO descriptions and card teasers when nothing more specific is entered.
export const descriptionSource = record => (record.kind === 'tour' || record.kind === 'dayTrip' ? record.summary || record.overview : record.kind === 'destination' ? record.overview : record.description);

// Form model = record with numeric fields as strings and optional fields materialised for binding.
export function recordToForm(record) {
  const form = structuredClone(record);
  for (const key of NUMERIC_FIELDS[record.kind] || []) form[key] = form[key] == null ? '' : String(form[key]);
  form.seo = { ...emptySeo(), ...(form.seo || {}) };
  form.gallery = form.gallery || [];
  if (record.kind === 'tour') {
    form.pricing = { mode: 'request', ...(form.pricing || {}) };
    form.itinerary = (form.itinerary || []).map(day => ({ destinationIds: [], accommodationIds: [], meals: [], activities: [], ...day }));
  }
  if (record.kind === 'dayTrip') {
    form.pricing = { mode: 'request', ...(form.pricing || {}) };
    // The form always holds a duration object; a blank value is stored as "no duration".
    form.duration = { value: record.duration ? String(record.duration.value) : '', unit: record.duration?.unit || 'hours' };
    for (const key of ['schedule', 'inclusions', 'exclusions', 'whatToBring', 'destinationIds', 'tagIds']) form[key] = form[key] || [];
  }
  return form;
}

const cleanList = list => {
  const out = [];
  for (const item of list || []) {
    const value = String(item).replace(/\s+/g, ' ').trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
};
const uniqueIds = list => [...new Set((list || []).filter(Boolean))];

// Converts a form model into a schema-shaped draft. Returns field issues for malformed numeric input.
export function formToRecord(form) {
  const record = structuredClone(form);
  const issues = [];
  const integerField = (key, { min, label, optional }) => {
    const raw = String(form[key] ?? '').trim();
    if (raw === '') { if (optional) delete record[key]; else record[key] = null; return; }
    if (!/^-?\d+$/.test(raw)) { issues.push({ path: key, severity: 'error', message: `${label} must be a whole number${min != null ? ` of ${min} or more` : ''} (digits only).` }); delete record[key]; return; }
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) { issues.push({ path: key, severity: 'error', message: `${label} is too large.` }); delete record[key]; return; }
    if (min != null && value < min) issues.push({ path: key, severity: 'error', message: `${label} must be ${min} or more; ${value} is not allowed.` });
    record[key] = value;
  };
  for (const key of ['title', 'slug']) record[key] = String(record[key] || '').trim();
  record.seo = { title: (form.seo?.title || '').trim(), description: (form.seo?.description || '').trim(), shareAssetId: form.seo?.shareAssetId || null, noindex: !!form.seo?.noindex };
  if (record.cover) record.cover = cleanPlacement(record.cover);
  record.gallery = (record.gallery || []).map(cleanPlacement);

  if (record.kind === 'destination') {
    for (const key of ['internalName', 'displayName']) record[key] = String(record[key] || '').trim();
    record.activities = cleanList(record.activities);
    record.travelTips = (record.travelTips || []).map(tip => ({ id: tip.id, title: String(tip.title || '').trim(), body: String(tip.body || '').trim() }));
    integerField('order', { label: 'Order', optional: true });
  }
  if (record.kind === 'accommodation') {
    for (const key of ['type', 'standard', 'publicPhone', 'website']) record[key] = String(record[key] || '').trim();
    record.amenities = cleanList(record.amenities);
    record.activities = cleanList(record.activities);
    record.destinationId = record.destinationId || null;
    record.noDestinationReason = record.destinationId ? '' : String(record.noDestinationReason || '').trim();
  }
  if (record.kind === 'tour') {
    integerField('durationDays', { min: 1, label: 'Duration (days)' });
    integerField('recommendedRank', { min: 0, label: 'Recommended rank', optional: true });
    record.destinationIds = uniqueIds(record.destinationIds);
    record.tagIds = uniqueIds(record.tagIds);
    for (const key of ['typeId', 'categoryId', 'standardId']) record[key] = record[key] || null;
    record.inclusions = cleanList(record.inclusions);
    record.exclusions = cleanList(record.exclusions);
    record.itinerary = (record.itinerary || []).map((day, index) => ({
      id: day.id, dayNumber: index + 1, title: String(day.title || '').trim(), description: String(day.description || '').trim(),
      destinationIds: uniqueIds(day.destinationIds), accommodationIds: uniqueIds(day.accommodationIds),
      meals: cleanList(day.meals), activities: cleanList(day.activities)
    }));
    record.pricing = cleanPricing(form.pricing);
  }
  if (record.kind === 'dayTrip') {
    integerField('displayOrder', { min: 0, label: 'Display order', optional: true });
    record.destinationIds = uniqueIds(record.destinationIds);
    record.tagIds = uniqueIds(record.tagIds);
    record.featured = !!record.featured;
    for (const key of ['inclusions', 'exclusions', 'whatToBring']) record[key] = cleanList(record[key]);
    record.schedule = (record.schedule || []).map(item => ({ id: item.id, heading: String(item.heading || '').trim(), description: String(item.description || '').trim() }));
    const parsed = parseDuration(form.duration);
    issues.push(...parsed.issues);
    if (parsed.duration === undefined) delete record.duration; else record.duration = parsed.duration;
    record.pricing = cleanPricing(form.pricing);
  }
  return { record, issues };
}

function cleanPlacement(p) {
  const out = { assetId: p.assetId, alt: String(p.alt || '').trim() };
  if (p.decorative) out.decorative = true;
  if (p.caption && String(p.caption).trim()) out.caption = String(p.caption).trim();
  return out;
}

function cleanPricing(pricing) {
  // Request mode never stores an amount, so it can never be read as zero.
  if (!pricing || pricing.mode !== 'manualFrom') return { mode: pricing?.mode === undefined ? 'request' : pricing.mode };
  const out = { mode: 'manualFrom' };
  const currency = String(pricing.currency || '').trim().toUpperCase();
  const amount = String(pricing.amount ?? '').trim();
  const applicability = String(pricing.applicability || '').trim();
  if (currency) out.currency = currency;
  if (amount) out.amount = amount;
  if (pricing.basis) out.basis = pricing.basis;
  if (applicability) out.applicability = applicability;
  return out;
}

// Relationship references: [{ path, id, kind }]
export function relationRefs(record) {
  const refs = [];
  if (record.kind === 'accommodation' && record.destinationId) refs.push({ path: 'destinationId', id: record.destinationId, kind: 'destination' });
  if (record.kind === 'dayTrip') for (const id of record.destinationIds || []) refs.push({ path: 'destinationIds', id, kind: 'destination' });
  if (record.kind === 'tour') {
    for (const id of record.destinationIds || []) refs.push({ path: 'destinationIds', id, kind: 'destination' });
    (record.itinerary || []).forEach((day, i) => {
      for (const id of day.destinationIds || []) refs.push({ path: `itinerary.${i}.destinationIds`, id, kind: 'destination' });
      for (const id of day.accommodationIds || []) refs.push({ path: `itinerary.${i}.accommodationIds`, id, kind: 'accommodation' });
    });
  }
  return refs;
}

export function assetRefs(record) {
  const refs = [];
  if (record.cover?.assetId) refs.push({ path: 'cover', assetId: record.cover.assetId, role: 'cover' });
  (record.gallery || []).forEach((p, i) => refs.push({ path: `gallery.${i}`, assetId: p.assetId, role: 'gallery' }));
  if (record.seo?.shareAssetId) refs.push({ path: 'seo.shareAssetId', assetId: record.seo.shareAssetId, role: 'share image' });
  return refs;
}

// Term references: [{ path, id, namespace }]. Day trips reference tags only.
export function taxonomyRefs(record) {
  if (record.kind === 'dayTrip') return (record.tagIds || []).map(id => ({ path: 'tagIds', id, namespace: 'tag' }));
  if (record.kind !== 'tour') return [];
  const refs = [];
  for (const [key, namespace] of [['typeId', 'type'], ['categoryId', 'category'], ['standardId', 'standard']]) {
    if (record[key]) refs.push({ path: key, id: record[key], namespace });
  }
  for (const id of record.tagIds || []) refs.push({ path: 'tagIds', id, namespace: 'tag' });
  return refs;
}

// Sort helper: missing numbers sort last; zero is a real value.
export const compareOptionalNumber = key => (a, b) => {
  const x = a.record[key];
  const y = b.record[key];
  if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1;
  return x - y;
};

export const hasUnpublishedChanges = env => env.record.status === 'published' && env.workflow.publishedSourceVersion !== env.record.version;

// Builds the lookup context used by validation, from plain arrays read out of storage. Site settings, team
// profiles and the team lineup (siteRecords/sitePublished) are kept apart from content records so slug,
// route, redirect and content-dependency rules never see them. `taxonomies` are the working terms;
// `publishedTerms` come from the published taxonomy snapshot that the local preview site uses.
export function makeContext({ records = [], published = [], redirects = [], assets = [], blobKeys = [], taxonomies = [], taxonomyPublication = null, siteRecords = [], sitePublished = [], validator = null, siteValidator = null }) {
  const blobs = new Set(blobKeys);
  const publication = taxonomyPublication?.id === TAXONOMY_PUBLICATION_ID ? taxonomyPublication : null;
  return {
    records: new Map(records.map(env => [env.id, env])),
    published: new Map(published.map(p => [p.id, p])),
    redirects,
    assets: new Map(assets.map(a => [a.id, { ...a, hasBlob: blobs.has(a.id) }])),
    taxonomies: new Map(taxonomies.map(t => [t.id, t])),
    taxonomyPublication: publication,
    publishedTerms: new Map((publication?.terms || []).map(t => [t.id, t])),
    siteRecords: new Map(siteRecords.map(env => [env.id, env])),
    sitePublished: new Map(sitePublished.map(p => [p.id, p])),
    validator,
    siteValidator
  };
}

// Published snapshots and working drafts that reference the given record id.
export function dependentsOf(id, ctx) {
  const published = [];
  const drafts = [];
  for (const pub of ctx.published.values()) {
    if (pub.id !== id && relationRefs(pub.snapshot).some(ref => ref.id === id)) published.push({ id: pub.id, kind: pub.kind, title: pub.snapshot.title });
  }
  for (const env of ctx.records.values()) {
    if (env.id !== id && relationRefs(env.record).some(ref => ref.id === id)) drafts.push({ id: env.id, kind: env.kind, title: env.record.title, status: env.record.status });
  }
  return { published, drafts };
}

// Every working draft and published snapshot (content, site settings and team profiles) that uses an asset.
export function assetUsage(assetId, ctx) {
  const usage = [];
  const add = (kind, recordId, title, where, role) => usage.push({ recordId, kind, title, where, role, label: `${KIND_LABELS[kind] || SITE_KIND_LABELS[kind]} “${title}”`, href: editorHref(kind, recordId) });
  for (const env of ctx.records.values()) {
    for (const ref of assetRefs(env.record)) if (ref.assetId === assetId) add(env.kind, env.id, env.record.title, 'working draft', ref.role);
  }
  for (const pub of ctx.published.values()) {
    for (const ref of assetRefs(pub.snapshot)) if (ref.assetId === assetId) add(pub.kind, pub.id, pub.snapshot.title, 'published snapshot', ref.role);
  }
  for (const env of ctx.siteRecords?.values() || []) {
    for (const ref of siteAssetRefs(env.record)) if (ref.assetId === assetId) add(env.kind, env.id, siteRecordTitle(env.record), 'working draft', ref.role);
  }
  for (const pub of ctx.sitePublished?.values() || []) {
    for (const ref of siteAssetRefs(pub.snapshot)) if (ref.assetId === assetId) add(pub.kind, pub.id, siteRecordTitle(pub.snapshot), 'published snapshot', ref.role);
  }
  return usage;
}

// Working drafts and published snapshots (tours and day trips) that reference a term.
export function taxonomyUsage(termId, ctx) {
  const usage = [];
  for (const env of ctx.records.values()) if (taxonomyRefs(env.record).some(r => r.id === termId)) usage.push({ recordId: env.id, kind: env.kind, title: env.record.title, status: env.record.status, where: 'working draft', href: editorHref(env.kind, env.id) });
  for (const pub of ctx.published.values()) if (taxonomyRefs(pub.snapshot).some(r => r.id === termId)) usage.push({ recordId: pub.id, kind: pub.kind, title: pub.snapshot.title, where: 'published snapshot', href: editorHref(pub.kind, pub.id) });
  return usage;
}

// Duplicate: new id, draft status, fresh nested item ids, no published snapshot or route history.
export function duplicateRecord(record, { id = newId(), now, slug, title }) {
  const copy = structuredClone(record);
  Object.assign(copy, { id, title, slug, status: 'draft', createdAt: now, updatedAt: now, version: 1, schemaVersion: 1 });
  if (copy.kind === 'tour') copy.itinerary = copy.itinerary.map(day => ({ ...day, id: newId() }));
  if (copy.kind === 'dayTrip') copy.schedule = (copy.schedule || []).map(item => ({ ...item, id: newId() }));
  if (copy.kind === 'destination') copy.travelTips = (copy.travelTips || []).map(tip => ({ ...tip, id: newId() }));
  return copy;
}

// Splits legacy paragraph tips into structured tips; the legacy text itself is kept unchanged.
export function convertLegacyTips(legacyText) {
  return String(legacyText || '').split(/\n\s*\n/).map(block => block.trim()).filter(Boolean).map(block => {
    const lines = block.split('\n');
    const first = lines[0].trim();
    const isHeading = lines.length > 1 && first.length <= 80 && !/[.!?]$/.test(first);
    return { id: newId(), title: isHeading ? first.replace(/:$/, '') : '', body: (isHeading ? lines.slice(1).join('\n') : block).trim() };
  });
}
