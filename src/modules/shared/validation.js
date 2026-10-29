// Draft and semantic publication validation. Draft saves accept incomplete content but reject malformed
// supplied values; publication additionally enforces the proposed per-kind minimums from the specification.
import { findRouteConflict, routeClaims, slugFormatMessage } from './routes.js';
import { pricingIssues } from './pricing.js';
import { KIND_LABELS, TAXONOMY_NAMESPACES, assetRefs, publicName, relationRefs, taxonomyRefs } from './records.js';
import { termReference } from './taxonomy.js';
import { durationIssues } from './day-trips.js';
import { shortId } from './format.js';

export const LOW_RESOLUTION_WIDTH = 1200;
export const SEO_DESCRIPTION_ADVICE = 160;
export const SEO_TITLE_ADVICE = 60;

const error = (path, message) => ({ path, message, severity: 'error' });
const warning = (path, message) => ({ path, message, severity: 'warning' });
export const errorsOnly = issues => issues.filter(i => i.severity === 'error');
export const hasErrors = issues => issues.some(i => i.severity === 'error');
const blank = value => !String(value ?? '').trim();

const SCHEMA_FIELD_NAMES = { durationDays: 'Duration (days)', recommendedRank: 'Recommended rank', order: 'Order', displayOrder: 'Display order', 'duration.value': 'Duration', 'duration.unit': 'Duration unit', 'pricing.amount': 'Amount', 'pricing.currency': 'Currency' };

// Returns null when valid; otherwise an actionable message. Only absolute http(s) links are allowed.
export function webUrlMessage(value) {
  let url;
  try { url = new URL(value); } catch { return 'Enter a full web address starting with https:// (for example https://www.example.com).'; }
  if (!['http:', 'https:'].includes(url.protocol)) return `Only http:// or https:// links are allowed; “${url.protocol}” links are rejected for safety.`;
  if (url.username || url.password) return 'Remove the user name or password from the link.';
  if (!url.hostname.includes('.')) return 'Enter a public web address with a full domain name (for example https://www.example.com).';
  if (/\s/.test(value)) return 'Remove spaces from the web address.';
  return null;
}

export function phoneMessage(value) {
  const digits = value.replace(/\D/g, '');
  if (!/^\+?[0-9][0-9 ()-]*$/.test(value) || digits.length < 7 || digits.length > 15) {
    return 'Enter a public phone number with 7–15 digits, optionally starting with + and using spaces, brackets or hyphens (for example +255 700 000 000).';
  }
  return null;
}

function schemaIssues(record, ctx, existing) {
  if (!ctx.validator) return [];
  const already = new Set(existing.map(i => i.path));
  return ctx.validator.validateRecord(record).filter(e => !already.has(e.path)).map(e => {
    const name = SCHEMA_FIELD_NAMES[e.path] || e.path;
    return error(e.path, `${name} ${e.message}.`);
  });
}

function checkRelations(record, ctx, issues, publish) {
  for (const ref of relationRefs(record)) {
    const env = ctx.records.get(ref.id);
    const label = KIND_LABELS[ref.kind].toLowerCase();
    if (!env || env.kind !== ref.kind) { issues.push(error(ref.path, `A linked ${label} no longer exists (ID ${shortId(ref.id)}). Remove it from the list.`)); continue; }
    const name = `“${env.record.title}”`;
    if (publish && !ctx.published.has(ref.id)) {
      issues.push(error(ref.path, `The ${label} ${name} is ${env.record.status === 'archived' ? 'archived' : 'not published'}. Publish it first, or remove it before publishing this ${KIND_LABELS[record.kind].toLowerCase()}.`));
    } else if (env.record.status === 'archived') {
      issues.push(warning(ref.path, `The ${label} ${name} is archived. Restore and publish it, or remove the link.`));
    }
  }
}

