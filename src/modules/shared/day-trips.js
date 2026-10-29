// Day-trip rules shared by the editor, validation, previews and the local listing. All of it is proposed
// replacement behaviour, not a confirmed rule of the existing CMS.
import { newId } from './format.js';
import { TAXONOMY_PUBLICATION_ID } from './taxonomy.js';

export const DURATION_UNITS = Object.freeze({ hours: 'hours', days: 'days' });
// Sanity limits for an optional duration (prototype assumption, not a business rule): more than zero, at most
// two decimal places, up to 24 hours or 7 days. A day trip is not a multi-day itinerary, so the schedule is
// never required to match the duration.
export const DURATION_LIMITS = Object.freeze({ hours: 24, days: 7 });
export const DURATION_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;

export const DEFAULTS_ID = 'day-trip-defaults';
export const DAY_TRIP_LISTING_ROUTE = '/tours/day-trips';
export const TAG_FILTER = 'tag';

export const newScheduleItem = () => ({ id: newId(), heading: '', description: '' });

export function newDayTripDefaults({ now = new Date().toISOString() } = {}) {
  return { id: DEFAULTS_ID, kind: 'dayTripDefaults', inclusions: [], whatToBring: [], createdAt: now, updatedAt: now, version: 1, schemaVersion: 1 };
}

// Form text → stored duration. Blank value means no duration (the unit is then ignored).
export function parseDuration(form) {
  const raw = String(form?.value ?? '').trim();
  if (!raw) return { duration: null, issues: [] };
  if (!DURATION_PATTERN.test(raw)) {
    return { duration: undefined, issues: [{ path: 'duration.value', severity: 'error', message: 'Enter the duration as a number using digits and an optional decimal point (for example 4 or 1.5), or leave it empty.' }] };
  }
  return { duration: { value: Number(raw), unit: form.unit }, issues: [] };
}

export function durationIssues(duration) {
  if (duration == null) return [];
  const issues = [];
  const error = (path, message) => issues.push({ path, message, severity: 'error' });
  if (!(duration.unit in DURATION_UNITS)) error('duration.unit', 'Choose hours or days for the duration.');
  const value = duration.value;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) error('duration.value', 'The duration must be more than zero. Leave it empty if it is not known.');
  else if (Math.round(value * 100) !== value * 100) error('duration.value', 'Use at most two decimal places for the duration.');
  else if (duration.unit in DURATION_LIMITS && value > DURATION_LIMITS[duration.unit]) error('duration.value', `A day-trip duration of more than ${DURATION_LIMITS[duration.unit]} ${duration.unit} is not accepted in this prototype. Check the value and unit.`);
  return issues;
}

export function formatDuration(duration) {
  if (!duration || !(duration.unit in DURATION_UNITS) || !(duration.value > 0)) return null;
  const singular = duration.value === 1;
  return `${duration.value} ${duration.unit === 'hours' ? (singular ? 'hour' : 'hours') : singular ? 'day' : 'days'}`;
}

const sameText = value => String(value).replace(/\s+/g, ' ').trim();

// Copies the defaults into a draft's lists. mode "replace" swaps the lists for the defaults; mode "merge" adds
// default entries that are not already listed. Returns new arrays; the defaults and other records are untouched.
export function copyDefaults(lists, defaults, mode = 'replace') {
  const out = {};
  const added = {};
  for (const key of ['inclusions', 'whatToBring']) {
    const source = (defaults?.[key] || []).map(sameText).filter(Boolean);
    const current = (lists[key] || []).slice();
    if (mode === 'replace') { out[key] = [...source]; added[key] = source.length; continue; }
    const present = new Set(current.map(sameText));
    const extra = source.filter(item => !present.has(item));
    out[key] = [...current, ...extra];
    added[key] = extra.length;
  }
  return { lists: out, added };
}

// Local listing order: featured first, then display order (missing last; 0 is a real value), then title.
export function compareDayTrips(a, b) {
  const x = a.displayOrder;
  const y = b.displayOrder;
  return Number(!!b.featured) - Number(!!a.featured)
    || (x == null || y == null ? (x == null) - (y == null) : x - y)
    || a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id);
}

// The observed public filter contract is /tours/day-trips?filter=tag&value=<value>. Locally the value is the
// tag's stable key in the PUBLISHED taxonomy (the production value format is unconfirmed). Returns the trips
// to show and a readable status:
//   all            — no filter requested
//   filtered       — a known published tag (inactive tags still match: records keep displaying them)
//   invalid-filter — filter missing/unknown or value missing; nothing is filtered and the reason is given
//   unknown-value  — no published tag has that key; no trips are shown
export function filterDayTrips(trips, params, publication) {
  const filter = params?.get?.('filter');
  const value = params?.get?.('value');
  if (filter == null && value == null) return { status: 'all', tag: null, items: trips, message: null };
  if (filter !== TAG_FILTER) {
    return { status: 'invalid-filter', tag: null, items: trips, message: filter ? `The filter “${filter}” is not supported; only filter=tag is. Showing all day trips.` : 'A filter value was given without filter=tag. Showing all day trips.' };
  }
  const wanted = String(value ?? '').trim().toLowerCase();
  if (!wanted) return { status: 'invalid-filter', tag: null, items: trips, message: 'The tag filter has no value. Showing all day trips.' };
  const tag = publication?.id === TAXONOMY_PUBLICATION_ID ? publication.terms.find(t => t.namespace === 'tag' && t.key === wanted) : null;
  if (!tag) return { status: 'unknown-value', tag: null, items: [], message: `No published tag has the key “${wanted}”.` };
  return { status: 'filtered', tag, items: trips.filter(trip => (trip.tagIds || []).includes(tag.id)), message: null };
}
