// Site settings singleton, team profiles and the team lineup: record factories, form conversion, media
// references and the rules that decide what the local team page shows. Shared by the UI and the repositories.
//
// Publication model (proposed, not a confirmed CMS rule):
// - Profile content (name, position, biography, portrait, links) is published per profile.
// - Display order and visibility live in ONE separate record, the team lineup, with its own draft and
//   published snapshot. "Publish order & visibility" publishes only the lineup; it never publishes profile
//   content, and publishing a profile never publishes the lineup.
// - The local team page shows published lineup entries that are visible AND have a published profile
//   snapshot, in published lineup order, rendered from the published snapshots.
import { newId } from './format.js';

export const SETTINGS_ID = 'site-settings';
export const LINEUP_ID = 'team-lineup';
export const SITE_KINDS = Object.freeze(['siteSettings', 'teamMember', 'teamLineup']);
export const SITE_KIND_LABELS = Object.freeze({ siteSettings: 'Site settings', teamMember: 'Team profile', teamLineup: 'Team order & visibility' });
export const DEFAULT_TIME_ZONE = 'Africa/Dar_es_Salaam';

// Suggestions only; any other named network can be typed in without code changes.
export const SOCIAL_NETWORK_SUGGESTIONS = Object.freeze(['Facebook', 'Instagram', 'TikTok']);

// Trusted logos shipped with the CMS, referenced by key (never by a user-supplied path). They are static
// files, not uploads, so the media library's SVG upload rejection is unchanged.
export const BUNDLED_LOGOS = Object.freeze({
  'vion-logo-dark-artwork': Object.freeze({
    src: 'assets/logo-dark.svg', label: 'Bundled Vion Africa Travel logo (assets/logo-dark.svg)',
    note: 'dark wordmark with an orange mark, suitable for light backgrounds only', backgrounds: ['light'], defaultAlt: 'Vion Africa Travel'
  })
});

export function newSettings({ now = new Date().toISOString() } = {}) {
  return {
    id: SETTINGS_ID, kind: 'siteSettings', status: 'draft', createdAt: now, updatedAt: now, version: 1, schemaVersion: 1,
    company: { name: '', tagline: '', footerDescription: '', officeAddress: '', timezone: DEFAULT_TIME_ZONE, areasServed: [] },
    contact: { primaryPhone: '', emergencyPhone: '', email: '', phoneSupportNote: '', emailResponseNote: '', mapsUrl: '' },
    branding: { logoLight: null, logoDark: null, shareImage: null, shareImageUsesLogo: false },
    social: [],
    reviews: [],
    seo: { siteName: '', titleSuffix: '', defaultDescription: '' }
  };
}

export function newMember({ id = newId(), now = new Date().toISOString(), name = '' } = {}) {
  return { id, kind: 'teamMember', name, status: 'draft', createdAt: now, updatedAt: now, version: 1, schemaVersion: 1, position: '', bio: '', portrait: null, links: [] };
}

export function newLineup({ now = new Date().toISOString() } = {}) {
  return { id: LINEUP_ID, kind: 'teamLineup', status: 'draft', createdAt: now, updatedAt: now, version: 1, schemaVersion: 1, entries: [] };
}

// Site envelopes have no routes, so their workflow has no route fields. priorVisible remembers a profile's
// lineup visibility while it is archived.
export function newSiteWorkflow() {
  return { priorStatus: null, publishedRevision: 0, lastPublishedAt: null, publishedSourceVersion: null, archivedAt: null, priorVisible: null };
}

export const newSocialProfile = (network = '') => ({ id: newId(), network, url: '', visible: true });
export const newReviewLink = () => ({ id: newId(), platform: '', url: '', description: '', buttonLabel: '', visible: true });
export const newMemberLink = () => ({ id: newId(), label: '', url: '' });

