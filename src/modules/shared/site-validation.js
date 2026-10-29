// Draft and publication validation for the site settings, team profiles and the team lineup.
// Drafts may be incomplete, but every supplied value must be valid. Publication adds the proposed
// minimums below; they are replacement rules for this prototype, not confirmed current-CMS requirements.
import { SEO_DESCRIPTION_ADVICE, phoneMessage } from './validation.js';
import { BUNDLED_LOGOS, LINEUP_ID } from './site.js';
import { shortId } from './format.js';

export const BIO_ADVICE = 600;
export const SITE_NAME_ADVICE = 60;

const error = (path, message) => ({ path, message, severity: 'error' });
const warning = (path, message) => ({ path, message, severity: 'warning' });
const blank = value => !String(value ?? '').trim();
const get = (obj, path) => path.split('.').reduce((v, k) => v?.[k], obj);

// External profiles, review platforms, maps and team links must be https://. javascript:, data:, http:
// and every other scheme are rejected.
export function httpsUrlMessage(value) {
  let url;
  try { url = new URL(value); } catch { return 'Enter a full web address starting with https:// (for example https://www.example.com/page).'; }
  if (url.protocol === 'http:') return 'Use a secure https:// address; http:// links are not accepted here.';
  if (url.protocol !== 'https:') return `Only https:// links are allowed; “${url.protocol}” links are rejected for safety.`;
  if (url.username || url.password) return 'Remove the user name or password from the link.';
  if (!url.hostname.includes('.')) return 'Enter a public web address with a full domain name (for example https://www.example.com).';
  if (/\s/.test(value)) return 'Remove spaces from the web address.';
  return null;
}

const GOOGLE_HOST = /^(www\.)?google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;
const GOOGLE_MAPS_HOST = /^maps\.google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;
export function mapsUrlMessage(value) {
  const base = httpsUrlMessage(value);
  if (base) return base;
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const ok = host === 'maps.app.goo.gl' || GOOGLE_MAPS_HOST.test(host) || ((host === 'goo.gl' || GOOGLE_HOST.test(host)) && url.pathname.startsWith('/maps'));
  return ok ? null : 'Use a Google Maps link, for example https://maps.app.goo.gl/… or https://www.google.com/maps/….';
}

