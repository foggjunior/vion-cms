// Local preview site: shows ONLY published snapshots. This is what "publish" means in this prototype —
// visibility here, never deployment to the live website.
import { h, icon, linkButton } from '../components/dom.js';
import { MediaUrlScope } from '../components/media.js';
import { notice } from '../components/feedback.js';
import { createResolver, renderCard, renderRecordPage } from './preview.js';
import { compareOptionalNumber } from './shared/records.js';
import { toolNav } from './list-view.js';

const publicPage = pub => pub.kind !== 'accommodation' || pub.snapshot.publicPageEnabled !== false;
const env = pub => ({ record: pub.snapshot });
const byTitle = (a, b) => a.snapshot.title.localeCompare(b.snapshot.title) || a.id.localeCompare(b.id);

export async function createSiteView({ app, path }) {
  const ws = await app.workspace();
  const ctx = await ws.loadContext();
  const resolver = createResolver(ctx, 'published');
  const scope = new MediaUrlScope(ws.media);
  const linkFor = ref => (ref.visible && ref.route && (ref.kind !== 'accommodation' || ref.record.publicPageEnabled !== false) ? `#/site${ref.route}` : null);
  const published = [...ctx.published.values()];
  const frame = (...children) => h('div', { class: 'site-view' },
    h('div', { class: 'view-head' }, h('div', null, h('div', { class: 'eyebrow' }, 'LOCAL PREVIEW SITE'), h('h1', { tabindex: '-1' }, children.shift()),
      h('p', { class: 'view-intro' }, 'Only published snapshots appear here. This is not the live website and nothing is deployed.'))),
    toolNav('site'), ...children);
  const result = (el, title) => ({ el, title, breadcrumb: 'Local preview site', mounted() { el.querySelector('h1').focus({ preventScroll: true }); }, destroy() { scope.revokeAll(); } });

  if (!path || path === '/') {
    const group = (title, items, empty) => h('section', { class: 'site-section' }, h('h2', null, title),
      items.length ? h('div', { class: 'card-grid' }, items.map(pub => renderCard(pub.snapshot, { resolver, scope, href: `#/site${pub.route}` }))) : h('p', { class: 'muted' }, empty));
    const tours = published.filter(p => p.kind === 'tour')
      .sort((a, b) => Number(b.snapshot.featured) - Number(a.snapshot.featured) || compareOptionalNumber('recommendedRank')(env(a), env(b)) || byTitle(a, b));
    const destinations = published.filter(p => p.kind === 'destination').sort((a, b) => compareOptionalNumber('order')(env(a), env(b)) || byTitle(a, b));
    const accommodations = published.filter(p => p.kind === 'accommodation' && publicPage(p)).sort(byTitle);
    return result(frame('Published content',
      group('Tours', tours, 'No published tours.'),
      group('Destinations', destinations, 'No published destinations.'),
      group('Accommodations', accommodations, 'No published accommodations with an enabled public page.')), 'Local preview site');
  }

  let notes = [];
  let pub = published.find(p => p.route === path);
  if (!pub) {
    const redirect = ctx.redirects.find(r => r.from === path);
    if (redirect) {
      notes.push(notice('info', `Planned local 308 redirect: ${redirect.from} → ${redirect.to}. (Recorded for review only; no real redirect exists.)`));
      pub = published.find(p => p.route === redirect.to);
    }
  }
  if (!pub || !publicPage(pub)) {
    const el = frame('Not visible in local preview', ...notes,
      h('div', { class: 'panel empty-panel' }, icon('alert'),
        h('p', null, pub ? 'This accommodation is published but its public page is disabled (prototype setting, A3 unresolved).' : `${path} is not published. Drafts, unpublished and archived records are not visible here.`),
        linkButton('Back to published content', '#/site')));
    return result(el, 'Not visible');
  }
  const el = frame(pub.snapshot.title, ...notes,
    h('p', null, h('a', { class: 'back-link', href: '#/site' }, icon('back'), 'All published content')),
    h('div', { class: 'preview-frame' }, renderRecordPage(pub.snapshot, { resolver, scope, linkFor })));
  return result(el, pub.snapshot.title);
}