const line = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const block = value => String(value ?? '').replace(/\r\n?/g, '\n').trim();
const cleanList = list => {
  const out = [];
  for (const item of list || []) {
    const value = line(item);
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
};
const cleanPlacement = p => (p?.assetId ? { assetId: p.assetId, alt: line(p.alt) } : null);
function cleanLogo(logo) {
  if (!logo) return null;
  if (logo.source === 'bundled') return { source: 'bundled', key: logo.key, alt: line(logo.alt) };
  return logo.assetId ? { source: 'asset', assetId: logo.assetId, alt: line(logo.alt) } : null;
}

export function settingsToForm(record) {
  const base = newSettings({ now: record.createdAt });
  const form = structuredClone(record);
  for (const key of ['company', 'contact', 'branding', 'seo']) form[key] = { ...base[key], ...(form[key] || {}) };
  form.social = form.social || [];
  form.reviews = form.reviews || [];
  return form;
}

// Single-line values are whitespace-collapsed; addresses, descriptions and notes keep their line breaks.
export function formToSettings(form) {
  const record = structuredClone(form);
  const c = form.company;
  record.company = {
    name: line(c.name), tagline: line(c.tagline), footerDescription: block(c.footerDescription), officeAddress: block(c.officeAddress),
    timezone: line(c.timezone), areasServed: cleanList(c.areasServed)
  };
  const k = form.contact;
  record.contact = {
    primaryPhone: line(k.primaryPhone), emergencyPhone: line(k.emergencyPhone), email: line(k.email),
    phoneSupportNote: block(k.phoneSupportNote), emailResponseNote: block(k.emailResponseNote), mapsUrl: line(k.mapsUrl)
  };
  record.branding = {
    logoLight: cleanLogo(form.branding.logoLight), logoDark: cleanLogo(form.branding.logoDark),
    shareImage: cleanPlacement(form.branding.shareImage), shareImageUsesLogo: !!form.branding.shareImageUsesLogo
  };
  record.social = (form.social || []).map(s => ({ id: s.id, network: line(s.network), url: line(s.url), visible: s.visible !== false }));
  record.reviews = (form.reviews || []).map(r => ({ id: r.id, platform: line(r.platform), url: line(r.url), description: block(r.description), buttonLabel: line(r.buttonLabel), visible: r.visible !== false }));
  record.seo = { siteName: line(form.seo.siteName), titleSuffix: line(form.seo.titleSuffix), defaultDescription: block(form.seo.defaultDescription) };
  return { record, issues: [] };
}

// The form carries the profile's draft placement (visibility + 1-based position) next to its content. The
// placement is saved into the draft lineup, never into the profile record.
export function memberToForm(record, placement) {
  const form = structuredClone(record);
  form.links = form.links || [];
  form.placement = { visible: placement.visible !== false, position: String(placement.position) };
  return form;
}

export function formToMember(form) {
  const { placement, ...rest } = structuredClone(form);
  const record = {
    ...rest, name: line(rest.name), position: line(rest.position), bio: block(rest.bio), portrait: cleanPlacement(rest.portrait),
    links: (rest.links || []).map(l => ({ id: l.id, label: line(l.label), url: line(l.url) }))
  };
  const position = Number.parseInt(placement?.position, 10);
  return { record, issues: [], extra: { placement: { visible: placement?.visible !== false, position: Number.isInteger(position) && position > 0 ? position : null } } };
}

export const siteRecordTitle = record => (record.kind === 'teamMember' ? record.name || 'Untitled profile' : SITE_KIND_LABELS[record.kind] || record.kind);

// Media references held by settings (logos, sharing image) and profiles (portrait).
export function siteAssetRefs(record) {
  const refs = [];
  if (record.kind === 'siteSettings') {
    for (const [key, role] of [['logoLight', 'light-background logo'], ['logoDark', 'dark-background logo']]) {
      const logo = record.branding?.[key];
      if (logo?.source === 'asset' && logo.assetId) refs.push({ path: `branding.${key}`, assetId: logo.assetId, role });
    }
    if (record.branding?.shareImage?.assetId) refs.push({ path: 'branding.shareImage', assetId: record.branding.shareImage.assetId, role: 'default sharing image' });
  }
  if (record.kind === 'teamMember' && record.portrait?.assetId) refs.push({ path: 'portrait', assetId: record.portrait.assetId, role: 'portrait' });
  return refs;
}

export function editorHref(kind, id) {
  if (kind === 'siteSettings') return '#/settings';
  if (kind === 'teamMember') return `#/team/${id}`;
  if (kind === 'teamLineup') return '#/team';
  return `#/${kind}s/${id}`;
}

// ---- lineup (display order + visibility) ----
// Pure helpers: each returns a new entries array.
export function removeEntry(entries, memberId) { return entries.filter(e => e.memberId !== memberId); }

// Places a profile at a 1-based position (clamped; null keeps its place or appends) with the given visibility.
export function placeEntry(entries, memberId, { position = null, visible } = {}) {
  const index = entries.findIndex(e => e.memberId === memberId);
  const current = index === -1 ? null : entries[index];
  const entry = { memberId, visible: visible ?? current?.visible ?? true };
  const rest = removeEntry(entries, memberId);
  const target = position == null ? (index === -1 ? rest.length : index) : Math.min(Math.max(position - 1, 0), rest.length);
  return [...rest.slice(0, target), entry, ...rest.slice(target)];
}

export function moveEntry(entries, memberId, delta) {
  const index = entries.findIndex(e => e.memberId === memberId);
  const to = index + delta;
  if (index === -1 || to < 0 || to >= entries.length) return null;
  const next = entries.slice();
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

export const draftLineup = ctx => ctx.siteRecords.get(LINEUP_ID) || null;
export const publishedLineup = ctx => ctx.sitePublished.get(LINEUP_ID)?.snapshot || null;
export const lineupHasUnpublishedChanges = env => !!env && (env.record.status !== 'published' || env.workflow.publishedSourceVersion !== env.record.version);

// True when the draft team order or any published profile has changes that are not published yet.
export function hasDraftChanges(ctx) {
  if (lineupHasUnpublishedChanges(draftLineup(ctx))) return true;
  return [...ctx.siteRecords.values()].some(env => env.kind === 'teamMember' && env.record.status === 'published' && env.workflow.publishedSourceVersion !== env.record.version);
}

// Published snapshots shown on the local team page, in published display order.
export function publishedTeam(ctx) {
  const out = [];
  for (const entry of publishedLineup(ctx)?.entries || []) {
    const pub = ctx.sitePublished.get(entry.memberId);
    if (entry.visible && pub?.kind === 'teamMember') out.push(pub);
  }
  return out;
}

// Draft team page: draft lineup order with working drafts, flagged where they would not appear when published.
export function draftTeam(ctx) {
  return (draftLineup(ctx)?.record.entries || []).map((entry, index) => ({ ...entry, position: index + 1, env: ctx.siteRecords.get(entry.memberId) || null, published: ctx.sitePublished.has(entry.memberId) }));
}

export function teamPageStatus(memberId, ctx) {
  const draft = draftLineup(ctx)?.record.entries || [];
  const published = publishedLineup(ctx)?.entries || [];
  const di = draft.findIndex(e => e.memberId === memberId);
  const pi = published.findIndex(e => e.memberId === memberId);
  const status = ctx.siteRecords.get(memberId)?.record.status;
  const pagePosition = publishedTeam(ctx).findIndex(p => p.id === memberId);
  let reason;
  if (status === 'archived') reason = 'Archived — not on the team page.';
  else if (!ctx.sitePublished.has(memberId)) reason = 'Not shown: the profile is not published.';
  else if (pi === -1) reason = 'Not shown yet: the profile is published but is not in the published team order. Use “Publish order & visibility” on the Team list.';
  else if (!published[pi].visible) reason = 'Not shown: hidden in the published team order.';
  else reason = `Shown on the local team page at position ${pagePosition + 1}.`;
  return {
    onPage: pagePosition !== -1, reason, pagePosition: pagePosition === -1 ? null : pagePosition + 1,
    draftPosition: di === -1 ? null : di + 1, draftVisible: di === -1 ? null : draft[di].visible,
    publishedVisible: pi === -1 ? null : published[pi].visible
  };
}