// Term references (tour type/category/standard/tags, day-trip tags). A reference that was already saved on
// this record (or on the record being duplicated) may stay when its term became inactive or is unresolved —
// a warning, so unrelated edits can still be saved and nothing is silently dropped. Choosing an inactive or
// unknown term anew is an error, and so is any reference to a term of another group. Publishing additionally
// needs every referenced term in the published taxonomy snapshot (the local site resolves labels from it).
function checkTaxonomies(record, ctx, issues, { publish = false, previous = null } = {}) {
  const before = previous ?? ctx.records.get(record.id)?.record ?? null;
  const saved = new Set(before ? taxonomyRefs(before).map(r => `${r.path}|${r.id}`) : []);
  for (const ref of taxonomyRefs(record)) {
    const group = TAXONOMY_NAMESPACES[ref.namespace].toLowerCase();
    const found = termReference(ref.id, ref.namespace, ctx);
    const wasSaved = saved.has(`${ref.path}|${ref.id}`);
    if (found.state === 'wrong-namespace') {
      issues.push(error(ref.path, `“${found.term.label}” is a ${TAXONOMY_NAMESPACES[found.term.namespace].toLowerCase()}, not a ${group}. Terms cannot be used across groups; choose a ${group} instead.`));
      continue;
    }
    if (found.state === 'unresolved') {
      const what = `Unresolved ${group} value (ID ${shortId(ref.id)}): it is not a managed term.`;
      if (publish) issues.push(error(ref.path, `${what} Remove it or choose a managed ${group} before publishing.`));
      else if (wasSaved) issues.push(warning(ref.path, `${what} It is kept as saved but blocks publishing. Remove it or choose a managed ${group}.`));
      else issues.push(error(ref.path, `${what} Choose a managed ${group}.`));
      continue;
    }
    if (found.state === 'inactive') {
      if (wasSaved) issues.push(warning(ref.path, `The ${group} “${found.term.label}” is inactive. It stays on this record and is still displayed, but it is no longer offered for new selections.`));
      else issues.push(error(ref.path, `The ${group} “${found.term.label}” is inactive and cannot be newly selected. Activate it under Tour Packages › Taxonomies, or choose an active ${group}.`));
    }
    if (publish && !ctx.publishedTerms?.has(ref.id)) {
      issues.push(error(ref.path, `The ${group} “${found.term.label}” is not in the published taxonomy yet. Publish taxonomy changes under Tour Packages › Taxonomies first, or remove it.`));
    }
  }
}

// Term references on a saved record that need attention (inactive, unresolved or in the wrong group).
export function termAttention(record, ctx) {
  return taxonomyRefs(record).map(ref => ({ ...ref, ...termReference(ref.id, ref.namespace, ctx) })).filter(ref => ref.state !== 'active');
}

function checkMedia(record, ctx, issues, publish) {
  for (const ref of assetRefs(record)) {
    const asset = ctx.assets.get(ref.assetId);
    const where = ref.role === 'gallery' ? `Gallery image ${Number(ref.path.split('.')[1]) + 1}` : ref.role === 'cover' ? 'The cover image' : 'The share image';
    if (!asset) issues.push(error(ref.path, `${where} is missing from the local media library (asset ${shortId(ref.assetId)}). Remove it or choose another image.`));
    else if (!asset.hasBlob) issues.push((publish ? error : warning)(ref.path, `${where} has metadata but its image file is not stored in this browser. Import the media backup or choose another image.`));
  }
  if (!publish) return;
  if (!record.cover) issues.push(error('cover', 'Choose a cover image.'));
  else if (blank(record.cover.alt)) issues.push(error('cover.alt', 'Describe the cover image in context (alt text), for example “Elephants crossing the Tarangire River at sunset”.'));
  (record.gallery || []).forEach((p, i) => {
    if (!p.decorative && blank(p.alt)) issues.push(error(`gallery.${i}.alt`, `Add alt text for gallery image ${i + 1}, or mark it as decorative.`));
  });
  const imageIds = new Set(assetRefs(record).filter(r => r.role !== 'share image').map(r => r.assetId));
  if (imageIds.size < 3) issues.push(warning('gallery', `Only ${imageIds.size} image${imageIds.size === 1 ? '' : 's'} (cover + gallery). Three or more are recommended; this does not block publishing.`));
  const small = [...imageIds].map(id => ctx.assets.get(id)).filter(a => a && a.width < LOW_RESOLUTION_WIDTH);
  if (small.length) issues.push(warning('gallery', `${small.map(a => a.fileName).join(', ')} ${small.length === 1 ? 'is' : 'are'} narrower than ${LOW_RESOLUTION_WIDTH}px and may look soft on large screens (advisory).`));
}

