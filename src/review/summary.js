// Screen summaries computed where the data lives (the server in the shared workspace, the browser in the
// local preview), so screens receive only what they display.
//   dashboard   counts, six-month booking chart, recent bookings, upcoming arrivals, team and report totals
//   cataloguePage / bookingPage / mediaPage   one page of a list, with filtered totals and a cursor
// Booking and quotation data is included only for roles with booking access (administrators and
// reservations); other roles receive zero counts and no rows, as the full lists already did.
import { createBookingsRepository } from '../storage/bookings-repository.js';
import { operations } from '../operations/repository.js';
import { recalc } from '../operations/costs.js';
import { createReviewRepository } from './repository.js';
import { DEFINITIONS } from './model.js';
import { assetUsage } from '../modules/shared/records.js';
import { cataloguePage } from '../modules/shared/list-definitions.js';

export const BOOKING_ROLES = ['admin', 'reservations'];
export const canSeeBookings = actor => !actor?.role || BOOKING_ROLES.includes(actor.role);
const BUSINESS_TIME_ZONE = 'Africa/Dar_es_Salaam';
const DAY = 86400000;

function zone(timeZone) {
  try { new Intl.DateTimeFormat('en-CA', { timeZone }); return timeZone; } catch { return BUSINESS_TIME_ZONE; }
}
// The current month in `timeZone` and the five before it, as YYYY-MM keys (the browser's local months
// before this change; the client sends its own time zone).
export function monthKeys(now, timeZone) {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(now).split('-').map(Number);
  return Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(y, m - 6 + i, 1)).toISOString().slice(0, 7));
}

export function dashboardSummary({ ctx, docs, bookings, quotes, bookingsAllowed = true, timeZone, now = new Date() }) {
  const tz = zone(timeZone || BUSINESS_TIME_ZONE), monthFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' });
  const keys = monthKeys(now, tz), perMonth = new Map(keys.map(k => [k, 0]));
  for (const b of bookings) { const t = Date.parse(b.receivedAt); if (Number.isFinite(t)) { const k = monthFmt.format(new Date(t)); if (perMonth.has(k)) perMonth.set(k, perMonth.get(k) + 1); } }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE }).format(now);
  const arrivals = bookings.filter(b => b.arrivalDate && b.arrivalDate >= today && Date.parse(b.arrivalDate) - Date.parse(today) <= 14 * DAY && b.status !== 'Cancelled').slice(0, 4);
  const values = new Map(); let incomplete = 0;
  for (const q of quotes) { try { const t = recalc(q); values.set(q.currency, (values.get(q.currency) || 0n) + BigInt(t.total.replace('.', ''))); } catch { incomplete++; } }
  return {
    bookings: {
      allowed: bookingsAllowed, total: bookings.length,
      months: keys.map(key => ({ key, count: perMonth.get(key) })),
      recent: bookings.slice(0, 6).map(b => ({ id: b.id, fullName: b.fullName, arrivalDate: b.arrivalDate, guests: b.adults === null || b.kids === null ? null : b.adults + b.kids, status: b.status })),
      arrivals: arrivals.map(b => ({ id: b.id, fullName: b.fullName, arrivalDate: b.arrivalDate }))
    },
    quotations: { total: quotes.length },
    published: ctx.published.size + docs.filter(x => x.published).length,
    drafts: [...ctx.records.values()].filter(x => !ctx.published.has(x.id) && x.record.status !== 'archived').length + docs.filter(x => x.status === 'draft').length,
    team: [...ctx.siteRecords.values()].filter(x => x.kind === 'teamMember' && x.record.status !== 'archived').slice(0, 4).map(x => ({ id: x.id, name: x.record.name, position: x.record.position })),
    report: {
      editorial: Object.entries(DEFINITIONS).filter(([, d]) => !d.private).map(([, d]) => ({ label: d.label, count: docs.filter(e => e.kind === d.kind).length })),
      quoteTotals: [...values].map(([currency, cents]) => [currency, `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`]),
      incompleteQuotes: incomplete
    }
  };
}

