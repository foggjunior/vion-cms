// Local preview site: shows ONLY published snapshots. This is what "publish" means in this prototype —
// visibility here, never deployment to the live website. Published site settings provide the company summary
// and footer (or an explicit "no published settings" state); the team grid follows the published lineup.
import { h, icon, linkButton } from '../components/dom.js';
import { MediaUrlScope } from '../components/media.js';
import { notice } from '../components/feedback.js';
import { createResolver, renderCard, renderRecordPage } from './preview.js';
import { compareOptionalNumber } from './shared/records.js';
import { SETTINGS_ID, publishedTeam } from './shared/site.js';
import { companySummary, fallbackFooter, footerPreview, memberPage, teamGrid } from './site-preview.js';
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
  const settings = ctx.sitePublished.get(SETTINGS_ID)?.snapshot || null;
  const siteOpts = { scope, assets: ctx.assets };
  const footer = () => h('div', { class: 'site-section' }, h('h2', null, 'Footer'), settings ? footerPreview(settings, siteOpts) : fallbackFooter());
  const frame = (...children) => h('div', { class: 'site-view' },
    h('div', { class: 'view-head' }, h('div', null, h('div', { class: 'eyebrow' }, 'LOCAL PREVIEW SITE'), h('h1', { tabindex: '-1' }, children.shift()),
      h('p', { class: 'view-intro' }, 'Only published snapshots appear here. This is not the live website and nothing is deployed.'))),
    toolNav('site'), ...children, footer());
  const result = (el, title) => ({ el, title, breadcrumb: 'Local preview site', mounted() { el.querySelector('h1').focus({ preventScroll: true }); }, destroy() { scope.revokeAll(); } });
  const team = () => publishedTeam(ctx).map(pub => ({ member: pub.snapshot, href: `#/site/team/${pub.id}` }));
  const teamEmpty = 'No team profiles are published and visible in the published team order.';

  if (!path || path === '/') {
    const group = (title, items, empty) => h('section', { class: 'site-section' }, h('h2', null, title),
      items.length ? h('div', { class: 'card-grid' }, items.map(pub => renderCard(pub.snapshot, { resolver, scope, href: `#/site${pub.route}` }))) : h('p', { class: 'muted' }, empty));
    const tours = published.filter(p => p.kind === 'tour')
      .sort((a, b) => Number(b.snapshot.featured) - Number(a.snapshot.featured) || compareOptionalNumber('recommendedRank')(env(a), env(b)) || byTitle(a, b));
    const destinations = published.filter(p => p.kind === 'destination').sort((a, b) => compareOptionalNumber('order')(env(a), env(b)) || byTitle(a, b));
    const accommodations = published.filter(p => p.kind === 'accommodation' && publicPage(p)).sort(byTitle);
    return result(frame('Published content',
      h('section', { class: 'site-section' }, h('h2', null, 'Company and contact'),
        settings ? companySummary(settings, siteOpts) : h('div', { class: 'empty-state panel' }, h('span', null, icon('settings')), h('strong', null, 'No published site settings'),
          h('p', null, 'Company and contact details appear here after Site settings are published locally. No business details are assumed.'), linkButton('Open Setting Options', '#/settings'))),
      group('Tours', tours, 'No published tours.'),
      group('Destinations', destinations, 'No published destinations.'),
      group('Accommodations', accommodations, 'No published accommodations with an enabled public page.'),
      h('section', { class: 'site-section' }, h('h2', null, h('a', { href: '#/site/team' }, 'Team')), teamGrid(team(), { ...siteOpts, empty: teamEmpty }))), 'Local preview site');
  }

  if (path === '/team' || path === '/team/') {
    return result(frame('Team', h('p', { class: 'muted' }, 'Published profiles in the published display order. Hidden and unpublished profiles are not shown.'), teamGrid(team(), { ...siteOpts, empty: teamEmpty })), 'Team · Local preview site');
  }
  const teamMatch = path.match(/^\/team\/([0-9a-f-]{36})$/i);
  if (teamMatch) {
    const memberPub = publishedTeam(ctx).find(p => p.id === teamMatch[1].toLowerCase());
    if (!memberPub) {
      return result(frame('Not visible in local preview', h('div', { class: 'panel empty-panel' }, icon('alert'),
        h('p', null, 'This team profile is not on the published team page (it may be unpublished, hidden or not yet in the published order).'), linkButton('Back to team', '#/site/team'))), 'Not visible');
    }
    return result(frame(memberPub.snapshot.name, h('p', null, h('a', { class: 'back-link', href: '#/site/team' }, icon('back'), 'Team')),
      h('div', { class: 'preview-frame' }, memberPage(memberPub.snapshot, siteOpts))), memberPub.snapshot.name);
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
