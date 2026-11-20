// List definitions for the catalogue modules, shared by the browser and the server (no DOM here).
// Columns, search text, status filters and sorts are defined once; module definitions and the list view
// import them, and the server computes paginated list pages from the same rules.
//
// Paging uses a cursor that carries the last row's sort fields, not an offset: every sort ends with
// title then id, so the order is total, and the next page starts strictly after the cursor row even if
// rows were added, removed or edited between requests (no duplicates; a row that moved may move pages).
import { hasUnpublishedChanges, publicName, compareOptionalNumber } from './records.js';
import { routeFor } from './routes.js';
import { comparePricing, describePrice } from './pricing.js';
import { compareDayTrips, formatDuration } from './day-trips.js';

export const STATUS_FILTERS = {
  active: { label: 'Active (draft + published)', test: env => env.record.status !== 'archived' },
  draft: { label: 'Drafts', test: env => env.record.status === 'draft' },
  published: { label: 'Published', test: env => env.record.status === 'published' },
  changes: { label: 'Published with unpublished changes', test: hasUnpublishedChanges },
  archived: { label: 'Archived', test: env => env.record.status === 'archived' },
  all: { label: 'All records', test: () => true }
};

export const byTitle = (a, b) => a.record.title.localeCompare(b.record.title, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id);
export const BASE_SORTS = {
  updated: { label: 'Last updated', compare: (a, b) => b.record.updatedAt.localeCompare(a.record.updatedAt) },
  title: { label: 'Title A–Z', compare: () => 0 }
};

const destinationTitle = (id, ctx) => ctx.records.get(id)?.record.title || 'Missing';
const termLabels = (ids, ctx) => ids.map(id => ctx.taxonomies.get(id)?.label || 'Unresolved value').join(', ');
const price = { label: 'Price (missing last)', compare: (a, b) => comparePricing(a.record.pricing, b.record.pricing) };

export const LIST_DEFINITIONS = {
  destination: {
    columns: [
      { label: 'Images', cell: env => String((env.record.cover ? 1 : 0) + (env.record.gallery?.length || 0)) },
      { label: 'Order', cell: env => (env.record.order ?? '—').toString() }
    ],
    sorts: { order: { label: 'Manual order', compare: compareOptionalNumber('order') } },
    searchText: env => [env.record.title, env.record.displayName, env.record.internalName, env.record.slug].join(' ')
  },
  accommodation: {
    columns: [
      {
        label: 'Destination',
        cell: (env, ctx) => {
          const id = env.record.destinationId;
          if (!id) return env.record.locationName || (env.record.noDestinationReason ? 'None (reason given)' : 'None');
          const dest = ctx.records.get(id);
          return dest ? `${dest.record.title}${ctx.published.has(id) ? '' : dest.record.status === 'archived' ? ' (archived)' : ' (draft)'}` : 'Missing record';
        }
      },
      { label: 'Type · standard', cell: env => [env.record.type, env.record.standard].filter(Boolean).join(' · ') || '—' },
      { label: 'Public page', cell: env => (env.record.publicPageEnabled === false ? 'Disabled' : 'Enabled') }
    ],
    sorts: {},
    searchText: env => [env.record.title, env.record.slug, env.record.type, env.record.standard].join(' ')
  },
  tour: {
    columns: [
      { label: 'Duration', cell: env => (env.record.durationDays ? `${env.record.durationDays} d` : '—') },
      { label: 'Destinations', cell: (env, ctx) => env.record.destinationIds.map(id => destinationTitle(id, ctx)).join(', ') || '—' },
      { label: 'Price', cell: env => describePrice(env.record.pricing).text },
      { label: 'Featured', cell: env => (env.record.featured ? 'Yes' : '') }
    ],
    sorts: { price, rank: { label: 'Recommended rank', compare: compareOptionalNumber('recommendedRank') } },
    searchText: env => [env.record.title, env.record.slug, env.record.summary].join(' ')
  },
  dayTrip: {
    columns: [
      { label: 'Duration', cell: env => formatDuration(env.record.duration) || '—' },
      { label: 'Destinations', cell: (env, ctx) => env.record.destinationIds.map(id => destinationTitle(id, ctx)).join(', ') || '—' },
      { label: 'Tags', cell: (env, ctx) => termLabels(env.record.tagIds, ctx) || '—' },
      { label: 'Price', cell: env => describePrice(env.record.pricing).text },
      { label: 'Featured / order', cell: env => [env.record.featured ? 'Featured' : '', env.record.displayOrder ?? ''].filter(v => v !== '').join(' · ') || '—' }
    ],
    sorts: { order: { label: 'Featured, then display order', compare: (a, b) => compareDayTrips(a.record, b.record) }, price },
    searchText: env => [env.record.title, env.record.slug, env.record.summary].join(' ')
  }
};