// Conservative public-address subset: no display names, spaces, quotes or characters that change a mailto: link.
const EMAIL = /^[A-Za-z0-9_+-]+(?:\.[A-Za-z0-9_+-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
export function emailMessage(value) {
  return value.length <= 254 && EMAIL.test(value) ? null : 'Enter one public email address such as info@example.com (no spaces, name or angle brackets).';
}

// IANA Area/Location names (or UTC) that the browser also recognises. Raw offsets such as +03:00 and
// abbreviations such as EAT are refused even though some browsers accept legacy abbreviations. Aliases are
// kept as entered; only the capitalisation must match.
const IANA_NAME = /^(?:UTC|(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc)\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?)$/i;
export function timeZoneMessage(value) {
  const help = 'Enter an IANA timezone name such as Africa/Dar_es_Salaam or Africa/Nairobi (not an abbreviation like EAT or an offset like +03:00).';
  if (!IANA_NAME.test(value)) return help;
  let resolved;
  try { resolved = new Intl.DateTimeFormat('en-GB', { timeZone: value }).resolvedOptions().timeZone; } catch { return help; }
  if (resolved !== value && resolved.toLowerCase() === value.toLowerCase()) return `Use the exact spelling “${resolved}”.`;
  return null;
}

let zoneList = null;
export function timeZoneSuggestions() {
  if (!zoneList) { try { zoneList = Intl.supportedValuesOf('timeZone'); } catch { zoneList = ['Africa/Dar_es_Salaam', 'Africa/Nairobi', 'UTC']; } }
  return zoneList;
}

// tel: links use only digits and a leading +, from a value that passed phoneMessage().
export const telHref = phone => (phone && !phoneMessage(phone) ? `tel:${phone.replace(/[^\d+]/g, '')}` : null);
export const mailtoHref = email => (email && !emailMessage(email) ? `mailto:${email}` : null);
export const safeHttpsHref = url => (url && !httpsUrlMessage(url) ? url : null);

// Host hints for the suggested networks (warnings only; profiles may use other official domains).
const NETWORK_HOSTS = { facebook: ['facebook.com', 'fb.com'], instagram: ['instagram.com'], tiktok: ['tiktok.com'] };
const hostMatches = (url, domains) => { try { const host = new URL(url).hostname.toLowerCase(); return domains.some(d => host === d || host.endsWith(`.${d}`)); } catch { return true; } };

// Shape errors from schemas/site.schema.json. They are flagged so semantic checks are skipped for malformed records.
function schemaIssues(record, ctx) {
  if (!ctx.siteValidator) return [];
  return ctx.siteValidator.validateRecord(record).map(e => ({ ...error(e.path, `${e.path || 'record'} ${e.message}.`), schema: true }));
}
const malformed = issues => issues.some(i => i.schema);

function checkAsset(ctx, issues, path, assetId, label, publish) {
  const asset = ctx.assets.get(assetId);
  if (!asset) issues.push(error(path, `${label} is missing from the local media library (asset ${shortId(assetId)}). Remove it or choose another image.`));
  else if (!asset.hasBlob) issues.push((publish ? error : warning)(path, `${label} has details but its image file is not stored in this browser. Import the media backup or choose another image.`));
  return !!asset?.hasBlob;
}

function caseOnlyDuplicates(list, path, label, issues) {
  const seen = new Map();
  for (const item of list || []) {
    const key = item.toLowerCase();
    if (seen.has(key) && seen.get(key) !== item) issues.push(warning(path, `${label} “${seen.get(key)}” and “${item}” differ only by capitalisation. Both are kept; remove one if they are the same.`));
    seen.set(key, item);
  }
}

function dedupe(issues) {
  const errorKeys = new Set(issues.filter(i => i.severity === 'error').map(i => `${i.path}|${i.message}`));
  const seen = new Set();
  return issues.filter(i => {
    const key = `${i.severity}|${i.path}|${i.message}`;
    if ((i.severity === 'warning' && errorKeys.has(`${i.path}|${i.message}`)) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---- site settings ----
function settingsBranding(record, ctx, issues, publish) {
  const b = record.branding || {};
  let usableLogos = 0;
  for (const [key, label, background] of [['logoLight', 'light-background logo', 'light'], ['logoDark', 'dark-background logo', 'dark']]) {
    const logo = b[key];
    if (!logo) continue;
    const path = `branding.${key}`;
    let usable = true;
    if (logo.source === 'bundled') {
      const bundled = BUNDLED_LOGOS[logo.key];
      if (!bundled) { issues.push(error(path, 'This bundled logo is not available in this version of the CMS. Choose another logo.')); usable = false; }
      else if (!bundled.backgrounds.includes(background)) { issues.push(error(path, `The ${bundled.label} is a ${bundled.note}. Upload a JPEG, PNG or WebP logo for dark backgrounds instead.`)); usable = false; }
    } else {
      usable = checkAsset(ctx, issues, path, logo.assetId, `The ${label}`, publish);
    }
    if (publish && blank(logo.alt)) issues.push(error(`${path}.alt`, `Add alt text for the ${label}, usually the name exactly as written in the logo.`));
    if (usable) usableLogos += 1;
  }
  if (b.shareImage) checkAsset(ctx, issues, 'branding.shareImage', b.shareImage.assetId, 'The default sharing image', publish);
  if (!publish) return;
  if (!usableLogos) issues.push(error('branding.logoLight', 'Choose at least one usable logo. The bundled Vion logo can be used on light backgrounds.'));
  if (!b.shareImage) {
    if (!b.shareImageUsesLogo) issues.push(error('branding.shareImage', 'Choose a default sharing image (JPEG, PNG or WebP), or explicitly approve the light-background logo as the fallback sharing image.'));
    else if (b.logoLight?.source !== 'asset') issues.push(error('branding.shareImageUsesLogo', 'The logo fallback needs an uploaded JPEG, PNG or WebP light-background logo. The bundled SVG logo cannot be the sharing image because social platforms commonly do not display SVG previews.'));
  }
}

function settingsLinks(record, issues, publish) {
  const visibleNetworks = new Map();
  (record.social || []).forEach((s, i) => {
    const n = i + 1;
    if (s.url) { const m = httpsUrlMessage(s.url); if (m) issues.push(error(`social.${i}.url`, m)); else {
      const domains = NETWORK_HOSTS[s.network.toLowerCase()];
      if (domains && !hostMatches(s.url, domains)) issues.push(warning(`social.${i}.url`, `This does not look like a ${s.network} address (expected ${domains.join(' or ')}). Check the link.`));
    } }
    if (publish && blank(s.network)) issues.push(error(`social.${i}.network`, `Social profile ${n} needs a network name, or remove it.`));
    if (publish && blank(s.url)) issues.push(error(`social.${i}.url`, `Social profile ${n} needs its https:// profile address, or remove it.`));
    if (s.visible && s.network) {
      const key = s.network.toLowerCase();
      if (visibleNetworks.has(key)) issues.push(error(`social.${i}.network`, `${s.network} is already shown as social profile ${visibleNetworks.get(key) + 1}. Hide or remove one: duplicate visible networks are not supported.`));
      else visibleNetworks.set(key, i);
    }
  });
  (record.reviews || []).forEach((r, i) => {
    const n = i + 1;
    if (r.url) { const m = httpsUrlMessage(r.url); if (m) issues.push(error(`reviews.${i}.url`, m)); }
    if (!publish) return;
    if (blank(r.platform)) issues.push(error(`reviews.${i}.platform`, `Review link ${n} needs a platform name, or remove it.`));
    if (blank(r.url)) issues.push(error(`reviews.${i}.url`, `Review link ${n} needs its https:// profile address, or remove it.`));
    if (blank(r.buttonLabel)) issues.push(error(`reviews.${i}.buttonLabel`, `Review link ${n} needs a button label (for example “Read our reviews”).`));
  });
}

export function validateSettingsDraft(record, ctx) {
  const issues = schemaIssues(record, ctx);
  if (malformed(issues)) return issues;
  const { company, contact, seo } = record;
  if (company.timezone) { const m = timeZoneMessage(company.timezone); if (m) issues.push(error('company.timezone', m)); }
  for (const key of ['primaryPhone', 'emergencyPhone']) if (contact[key]) { const m = phoneMessage(contact[key]); if (m) issues.push(error(`contact.${key}`, m)); }
  if (contact.email) { const m = emailMessage(contact.email); if (m) issues.push(error('contact.email', m)); }
  if (contact.mapsUrl) { const m = mapsUrlMessage(contact.mapsUrl); if (m) issues.push(error('contact.mapsUrl', m)); }
  if (contact.emergencyPhone && contact.emergencyPhone === contact.primaryPhone) issues.push(warning('contact.emergencyPhone', 'The emergency number is the same as the primary number. Leave it empty if there is no separate emergency line.'));
  caseOnlyDuplicates(company.areasServed, 'company.areasServed', 'Areas', issues);
  settingsBranding(record, ctx, issues, false);
  settingsLinks(record, issues, false);
  if (seo.siteName.length > SITE_NAME_ADVICE) issues.push(warning('seo.siteName', `The site name is ${seo.siteName.length} characters; around ${SITE_NAME_ADVICE} or fewer is advised (guidance only).`));
  if (seo.defaultDescription.length > SEO_DESCRIPTION_ADVICE) issues.push(warning('seo.defaultDescription', `The default description is ${seo.defaultDescription.length} characters; around ${SEO_DESCRIPTION_ADVICE} is advised (guidance only).`));
  return dedupe(issues);
}

export function validateSettingsPublish(record, ctx) {
  const issues = validateSettingsDraft(record, ctx);
  if (malformed(issues)) return issues;
  const need = (path, message) => { if (blank(get(record, path))) issues.push(error(path, message)); };
  need('company.name', 'Enter the company name.');
  need('company.officeAddress', 'Enter the office address.');
  need('company.timezone', 'Enter the timezone (an IANA name such as Africa/Dar_es_Salaam).');
  need('contact.primaryPhone', 'Enter the primary public telephone number.');
  need('contact.email', 'Enter the public email address.');
  settingsBranding(record, ctx, issues, true);
  settingsLinks(record, issues, true);
  return dedupe(issues);
}

// ---- team profiles ----
export function validateMemberDraft(record, ctx) {
  const issues = [];
  if (blank(record.name)) issues.push(error('name', 'Enter a name. A name is the only content needed to save a draft.'));
  issues.push(...schemaIssues(record, ctx).filter(i => i.path !== 'name'));
  if (malformed(issues)) return issues;
  (record.links || []).forEach((l, i) => { if (l.url) { const m = httpsUrlMessage(l.url); if (m) issues.push(error(`links.${i}.url`, m)); } });
  if (record.portrait) checkAsset(ctx, issues, 'portrait', record.portrait.assetId, 'The portrait', false);
  if (record.bio.length > BIO_ADVICE) issues.push(warning('bio', `The biography is ${record.bio.length} characters; a short biography of up to about ${BIO_ADVICE} characters is advised (guidance only).`));
  return dedupe(issues);
}

export function validateMemberPublish(record, ctx) {
  const issues = validateMemberDraft(record, ctx);
  if (malformed(issues)) return issues;
  if (record.status === 'archived') issues.push(error('name', 'Archived profiles cannot be published. Restore the profile to draft first.'));
  if (blank(record.position)) issues.push(error('position', 'Enter the position or job title.'));
  if (blank(record.bio)) issues.push(error('bio', 'Write a short biography.'));
  if (!record.portrait) issues.push(error('portrait', 'Choose a portrait image.'));
  else {
    checkAsset(ctx, issues, 'portrait', record.portrait.assetId, 'The portrait', true);
    if (blank(record.portrait.alt)) issues.push(error('portrait.alt', `Describe the portrait in context (alt text), for example “Portrait of ${record.name || 'the team member'}”.`));
  }
  (record.links || []).forEach((l, i) => {
    if (blank(l.label)) issues.push(error(`links.${i}.label`, `Link ${i + 1} needs a label (for example “LinkedIn profile”), or remove it.`));
    if (blank(l.url)) issues.push(error(`links.${i}.url`, `Link ${i + 1} needs an https:// address, or remove it.`));
  });
  return dedupe(issues);
}

// ---- team lineup ----
// Errors: references to missing/archived profiles or duplicates. Warnings: visible entries that will not
// appear because their profile is not published.
export function validateLineup(record, ctx) {
  const issues = schemaIssues(record, ctx);
  if (malformed(issues)) return issues;
  const seen = new Set();
  record.entries.forEach((entry, i) => {
    const env = ctx.siteRecords.get(entry.memberId);
    if (seen.has(entry.memberId)) issues.push(error(`entries.${i}`, 'A profile is listed twice in the team order.'));
    seen.add(entry.memberId);
    if (!env || env.kind !== 'teamMember') issues.push(error(`entries.${i}`, `The team order lists a profile that no longer exists (ID ${shortId(entry.memberId)}).`));
    else if (env.record.status === 'archived') issues.push(error(`entries.${i}`, `“${env.record.name}” is archived and cannot be in the team order.`));
    else if (entry.visible && !ctx.sitePublished.has(entry.memberId)) issues.push(warning(`entries.${i}`, `“${env.record.name}” is visible but not published, so it will not appear until its profile is published.`));
  });
  if (record.id !== LINEUP_ID) issues.push(error('id', 'The team order must use the fixed lineup ID.'));
  return issues;
}
