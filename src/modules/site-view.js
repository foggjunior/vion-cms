import {reviewPublic} from '../review/public.js';
import {createReviewRepository} from '../review/repository.js';
// Local preview site: shows ONLY published snapshots. This is what "publish" means in this prototype —
// visibility here, never deployment to the live website. Published site settings provide the company summary
// and footer (or an explicit "no published settings" state); the team grid follows the published lineup;
// term labels come from the published taxonomy. Public-pattern paths follow the route registry in
// shared/routes.js and are shown under #/site (for example #/site/tours/day-trips?filter=tag&value=<key>).
// These hash URLs and the planned redirects are local review aids, not production HTTP routes or redirects.
import { h, icon, linkButton } from '../components/dom.js';
import { MediaUrlScope } from '../components/media.js';
import { notice } from '../components/feedback.js';
import { createResolver, renderCard, renderRecordPage } from './preview.js';
import { compareOptionalNumber } from './shared/records.js';
import { HUB_ROUTES } from './shared/routes.js';
import { TAG_FILTER, compareDayTrips, filterDayTrips } from './shared/day-trips.js';
import { namespaceTerms } from './shared/taxonomy.js';
import { SETTINGS_ID, publishedTeam } from './shared/site.js';
import { companySummary, fallbackFooter, footerPreview, memberPage, teamGrid } from './site-preview.js';
import { toolNav } from './list-view.js';

const publicPage = pub => pub.kind !== 'accommodation' || pub.snapshot.publicPageEnabled !== false;
const env = pub => ({ record: pub.snapshot });
const byTitle = (a, b) => a.snapshot.title.localeCompare(b.snapshot.title) || a.id.localeCompare(b.id);

const dayTripHref = (tag = null) => `#/site${HUB_ROUTES.dayTrips}${tag ? `?filter=${TAG_FILTER}&value=${encodeURIComponent(tag.key)}` : ''}`;