function checkSeo(record, issues) {
  const seo = record.seo || {};
  if ((seo.title || '').length > SEO_TITLE_ADVICE) issues.push(warning('seo.title', `The SEO title is ${seo.title.length} characters; around ${SEO_TITLE_ADVICE} is advised (guidance only).`));
  if ((seo.description || '').length > SEO_DESCRIPTION_ADVICE) issues.push(warning('seo.description', `The SEO description is ${seo.description.length} characters; around ${SEO_DESCRIPTION_ADVICE} is advised (guidance only).`));
}

function caseOnlyDuplicates(list, path, label, issues) {
  const seen = new Map();
  for (const item of list || []) {
    const key = item.toLowerCase();
    if (seen.has(key) && seen.get(key) !== item) {
      issues.push(warning(path, `${label} “${seen.get(key)}” and “${item}” differ only by capitalisation. Both are kept; remove one if they are the same.`));
    }
    seen.set(key, item);
  }
}

function checkKindDraft(record, issues) {
  if (record.kind === 'destination') {
    caseOnlyDuplicates(record.activities, 'activities', 'Activities', issues);
  }
  if (record.kind === 'accommodation') {
    if (record.website && webUrlMessage(record.website)) issues.push(error('website', webUrlMessage(record.website)));
    if (record.publicPhone && phoneMessage(record.publicPhone)) issues.push(error('publicPhone', phoneMessage(record.publicPhone)));
    caseOnlyDuplicates(record.amenities, 'amenities', 'Amenities', issues);
    caseOnlyDuplicates(record.activities, 'activities', 'Activities', issues);
  }
  if (record.kind === 'tour') {
    issues.push(...pricingIssues(record.pricing, { publish: false }).filter(i => i.severity === 'error'));
    caseOnlyDuplicates(record.inclusions, 'inclusions', 'Inclusions', issues);
    caseOnlyDuplicates(record.exclusions, 'exclusions', 'Exclusions', issues);
  }
  if (record.kind === 'dayTrip') {
    issues.push(...pricingIssues(record.pricing, { publish: false }).filter(i => i.severity === 'error'));
    issues.push(...durationIssues(record.duration));
    caseOnlyDuplicates(record.inclusions, 'inclusions', 'Inclusions', issues);
    caseOnlyDuplicates(record.exclusions, 'exclusions', 'Exclusions', issues);
    caseOnlyDuplicates(record.whatToBring, 'whatToBring', 'What to bring', issues);
  }
}

function checkKindPublish(record, ctx, issues) {
  const need = (path, message) => { if (blank(path.split('.').reduce((v, k) => v?.[k], record))) issues.push(error(path, message)); };
  if (record.kind === 'destination') {
    need('overview', 'Write an overview of the destination.');
    need('bestTime', 'Describe the best time to visit.');
    (record.travelTips || []).forEach((tip, i) => {
      if (blank(tip.title)) issues.push(error(`travelTips.${i}.title`, `Travel tip ${i + 1} needs a title (or remove the empty tip).`));
      if (blank(tip.body)) issues.push(error(`travelTips.${i}.body`, `Travel tip ${i + 1} needs some text (or remove the empty tip).`));
    });
  }
  if (record.kind === 'accommodation') {
    need('description', 'Write a description of the accommodation.');
    need('type', 'Enter the accommodation type (for example Lodge).');
    need('standard', 'Enter the accommodation standard (for example Luxury).');
    if (!record.destinationId && blank(record.noDestinationReason)) {
      issues.push(error('destinationId', 'Link a published destination, or explain why this accommodation has no destination.'));
    }
    if (record.publicPhoneVisible && blank(record.publicPhone)) issues.push(error('publicPhone', 'Enter the public phone number, or untick “Show phone publicly”.'));
    if (record.publicPageEnabled === false) issues.push(warning('publicPageEnabled', 'The public page is disabled, so this accommodation will not appear in the local preview site listing (A3 visibility is unresolved).'));
  }
  if (record.kind === 'tour') {
    need('overview', 'Write an overview of the tour.');
    const days = record.durationDays;
    if (days == null) issues.push(error('durationDays', 'Enter the tour duration in days.'));
    if (!(record.destinationIds || []).length) issues.push(error('destinationIds', 'Link at least one published destination.'));
    const itinerary = record.itinerary || [];
    if (Number.isInteger(days) && days >= 1 && itinerary.length !== days) {
      issues.push(error('itinerary', `The itinerary has ${itinerary.length} day${itinerary.length === 1 ? '' : 's'} but the duration is ${days}. Add or remove days so they match.`));
    }
    if (itinerary.some((day, i) => day.dayNumber !== i + 1)) issues.push(error('itinerary', 'Day numbers must run 1, 2, 3… without gaps. Save the draft to renumber the days.'));
    itinerary.forEach((day, i) => {
      if (blank(day.title)) issues.push(error(`itinerary.${i}.title`, `Day ${i + 1} needs a title.`));
      if (blank(day.description)) issues.push(error(`itinerary.${i}.description`, `Day ${i + 1} needs a description.`));
    });
    if (!(record.inclusions || []).length) issues.push(error('inclusions', 'Add at least one inclusion.'));
    if (!(record.exclusions || []).length) issues.push(error('exclusions', 'Add at least one exclusion.'));
    issues.push(...pricingIssues(record.pricing, { publish: true }));
  }
  // Day trips (proposed minimum): summary, duration, schedule, exclusions and what to bring stay optional.
  if (record.kind === 'dayTrip') {
    need('overview', 'Write an overview of the day trip.');
    if (!(record.destinationIds || []).length) issues.push(error('destinationIds', 'Link at least one published destination.'));
    if (!(record.inclusions || []).length) issues.push(error('inclusions', 'Add at least one inclusion. You can copy the day-trip defaults into this draft and review them.'));
    issues.push(...pricingIssues(record.pricing, { publish: true }));
    (record.schedule || []).forEach((item, i) => {
      if (blank(item.heading)) issues.push(error(`schedule.${i}.heading`, blank(item.description) ? `Schedule item ${i + 1} is empty. Add a heading or remove the item.` : `Schedule item ${i + 1} needs a heading.`));
    });
    if (blank(record.summary)) issues.push(warning('summary', 'No summary: listing cards will show the start of the overview instead (optional).'));
    if (!record.duration) issues.push(warning('duration.value', 'No duration: the page will not say how long the trip takes (optional).'));
  }
}