export const sortsFor = kind => ({ ...BASE_SORTS, ...(LIST_DEFINITIONS[kind]?.sorts || {}) });
export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 100;
// Fields any sort reads; the cursor carries only these.
const CURSOR_FIELDS = ['title', 'updatedAt', 'order', 'recommendedRank', 'pricing', 'featured', 'displayOrder'];

const base64url = {
  encode: text => (typeof Buffer !== 'undefined' ? Buffer.from(text, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(text)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: text => { const b64 = text.replace(/-/g, '+').replace(/_/g, '/'); return typeof Buffer !== 'undefined' ? Buffer.from(b64, 'base64').toString('utf8') : decodeURIComponent(escape(atob(b64))); }
};
export function encodeCursor(env) {
  const record = { id: env.id };
  for (const key of CURSOR_FIELDS) if (env.record[key] !== undefined) record[key] = env.record[key];
  return base64url.encode(JSON.stringify({ id: env.id, record }));
}
export function decodeCursor(cursor) {
  if (cursor == null || cursor === '') return null;
  const invalid = () => Object.assign(new Error('Invalid list cursor. Reload the list.'), { status: 400, code: 'validation' });
  if (typeof cursor !== 'string' || cursor.length > 4000 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalid();
  let value;
  try { value = JSON.parse(base64url.decode(cursor)); } catch { throw invalid(); }
  if (!value || typeof value.id !== 'string' || typeof value.record?.title !== 'string' || typeof value.record?.updatedAt !== 'string') throw invalid();
  return { id: value.id, record: { ...value.record, id: value.id } };
}

export function normalizeListQuery(kind, query = {}) {
  const sorts = sortsFor(kind);
  const limit = query.limit == null ? DEFAULT_LIST_LIMIT : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) throw Object.assign(new Error(`Choose a page size from 1 to ${MAX_LIST_LIMIT}.`), { status: 400, code: 'validation' });
  return {
    q: typeof query.q === 'string' ? query.q.slice(0, 200) : '',
    status: STATUS_FILTERS[query.status] ? query.status : 'active',
    sort: sorts[query.sort] ? query.sort : 'updated',
    after: query.after || null,
    limit
  };
}

// One page of a catalogue list with display-ready cells (strings), plus the filtered total and the
// per-status counts over every record of the kind, so the visible totals match the previous screen.
export function cataloguePage(ctx, kind, query = {}) {
  const def = LIST_DEFINITIONS[kind];
  if (!def) throw Object.assign(new Error('Unsupported list.'), { status: 400, code: 'validation' });
  const { q, status, sort, after, limit } = normalizeListQuery(kind, query);
  const compare = (a, b) => sortsFor(kind)[sort].compare(a, b) || byTitle(a, b);
  const all = [...ctx.records.values()].filter(env => env.kind === kind);
  const counts = { published: 0, draft: 0, archived: 0 };
  for (const env of all) counts[env.record.status] = (counts[env.record.status] || 0) + 1;
  const term = q.trim().toLowerCase();
  const matching = all.filter(STATUS_FILTERS[status].test).filter(env => !term || def.searchText(env).toLowerCase().includes(term)).sort(compare);
  const cursor = decodeCursor(after);
  const start = cursor ? matching.filter(env => compare(env, cursor) > 0) : matching;
  const page = start.slice(0, limit);
  return {
    kind, query: { q, status, sort, limit },
    total: all.length, filtered: matching.length, counts,
    rows: page.map(env => ({
      id: env.id, kind: env.kind,
      title: env.record.title, slug: env.record.slug || '', route: routeFor(env.kind, env.record.slug) || '',
      publicName: kind === 'destination' && publicName(env.record) !== env.record.title ? publicName(env.record) : null,
      status: env.record.status, unpublishedChanges: hasUnpublishedChanges(env),
      version: env.record.version, updatedAt: env.record.updatedAt,
      cells: def.columns.map(c => String(c.cell(env, ctx)))
    })),
    next: start.length > limit ? encodeCursor(page.at(-1)) : null
  };
}
