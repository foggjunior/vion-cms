// Public field allowlists for the publication feed (`cms_public` and /api/public/*).
//
// A field reaches the public website only when it is listed in PUBLIC_FIELDS. Everything else is
// withheld, including fields added to a schema or editor later. server/tests/public-projection.test.mjs
// fails for any schema or editorial field that is neither public nor listed in WITHHELD_FIELDS, so every
// new field needs an explicit decision before it can be published.
//
// Conditional fields are handled in code, not by the lists:
//   - accommodation.publicPhone is public only when publicPhoneVisible === true.
//   - accommodation.publicPageEnabled === false removes the detail page entirely; a tour that names the
//     stay receives a minimal ACCOMMODATION_SUMMARY_FIELDS summary instead (see publication.mjs).
//   - Site settings social/review links and team lineup entries are public only when visible.

const CATALOGUE_BASE = ['id', 'kind', 'title', 'slug', 'createdAt', 'updatedAt', 'seo', 'cover', 'gallery'];
const WORKFLOW = ['status', 'version', 'schemaVersion'];

export const PUBLIC_FIELDS = Object.freeze({
  destination: [...CATALOGUE_BASE, 'destinationType', 'displayName', 'overview', 'highlights', 'signatureExperiences',
    'wildlife', 'activities', 'bestTime', 'legacyTravelTips', 'travelTips', 'order', 'featured'],
  accommodation: [...CATALOGUE_BASE, 'destinationId', 'locationName', 'type', 'standard', 'setting', 'description',
    'amenities', 'activities', 'website'],
  tour: [...CATALOGUE_BASE, 'summary', 'overview', 'durationDays', 'destinationIds', 'typeId', 'typeIds', 'categoryId', 'standardId',
    'tagIds', 'itinerary', 'inclusions', 'exclusions', 'featured', 'recommendedRank', 'pricing', 'publicRates'],
  dayTrip: [...CATALOGUE_BASE, 'summary', 'overview', 'destinationIds', 'tagIds', 'duration', 'schedule', 'inclusions',
    'exclusions', 'whatToBring', 'featured', 'displayOrder', 'pricing'],

  blog: ['id', 'kind', 'title', 'subtitle', 'slug', 'categoryId', 'topics', 'publishDate', 'body', 'excerpt',
    'coverAssetId', 'imageAlt', 'gallery', 'author', 'seoTitle', 'seoDescription'],
  blogCategory: ['id', 'kind', 'title', 'description', 'order'],
  migration: ['id', 'kind', 'title', 'slug', 'months', 'area', 'body', 'whatHappens', 'safariExperience', 'guideNotes',
    'latitude', 'longitude', 'coverAssetId', 'imageAlt', 'order'],
  impact: ['id', 'kind', 'title', 'subtitle', 'slug', 'programme', 'excerpt', 'body', 'publishDate', 'coverAssetId',
    'imageAlt', 'seoTitle', 'seoDescription'],
  foundation: ['id', 'kind', 'title', 'subtitle', 'slug', 'excerpt', 'body', 'impactId', 'mission', 'programmes',
    'website', 'coverAssetId', 'imageAlt', 'seoTitle', 'seoDescription'],
  faq: ['id', 'kind', 'title', 'body', 'placements', 'order'],
  experience: ['id', 'kind', 'title', 'slug', 'excerpt', 'body', 'location', 'format', 'pace', 'seasons', 'sections',
    'inclusions', 'exclusions', 'whatToBring', 'coverAssetId', 'imageAlt', 'seoTitle', 'seoDescription'],
  page: ['id', 'kind', 'title', 'path', 'excerpt', 'sections', 'coverAssetId', 'imageAlt', 'seoTitle', 'seoDescription',
    'noindex'],
  menu: ['id', 'kind', 'title', 'placement', 'links', 'order'],

  siteSettings: ['id', 'kind', 'updatedAt', 'company', 'contact', 'branding', 'social', 'reviews', 'seo'],
  teamMember: ['id', 'kind', 'updatedAt', 'name', 'position', 'bio', 'portrait'],
  teamLineup: ['id', 'kind', 'updatedAt', 'entries'],
});

