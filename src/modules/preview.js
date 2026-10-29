// Read-only renderers for saved drafts and published snapshots. All text is rendered as text nodes.
import { h, icon } from '../components/dom.js';
import { assetImage } from '../components/media.js';
import { ACCOMMODATION_SETTINGS, publicName } from './shared/records.js';
import { routeFor } from './shared/routes.js';
import { describePrice, PROVISIONAL_PRICING_WARNING } from './shared/pricing.js';
import { truncateWords, paragraphs } from './shared/format.js';
import { SEO_DESCRIPTION_ADVICE } from './shared/validation.js';

// mode "published": related records resolve from published snapshots only, so working edits to a
// dependency never leak into a published page. mode "draft": related records resolve from working drafts.
export function createResolver(ctx, mode) {
  return {
    mode,
    record(id) {
      if (mode === 'published') {
        const pub = ctx.published.get(id);
        return pub ? { id, kind: pub.kind, title: publicName(pub.snapshot), route: pub.route, visible: true, record: pub.snapshot } : { id, title: null, visible: false };
      }
      const env = ctx.records.get(id);
      if (!env) return { id, title: null, visible: false };
      return { id, kind: env.kind, title: publicName(env.record), route: routeFor(env.kind, env.record.slug), status: env.record.status, visible: ctx.published.has(id), record: env.record };
    },
    term(id) { return ctx.taxonomies.get(id)?.label || null; },
    asset(id) { return ctx.assets.get(id) || null; }
  };
}

function prose(text) {
  return h('div', { class: 'prose' }, paragraphs(text).map(p => h('p', null, p)));
}

function refList(ids, resolver, linkFor, { separator = null } = {}) {
  const items = ids.map(id => {
    const ref = resolver.record(id);
    if (!ref.title) return h('span', { class: 'ref ref-missing' }, icon('alert'), resolver.mode === 'published' ? 'Unavailable (not published)' : 'Missing record');
    const warn = resolver.mode === 'draft' && !ref.visible;
    const label = h('span', null, ref.title, warn ? h('small', { class: 'ref-status' }, ref.status === 'archived' ? ' (archived)' : ' (not published)') : null);
    const href = linkFor?.(ref);
    return href ? h('a', { class: 'ref', href }, label) : h('span', { class: ['ref', warn && 'ref-warn'] }, label);
  });
  if (!separator) return items;
  return items.flatMap((item, i) => (i ? [h('span', { class: 'ref-sep' }, separator), item] : [item]));
}

function figure(scope, resolver, placement, className) {
  const asset = resolver.asset(placement.assetId);
  return h('figure', { class: className },
    assetImage(scope, placement.assetId, { alt: placement.decorative ? '' : placement.alt, asset }),
    placement.caption ? h('figcaption', null, placement.caption) : null);
}

function list(items) {
  return items?.length ? h('ul', { class: 'preview-list' }, items.map(item => h('li', null, item))) : h('p', { class: 'muted' }, 'None listed.');
}

function section(title, ...content) {
  return h('section', { class: 'preview-section' }, h('h2', null, title), ...content);
}

export function priceLine(record) {
  const price = describePrice(record.pricing);
  return h('div', { class: `price-line price-${price.kind}` },
    h('strong', null, price.text),
    price.kind === 'from' && price.applicability ? h('span', { class: 'price-note' }, price.applicability) : null,
    price.kind !== 'request' ? h('small', { class: 'price-provisional' }, 'Provisional manual price — not a quote.') : null);
}

export function cardSummary(record, resolver) {
  if (record.kind === 'tour') {
    return [record.durationDays ? `${record.durationDays} day${record.durationDays === 1 ? '' : 's'}` : null, record.summary || truncateWords(record.overview, 140)].filter(Boolean).join(' · ');
  }
  if (record.kind === 'accommodation') {
    const dest = record.destinationId ? resolver.record(record.destinationId).title : null;
    return [record.type, record.standard, dest].filter(Boolean).join(' · ') || truncateWords(record.description, 140);
  }
  return truncateWords(record.overview, 140);
}

export function renderCard(record, { resolver, scope, href }) {
  const inner = [
    record.cover ? assetImage(scope, record.cover.assetId, { alt: record.cover.alt, className: 'card-img', asset: resolver.asset(record.cover.assetId) }) : h('div', { class: 'img-box card-img img-missing' }, icon('image'), h('span', null, 'No cover image')),
    h('div', { class: 'card-body' },
      h('h3', null, publicName(record)),
      h('p', null, cardSummary(record, resolver)),
      record.kind === 'tour' ? priceLine(record) : null)
  ];
  return href ? h('a', { class: 'preview-card', href }, inner) : h('div', { class: 'preview-card' }, inner);
}

function destinationBody(record) {
  const tips = record.travelTips?.length
    ? h('div', { class: 'tips' }, record.travelTips.map(tip => h('div', { class: 'tip' }, tip.title ? h('h3', null, tip.title) : null, prose(tip.body))))
    : record.legacyTravelTips ? h('div', null, h('p', { class: 'muted small' }, 'Legacy travel tips (unstructured):'), prose(record.legacyTravelTips)) : h('p', { class: 'muted' }, 'No travel tips.');
  return [
    section('Overview', prose(record.overview) || null),
    record.wildlife ? section('Wildlife', prose(record.wildlife)) : null,
    section('Activities', list(record.activities)),
    section('Best time to visit', record.bestTime ? prose(record.bestTime) : h('p', { class: 'muted' }, 'Not provided.')),
    section('Travel tips', tips)
  ];
}