// Generic cursor paging over an already ordered array: the cursor is the last row's key fields.
function encode(value) { return (typeof Buffer !== 'undefined' ? Buffer.from(JSON.stringify(value), 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(JSON.stringify(value))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function decode(cursor, fields) {
  if (cursor == null || cursor === '') return null;
  const invalid = () => Object.assign(new Error('Invalid list cursor. Reload the list.'), { status: 400, code: 'validation' });
  if (typeof cursor !== 'string' || cursor.length > 2000 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalid();
  let value;
  try { const b64 = cursor.replace(/-/g, '+').replace(/_/g, '/'); value = JSON.parse(typeof Buffer !== 'undefined' ? Buffer.from(b64, 'base64').toString('utf8') : decodeURIComponent(escape(atob(b64)))); } catch { throw invalid(); }
  if (!value || fields.some(f => typeof value[f] !== 'string')) throw invalid();
  return value;
}
function limitOf(query, fallback, max = 100) {
  const limit = query.limit == null ? fallback : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > max) throw Object.assign(new Error(`Choose a page size from 1 to ${max}.`), { status: 400, code: 'validation' });
  return limit;
}
function pageOf(ordered, after, limit, compareToCursor, cursorOf) {
  const start = after ? ordered.filter(row => compareToCursor(row, after) > 0) : ordered;
  const rows = start.slice(0, limit);
  return { rows, offset: ordered.length - start.length, next: start.length > limit ? encode(cursorOf(rows.at(-1))) : null };
}

// Bookings in the register's order (newest received first, then id).
export function bookingPage(bookings, query = {}) {
  const limit = limitOf(query, 50), q = typeof query.q === 'string' ? query.q.slice(0, 200).toLowerCase() : '';
  const after = decode(query.after, ['receivedAt', 'id']);
  const matching = bookings.filter(b => !q || [b.fullName, b.email, b.phone].join(' ').toLowerCase().includes(q));
  const compare = (b, c) => c.receivedAt.localeCompare(b.receivedAt) || b.id.localeCompare(c.id);
  const page = pageOf(matching, after, limit, compare, b => ({ receivedAt: b.receivedAt, id: b.id }));
  return { total: bookings.length, filtered: matching.length, offset: page.offset, next: page.next,
    rows: page.rows.map(b => ({ id: b.id, fullName: b.fullName, email: b.email, phone: b.phone, receivedAt: b.receivedAt })) };
}

// Media library images, newest first, with where each one is used (only for the images on the page).
export function mediaPage(ctx, query = {}) {
  const limit = limitOf(query, 24, 60), q = typeof query.q === 'string' ? query.q.slice(0, 200).toLowerCase() : '';
  const after = decode(query.after, ['createdAt', 'id']);
  const all = [...ctx.assets.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const matching = all.filter(a => !q || [a.fileName, a.alt, a.credit].join(' ').toLowerCase().includes(q));
  const compare = (a, c) => c.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(c.id);
  const page = pageOf(matching, after, limit, compare, a => ({ createdAt: a.createdAt, id: a.id }));
  return { total: all.length, filtered: matching.length, missing: all.filter(a => !a.hasBlob).length, next: page.next,
    rows: page.rows.map(asset => ({ asset, usage: assetUsage(asset.id, ctx) })) };
}

// Editorial documents of one kind (blog posts, FAQs, pages…) in pages of 12, as the list showed before.
// Search covers the whole working record, as before; ties are broken by id so pages are deterministic.
export const EDITORIAL_PAGE_SIZE = 12;
export function editorialPage(docs, query = {}) {
  const q = typeof query.q === 'string' ? query.q.slice(0, 200).trim().toLowerCase() : '';
  const status = ['all', 'draft', 'published', 'archived'].includes(query.status) ? query.status : 'all';
  const sort = ['updated', 'title', 'order'].includes(query.sort) ? query.sort : 'updated';
  const filtered = docs.filter(e => (status === 'all' || e.status === status) && (!q || JSON.stringify(e.record).toLowerCase().includes(q)));
  const compare = sort === 'title' ? (a, b) => a.record.title.localeCompare(b.record.title) : sort === 'order' ? (a, b) => Number(a.record.order || 0) - Number(b.record.order || 0) : (a, b) => b.updatedAt.localeCompare(a.updatedAt);
  filtered.sort((a, b) => compare(a, b) || a.id.localeCompare(b.id));
  const pages = Math.max(1, Math.ceil(filtered.length / EDITORIAL_PAGE_SIZE));
  const requested = Number.isInteger(query.page) && query.page >= 0 ? query.page : 0, page = Math.min(requested, pages - 1);
  return { total: docs.length, filtered: filtered.length, page, pages,
    rows: filtered.slice(page * EDITORIAL_PAGE_SIZE, (page + 1) * EDITORIAL_PAGE_SIZE).map(e => ({ id: e.id, kind: e.kind, title: e.record.title, status: e.status, updatedAt: e.updatedAt, version: e.version, role: e.record.role })) };
}

export function createSummaryService(ws) {
  const visibleDocs = docs => (ws.actor?.role && ws.actor.role !== 'admin' ? docs.filter(d => d.kind !== 'staff') : docs);
  return {
    async dashboard({ timeZone } = {}) {
      const allowed = canSeeBookings(ws.actor);
      const [ctx, docs, bookings, ops] = await Promise.all([ws.loadContext(), createReviewRepository(ws).list(),
        allowed ? createBookingsRepository(ws).list() : [], allowed ? operations(ws).list() : []]);
      return dashboardSummary({ ctx, docs: visibleDocs(docs), bookings, quotes: ops.filter(x => x.kind === 'quotation'), bookingsAllowed: allowed, timeZone });
    },
    async cataloguePage(kind, query = {}) { return cataloguePage(await ws.loadContext(), kind, query); },
    async bookingPage(query = {}) {
      if (!canSeeBookings(ws.actor)) return { total: 0, filtered: 0, offset: 0, next: null, rows: [], restricted: true };
      return bookingPage(await createBookingsRepository(ws).list(), query);
    },
    async mediaPage(query = {}) { return mediaPage(await ws.loadContext(), query); },
    async editorialPage(key, query = {}) { return editorialPage(visibleDocs(await createReviewRepository(ws).list(key)), query); }
  };
}