// Deliberately withheld: staff-only values, workflow metadata and conditional fields handled in code.
export const WITHHELD_FIELDS = Object.freeze({
  destination: ['internalName', ...WORKFLOW],
  accommodation: ['publicPhone', 'publicPhoneVisible', 'publicPageEnabled', 'noDestinationReason', 'mapLink', 'featured', ...WORKFLOW],
  tour: WORKFLOW,
  dayTrip: WORKFLOW,
  siteSettings: WORKFLOW.concat('createdAt'),
  teamMember: WORKFLOW.concat('createdAt', 'links'),
  teamLineup: WORKFLOW.concat('createdAt'),
});

// The only fields a tour may carry about a stay whose own public page is disabled.
export const ACCOMMODATION_SUMMARY_FIELDS = Object.freeze(['id', 'kind', 'title', 'destinationId', 'locationName', 'type',
  'standard', 'setting', 'amenities', 'cover']);

export const TAXONOMY_TERM_FIELDS = Object.freeze(['id', 'namespace', 'label', 'key', 'order', 'active']);

export function pick(record, fields) {
  const out = {};
  for (const key of fields) if (record && Object.hasOwn(record, key) && record[key] !== undefined) out[key] = record[key];
  return out;
}

export function publicRecord(kind, record) {
  const fields = PUBLIC_FIELDS[kind];
  if (!fields || !record) return null;
  const out = pick(record, fields);
  if (kind === 'accommodation' && record.publicPhoneVisible === true && typeof record.publicPhone === 'string' && record.publicPhone.trim()) {
    out.publicPhone = record.publicPhone.trim();
  }
  if (kind === 'siteSettings') {
    out.social = (record.social || []).filter(item => item?.visible === true);
    out.reviews = (record.reviews || []).filter(item => item?.visible === true);
  }
  if (kind === 'teamLineup') out.entries = (record.entries || []).filter(entry => entry?.visible === true);
  return out;
}

export function accommodationSummary(record) {
  return { ...pick(record, ACCOMMODATION_SUMMARY_FIELDS), kind: 'accommodation', publicPage: false };
}

export function publicTaxonomy(publication) {
  return {
    id: publication.id,
    revision: publication.revision,
    publishedAt: publication.publishedAt,
    terms: (publication.terms || []).map(term => pick(term, TAXONOMY_TERM_FIELDS)),
  };
}

const MEDIA_FIELDS = ['id', 'url', 'alt', 'width', 'height'];

// Read-time guard for documents already stored in cms_public. Documents written before the allowlist
// existed can still hold withheld fields or a disabled accommodation page; the public API applies this
// so a deploy closes those leaks before the stored projection is reconciled. Returns null for anything
// that must not be served. It is idempotent on documents written by the current projector.
export function sanitizePublished(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.redirect === 'string') return { path: value.path, redirect: value.redirect, status: 308 };
  const { path, kind, id, data } = value;
  if (!data || typeof data !== 'object') return null;
  const wrap = clean => (clean ? { path, kind, ...(id === undefined ? {} : { id }), data: clean } : null);
  if (kind === 'media') return wrap(pick(data, MEDIA_FIELDS));
  if (kind === 'taxonomies') return wrap(publicTaxonomy(data));
  if (!PUBLIC_FIELDS[kind]) return null;
  if (kind === 'accommodation') {
    if (data.publicPageEnabled === false) return null;
    const clean = pick(data, PUBLIC_FIELDS.accommodation);
    // Current documents only contain publicPhone when it is visible; older ones carry the flag.
    if (data.publicPhoneVisible !== false && typeof data.publicPhone === 'string' && data.publicPhone.trim()) clean.publicPhone = data.publicPhone.trim();
    return wrap(clean);
  }
  const clean = publicRecord(kind, data);
  if (kind === 'tour' && Array.isArray(data.accommodationSummaries)) {
    clean.accommodationSummaries = data.accommodationSummaries.map(stay => ({ ...pick(stay, ACCOMMODATION_SUMMARY_FIELDS), kind: 'accommodation', publicPage: false }));
  }
  return wrap(clean);
}
