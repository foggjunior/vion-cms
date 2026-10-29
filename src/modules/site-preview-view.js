// Previews for site settings, team profiles and the team page. They render saved drafts or published
// snapshots from storage (never unsaved form state) and always say which one is shown.
import { h, icon, linkButton } from '../components/dom.js';
import { MediaUrlScope } from '../components/media.js';
import { notice } from '../components/feedback.js';
import { SETTINGS_ID, draftTeam, hasDraftChanges, publishedTeam, teamPageStatus } from './shared/site.js';
import { hasUnpublishedChanges } from './shared/records.js';
import { companySummary, fallbackFooter, footerPreview, memberPage, seoMetadataPreview, teamCard, teamGrid } from './site-preview.js';
import { siteNav } from './team-list-view.js';
import { formatDateTime } from './shared/format.js';

function switcher(base, rev, hasPublished) {
  return h('div', { class: 'segmented', role: 'group', 'aria-label': 'Choose version' },
    h('a', { href: `${base}?rev=draft`, class: rev === 'draft' ? 'is-active' : '', 'aria-current': rev === 'draft' ? 'page' : null }, 'Saved draft'),
    hasPublished ? h('a', { href: `${base}?rev=published`, class: rev === 'published' ? 'is-active' : '', 'aria-current': rev === 'published' ? 'page' : null }, 'Published')
      : h('span', { class: 'is-disabled', title: 'Not published' }, 'Published'));
}

const result = (el, title, extra) => ({ el, mounted() { el.querySelector('h1').focus({ preventScroll: true }); }, title, navGroup: 'Settings', ...extra });

export async function createSettingsPreviewView({ app, params }) {
  const ws = await app.workspace();
  const ctx = await ws.loadContext();
  const env = ctx.siteRecords.get(SETTINGS_ID);
  const pub = ctx.sitePublished.get(SETTINGS_ID);
  const rev = params.get('rev') === 'draft' || !pub ? 'draft' : 'published';
  const scope = new MediaUrlScope(ws.media);
  const opts = { scope, assets: ctx.assets };
  const head = h('div', { class: 'view-head' },
    h('div', null, h('a', { class: 'back-link', href: '#/settings' }, icon('back'), 'Back to settings'), h('h1', { tabindex: '-1' }, 'Preview: site settings')),
    switcher('#/settings/preview', rev, !!pub));
  if (!env) {
    const el = h('div', { class: 'preview-view' }, head, siteNav(null),
      h('div', { class: 'panel empty-panel' }, icon('settings'), h('p', null, 'No site settings have been saved yet. Nothing is assumed: the local preview site shows an explicit “no published settings” state.'), fallbackFooter(), linkButton('Open settings', '#/settings', { variant: 'primary' })));
    return result(el, 'Preview · Site settings', { breadcrumb: 'Settings / Preview', navLabel: 'Setting Options', destroy() { scope.revokeAll(); } });
  }
  const s = rev === 'published' ? pub.snapshot : env.record;
  const banner = rev === 'published'
    ? notice('info', h('strong', null, 'Published settings'), ` · revision ${pub.revision} · published ${formatDateTime(pub.publishedAt)}. `, hasUnpublishedChanges(env) ? 'The saved draft has newer changes that are NOT shown here until they are published.' : 'Matches the saved draft.')
    : notice('warning', h('strong', null, 'Saved draft preview'), ` · version ${env.record.version} · saved ${formatDateTime(env.record.updatedAt)}. `, pub ? 'The local preview site still shows the published settings.' : 'Not published — the local preview site shows its “no published settings” state.');
  const el = h('div', { class: 'preview-view' }, head, siteNav(null), banner,
    h('div', { class: 'preview-frame site-settings-preview' },
      h('section', { class: 'preview-section' }, h('h2', null, 'Company and contact summary'), companySummary(s, opts)),
      h('section', { class: 'preview-section' }, h('h2', null, 'Footer preview'), footerPreview(s, opts)),
      h('section', { class: 'preview-section' }, h('h2', null, 'Default SEO metadata (local preview)'), seoMetadataPreview(s, opts))),
    notice('info', 'Local preview only. The real Vion website, its footer and production SEO are not changed by saving or publishing here.'));
  return result(el, 'Preview · Site settings', { breadcrumb: 'Settings / Preview', navLabel: 'Setting Options', destroy() { scope.revokeAll(); } });
}