function accommodationBody(record, resolver, linkFor) {
  const location = record.destinationId
    ? h('p', null, 'Destination: ', refList([record.destinationId], resolver, linkFor))
    : h('p', null, 'No linked destination', record.noDestinationReason ? `: ${record.noDestinationReason}` : '.');
  const contact = [
    record.publicPhoneVisible && record.publicPhone ? h('p', null, 'Phone: ', record.publicPhone) : null,
    record.website ? h('p', null, 'Website: ', h('a', { href: record.website, target: '_blank', rel: 'noopener noreferrer' }, record.website)) : null
  ].filter(Boolean);
  return [
    section('About', location, h('p', null, [record.type, record.standard, ACCOMMODATION_SETTINGS[record.setting]].filter(Boolean).join(' · ')), prose(record.description)),
    section('Amenities', list(record.amenities)),
    section('Activities', list(record.activities)),
    section('Contact', contact.length ? contact : h('p', { class: 'muted' }, 'No public contact details shown.'))
  ];
}

function tourBody(record, resolver, linkFor) {
  const terms = [record.typeId, record.categoryId, record.standardId, ...(record.tagIds || [])].filter(Boolean).map(id => resolver.term(id) || 'Unknown term');
  return [
    h('div', { class: 'tour-facts' },
      h('div', null, h('small', null, 'Duration'), h('strong', null, record.durationDays ? `${record.durationDays} day${record.durationDays === 1 ? '' : 's'}` : 'Not set')),
      h('div', null, h('small', null, 'Destinations'), h('span', null, record.destinationIds?.length ? refList(record.destinationIds, resolver, linkFor, { separator: ', ' }) : 'None')),
      h('div', null, h('small', null, 'Price'), priceLine(record))),
    record.pricing?.mode === 'manualFrom' ? h('p', { class: 'muted small' }, PROVISIONAL_PRICING_WARNING) : null,
    terms.length ? h('p', { class: 'term-row' }, terms.map(t => h('span', { class: 'tag' }, t))) : null,
    record.summary ? h('p', { class: 'lead' }, record.summary) : null,
    section('Overview', prose(record.overview)),
    section('Itinerary', record.itinerary?.length ? h('ol', { class: 'itinerary-preview' }, record.itinerary.map(day => h('li', null,
      h('h3', null, `Day ${day.dayNumber}: `, day.title || 'Untitled day'),
      prose(day.description),
      day.destinationIds?.length ? h('p', { class: 'small' }, 'Destinations: ', refList(day.destinationIds, resolver, linkFor, { separator: ', ' })) : null,
      day.accommodationIds?.length ? h('p', { class: 'small' }, 'Accommodation: ', refList(day.accommodationIds, resolver, linkFor, { separator: ' or ' })) : h('p', { class: 'small muted' }, 'Accommodation: not specified'),
      day.meals?.length ? h('p', { class: 'small' }, 'Meals: ', day.meals.join(', ')) : null,
      day.activities?.length ? h('p', { class: 'small' }, 'Activities: ', day.activities.join(', ')) : null))) : h('p', { class: 'muted' }, 'No itinerary days.')),
    h('div', { class: 'two-col' }, section('Included', list(record.inclusions)), section('Not included', list(record.exclusions)))
  ];
}

export function renderRecordPage(record, { resolver, scope, linkFor, showSeo = false }) {
  const body = record.kind === 'destination' ? destinationBody(record) : record.kind === 'accommodation' ? accommodationBody(record, resolver, linkFor) : tourBody(record, resolver, linkFor);
  const seoTitle = record.seo?.title || publicName(record);
  const seoDescription = record.seo?.description || truncateWords(record.kind === 'tour' ? record.summary || record.overview : record.kind === 'destination' ? record.overview : record.description, SEO_DESCRIPTION_ADVICE);
  return h('article', { class: 'preview-page' },
    record.cover ? figure(scope, resolver, record.cover, 'preview-hero') : h('div', { class: 'preview-hero img-box img-missing' }, icon('image'), h('span', null, 'No cover image')),
    h('header', { class: 'preview-head' },
      h('p', { class: 'eyebrow' }, record.kind.toUpperCase()),
      h('h1', null, publicName(record))),
    ...body.filter(Boolean),
    record.gallery?.length ? section('Gallery', h('div', { class: 'preview-gallery' }, record.gallery.map(p => figure(scope, resolver, p, 'gallery-item')))) : null,
    showSeo ? section('SEO (local preview)', h('dl', { class: 'seo-dl' },
      h('dt', null, 'Canonical route'), h('dd', null, routeFor(record.kind, record.slug) || '(no slug)'),
      h('dt', null, 'Title'), h('dd', null, seoTitle),
      h('dt', null, 'Description'), h('dd', null, seoDescription || '—'),
      h('dt', null, 'Share image'), h('dd', null, record.seo?.shareAssetId ? 'Custom share image' : record.cover ? 'Cover image (default)' : 'None'),
      h('dt', null, 'Indexing'), h('dd', null, record.seo?.noindex ? 'noindex' : 'index'))) : null);
}