// options.previous: the record whose term references count as already saved (defaults to the stored version
// of this record; the source record when duplicating).
export function validateDraft(record, ctx, { conversionIssues = [], previous = null, forPublish = false } = {}) {
  const issues = [...conversionIssues];
  if (blank(record.title)) issues.push(error('title', `Enter a title. A title is the only content needed to save a draft.`));
  issues.push(...schemaIssues(record, ctx, issues));
  const slugMessage = slugFormatMessage(record.slug);
  if (slugMessage) issues.push(error('slug', slugMessage));
  else if (record.slug) {
    const conflict = findRouteConflict(record.kind, record.slug, record.id, ctx, routeClaims(ctx));
    if (conflict) issues.push(error('slug', conflict.message));
  }
  checkKindDraft(record, issues);
  checkRelations(record, ctx, issues, false);
  checkTaxonomies(record, ctx, issues, { publish: forPublish, previous });
  checkMedia(record, ctx, issues, false);
  checkSeo(record, issues);
  return dedupe(issues);
}

export function validatePublish(record, ctx, options = {}) {
  const issues = validateDraft(record, ctx, { ...options, forPublish: true }).filter(i => !(i.severity === 'warning' && /archived/.test(i.message)));
  if (record.status === 'archived') issues.push(error('title', 'Archived records cannot be published. Restore the record to draft first.'));
  if (blank(publicName(record))) issues.push(error('title', 'Enter a title or display name.'));
  if (!record.slug) issues.push(error('slug', 'Enter a slug (the last part of the page address) before publishing.'));
  checkKindPublish(record, ctx, issues);
  // Publishing re-checks relationships and media with the stricter publication rules.
  const relationIssues = [];
  checkRelations(record, ctx, relationIssues, true);
  checkMedia(record, ctx, relationIssues, true);
  return dedupe(issues.concat(relationIssues));
}

// Removes repeats, and drops a warning when the same path/message is also reported as an error.
function dedupe(issues) {
  const errorKeys = new Set(issues.filter(i => i.severity === 'error').map(i => `${i.path}|${i.message}`));
  const seen = new Set();
  return issues.filter(i => {
    const key = `${i.path}|${i.message}`;
    if (i.severity === 'warning' && errorKeys.has(key)) return false;
    if (seen.has(`${i.severity}|${key}`)) return false;
    seen.add(`${i.severity}|${key}`);
    return true;
  });
}