export async function createSiteView({ app, path, params = new URLSearchParams() }) {
  const ws = await app.workspace();
  const ctx = await ws.loadContext();
  const resolver = createResolver(ctx, 'published');
  const scope = new MediaUrlScope(ws.media);
  const linkFor = ref => (ref.visible && ref.route && (ref.kind !== 'accommodation' || ref.record.publicPageEnabled !== false) ? `#/site${ref.route}` : null);
  const published = [...ctx.published.values()];
  const editorial=await createReviewRepository(ws).list();
  const reviewContent=await reviewPublic(ws,path,scope);
  const publishedMenus=editorial.filter(e=>e.kind==='menu'&&e.published);
  const settings = ctx.sitePublished.get(SETTINGS_ID)?.snapshot || null;
  const siteOpts = { scope, assets: ctx.assets };
  const footer = () => h('div', { class: 'site-section' }, h('nav',{class:'review-public-nav'},publishedMenus.filter(e=>e.published.placement==='Footer').flatMap(e=>e.published.links.map(l=>h('a',{href:l.href.startsWith('/')?'#/site'+l.href:l.href},l.label)))),h('h2', null, 'Footer'), settings ? footerPreview(settings, siteOpts) : fallbackFooter());
  const frame = (title, ...children) => {
    const hasPageHeading = children.some(child => child?.matches?.('h1') || child?.querySelector?.('h1'));
    return h('div', { class: 'site-view' },
    h('div', { class: 'view-head' }, h('div', null, h('div', { class: 'eyebrow' }, 'LOCAL PREVIEW SITE'), h(hasPageHeading ? 'p' : 'h1', { tabindex: '-1' }, title),
      h('p', { class: 'view-intro' }, 'Only published snapshots appear here. This is not the live website and nothing is deployed.'))),
    toolNav('site'), h('nav',{class:'review-public-nav'},['/blog','/faqs','/experiences','/tanzania-migration','/give-back'].map(path=>h('a',{href:'#/site'+path},({'/blog':'Journal','/faqs':'FAQs','/experiences':'Experiences','/tanzania-migration':'Migration','/give-back':'Giving back'})[path])),publishedMenus.filter(e=>e.published.placement!=='Footer').flatMap(e=>e.published.links.map(l=>h('a',{href:l.href.startsWith('/')?'#/site'+l.href:l.href},l.label)))), ...children, footer());
  };
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
    const dayTrips = published.filter(p => p.kind === 'dayTrip').sort((a, b) => compareDayTrips(a.snapshot, b.snapshot));
    return result(frame('Published content',reviewContent,
      h('section',{class:'site-section'},h('h2',null,'Website pages'),h('div',{class:'btn-row'},editorial.filter(e=>e.published&&e.kind==='page').map(e=>linkButton(e.published.title,'#/site'+e.published.path)))),
      h('section', { class: 'site-section' }, h('h2', null, 'Company and contact'),
        settings ? companySummary(settings, siteOpts) : h('div', { class: 'empty-state panel' }, h('span', null, icon('settings')), h('strong', null, 'No published site settings'),
          h('p', null, 'Company and contact details appear here after Site settings are published locally. No business details are assumed.'), linkButton('Open Setting Options', '#/settings'))),
      group('Tours', tours, 'No published tours.'),
      h('section', { class: 'site-section' }, h('h2', null, h('a', { href: dayTripHref() }, 'Day trips')),
        dayTrips.length ? h('div', { class: 'card-grid' }, dayTrips.map(pub => renderCard(pub.snapshot, { resolver, scope, href: `#/site${pub.route}` }))) : h('p', { class: 'muted' }, 'No published day trips.')),
      group('Destinations', destinations, 'No published destinations.'),
      group('Accommodations', accommodations, 'No published accommodations with an enabled public page.'),
      h('section', { class: 'site-section' }, h('h2', null, h('a', { href: '#/site/team' }, 'Team')), teamGrid(team(), { ...siteOpts, empty: teamEmpty }))), 'Local preview site');
  }

  const catalogueKinds={'/tours':'tour','/destinations':'destination','/accommodations':'accommodation','/tours/zanzibar-trips':'tour','/tours/climbing-trips':'tour'};
  if(catalogueKinds[path]){const kind=catalogueKinds[path];let entries=published.filter(p=>p.kind===kind&&publicPage(p));if(path.endsWith('zanzibar-trips'))entries=entries.filter(p=>p.snapshot.destinationIds?.some(id=>/zanzibar/i.test(ctx.records.get(id)?.record.title||'')));if(path.endsWith('climbing-trips'))entries=entries.filter(p=>/climb|trek|mountain/i.test(ctx.publishedTerms.get(p.snapshot.typeId)?.label||'')||p.snapshot.tagIds?.some(id=>/climb|trek/i.test(ctx.publishedTerms.get(id)?.label||'')));const list=h('div',{class:'card-grid'}),search=h('input',{class:'input',type:'search','aria-label':'Search catalogue',placeholder:'Search…'});const draw=()=>{const items=entries.filter(p=>p.snapshot.title.toLowerCase().includes(search.value.toLowerCase()));list.replaceChildren(...items.map(pub=>renderCard(pub.snapshot,{resolver,scope,href:'#/site'+pub.route})),items.length?null:h('p',null,'No published content matches.'));};search.addEventListener('input',draw);draw();return result(frame(kind==='tour'?'Tours':kind==='destination'?'Destinations':'Accommodations',reviewContent,search,list),'Catalogue preview');}
  if(reviewContent&&path!==HUB_ROUTES.dayTrips)return result(frame('Website preview',reviewContent),'Website preview');

  if (path === HUB_ROUTES.dayTrips || path === `${HUB_ROUTES.dayTrips}/`) {
    const trips = published.filter(p => p.kind === 'dayTrip').map(p => p.snapshot).sort(compareDayTrips);
    const outcome = filterDayTrips(trips, params, ctx.taxonomyPublication);
    // Filter links: active published tags used by at least one published day trip (plus the one applied).
    const used = new Set(trips.flatMap(t => t.tagIds || []));
    const tags = namespaceTerms(ctx.publishedTerms.values(), 'tag').filter(t => (t.active && used.has(t.id)) || t.id === outcome.tag?.id);
    const chip = (label, href, current) => h('a', { class: ['filter-chip', current && 'is-active'], href, 'aria-current': current ? 'page' : null }, label);
    const routeOf = trip => published.find(p => p.id === trip.id).route;
    const empty = outcome.status === 'unknown-value'
      ? h('div', { class: 'empty-state panel' }, h('span', null, icon('search')), h('strong', null, 'No day trips match this filter'), h('p', null, outcome.message), linkButton('Show all day trips', dayTripHref()))
      : outcome.status === 'filtered'
        ? h('div', { class: 'empty-state panel' }, h('span', null, icon('search')), h('strong', null, `No published day trips are tagged “${outcome.tag.label}”`), linkButton('Show all day trips', dayTripHref()))
        : h('div', { class: 'empty-state panel' }, h('span', null, icon('map')), h('strong', null, 'No published day trips'), h('p', null, 'Day trips appear here once they are published locally.'));
    return result(frame('Day trips',reviewContent,
      h('p', { class: 'muted small' }, `Public pattern ${HUB_ROUTES.dayTrips}${outcome.tag ? `?filter=${TAG_FILTER}&value=${outcome.tag.key}` : ''} · local preview address #/site${HUB_ROUTES.dayTrips}${outcome.tag ? `?filter=${TAG_FILTER}&value=${outcome.tag.key}` : ''}`),
      tags.length ? h('nav', { class: 'filter-chips', 'aria-label': 'Filter day trips by tag' }, chip('All day trips', dayTripHref(), outcome.status !== 'filtered'), tags.map(tag => chip(tag.label, dayTripHref(tag), outcome.tag?.id === tag.id))) : null,
      outcome.status === 'invalid-filter' ? notice('warning', outcome.message) : null,
      h('p', { class: 'list-count', role: 'status' }, outcome.status === 'filtered' ? `${outcome.items.length} day trip${outcome.items.length === 1 ? '' : 's'} tagged “${outcome.tag.label}”` : outcome.status === 'unknown-value' ? 'Filter not recognised' : `${outcome.items.length} published day trip${outcome.items.length === 1 ? '' : 's'}`),
      outcome.items.length ? h('div', { class: 'card-grid' }, outcome.items.map(trip => renderCard(trip, { resolver, scope, href: `#/site${routeOf(trip)}` }))) : empty), 'Day trips · Local preview site');
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
    h('p', null, pub.kind === 'dayTrip' ? h('a', { class: 'back-link', href: dayTripHref() }, icon('back'), 'All day trips') : h('a', { class: 'back-link', href: '#/site' }, icon('back'), 'All published content')),
    h('div', { class: 'preview-frame' }, renderRecordPage(pub.snapshot, { resolver, scope, linkFor })));
  return result(el, pub.snapshot.title);
}