export async function createMemberPreviewView({ app, id, params }) {
  const ws = await app.workspace();
  const ctx = await ws.loadContext();
  const env = ctx.siteRecords.get(id);
  const scope = new MediaUrlScope(ws.media);
  if (!env || env.kind !== 'teamMember') {
    const el = h('div', { class: 'panel empty-panel' }, h('h1', { tabindex: '-1' }, 'Nothing to preview'), h('p', null, 'This profile does not exist in this browser.'), linkButton('Back to team', '#/team'));
    return result(el, 'Preview', { breadcrumb: 'Settings / Team / Preview', navLabel: 'Team' });
  }
  const pub = ctx.sitePublished.get(id);
  const rev = params.get('rev') === 'draft' || !pub ? 'draft' : 'published';
  const member = rev === 'published' ? pub.snapshot : env.record;
  const opts = { scope, assets: ctx.assets };
  const status = teamPageStatus(id, ctx);
  const banner = rev === 'published'
    ? notice('info', h('strong', null, 'Published profile'), ` · revision ${pub.revision} · published ${formatDateTime(pub.publishedAt)}. `, hasUnpublishedChanges(env) ? 'The saved draft has newer changes that are NOT shown here until they are published.' : 'Matches the saved draft.')
    : notice('warning', h('strong', null, 'Saved draft preview'), ` · version ${env.record.version} · saved ${formatDateTime(env.record.updatedAt)}. `, env.record.status === 'archived' ? 'Archived — not on the local team page.' : pub ? 'The local team page still shows the published profile.' : 'Not published — not on the local team page.');
  const el = h('div', { class: 'preview-view' },
    h('div', { class: 'view-head' },
      h('div', null, h('a', { class: 'back-link', href: `#/team/${id}` }, icon('back'), 'Back to editor'), h('h1', { tabindex: '-1' }, `Preview: ${member.name}`)),
      switcher(`#/team/${id}/preview`, rev, !!pub)),
    banner,
    notice(status.onPage ? 'success' : 'info', h('strong', null, 'Team page: '), status.reason),
    h('div', { class: 'preview-layout' },
      h('aside', { class: 'preview-aside' }, h('h2', { class: 'group-title' }, 'Team grid card'), teamCard(member, opts)),
      h('div', { class: 'preview-frame' }, memberPage(member, opts))));
  return result(el, `Preview · ${member.name}`, { breadcrumb: 'Settings / Team / Preview', navLabel: 'Team', destroy() { scope.revokeAll(); } });
}

// Draft: draft lineup order with working drafts (hidden/unpublished flagged). Published: what the local site shows.
export async function createTeamPagePreviewView({ app, params }) {
  const ws = await app.workspace();
  const ctx = await ws.loadContext();
  const scope = new MediaUrlScope(ws.media);
  const opts = { scope, assets: ctx.assets };
  const rev = params.get('rev') === 'draft' ? 'draft' : 'published';
  let grid;
  let banner;
  if (rev === 'published') {
    const items = publishedTeam(ctx).map(pub => ({ member: pub.snapshot, href: `#/site/team/${pub.id}` }));
    banner = notice('info', h('strong', null, 'Published team page'), ' · published order and visibility with published profiles — exactly what the local preview site shows.', hasDraftChanges(ctx) ? ' Draft order, visibility or profile changes are NOT shown here until they are published.' : '');
    grid = teamGrid(items, { ...opts, empty: 'No published, visible profiles in the published team order yet.' });
  } else {
    const items = draftTeam(ctx).filter(e => e.env).map(e => ({
      member: e.env.record, href: `#/team/${e.memberId}/preview?rev=draft`,
      flags: [!e.visible && { tone: 'archived', text: 'Hidden' }, !e.published && { tone: 'draft', text: 'Not published' }, e.env && hasUnpublishedChanges(e.env) && { tone: 'changes', text: 'Unpublished changes' }].filter(Boolean)
    }));
    banner = notice('warning', h('strong', null, 'Draft team page'), ' · draft order with saved drafts, including hidden and unpublished profiles (flagged). The local preview site does not show this until profiles and the order are published.');
    grid = teamGrid(items, { ...opts, empty: 'No profiles in the draft team order yet.' });
  }
  const el = h('div', { class: 'preview-view' },
    h('div', { class: 'view-head' },
      h('div', null, h('a', { class: 'back-link', href: '#/team' }, icon('back'), 'Back to team'), h('h1', { tabindex: '-1' }, `Team page preview (${rev === 'draft' ? 'draft' : 'published'})`)),
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Choose version' },
        h('a', { href: '#/team/preview?rev=draft', class: rev === 'draft' ? 'is-active' : '', 'aria-current': rev === 'draft' ? 'page' : null }, 'Draft'),
        h('a', { href: '#/team/preview?rev=published', class: rev === 'published' ? 'is-active' : '', 'aria-current': rev === 'published' ? 'page' : null }, 'Published'))),
    siteNav('team-preview'), banner, grid);
  return result(el, 'Team page preview', { breadcrumb: 'Settings / Team / Team page preview', navLabel: 'Team', destroy() { scope.revokeAll(); } });
}
