// Display helpers. Timestamps are stored as ISO UTC and shown in Africa/Dar_es_Salaam (EAT).
export const DISPLAY_TIME_ZONE = 'Africa/Dar_es_Salaam';

const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: DISPLAY_TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

export function nowIso() { return new Date().toISOString(); }
export function newId() { return crypto.randomUUID(); }

export function formatDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Invalid date' : `${dateTimeFormat.format(date)} EAT`;
}

export function formatTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : `${timeFormat.format(date)} EAT`;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Splits plain text into paragraphs on blank lines. Callers render each with textContent.
export function paragraphs(text) {
  return String(text || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
}

export function truncateWords(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:]+$/, '')}…`;
}

export function plural(count, one, many = pluralNoun(one)) { return `${count} ${count === 1 ? one : many}`; }

// activity → activities, amenity → amenities, day → days, destination → destinations
export function pluralNoun(noun) { return /[^aeiou]y$/i.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`; }

export function shortId(id) { return String(id || '').slice(0, 8); }
