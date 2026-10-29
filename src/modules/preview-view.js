// Record preview: renders the saved draft or the isolated published snapshot, never unsaved form state.
import { h, icon, linkButton } from '../components/dom.js';
import { MediaUrlScope } from '../components/media.js';
import { notice } from '../components/feedback.js';
import { createResolver, renderCard, renderRecordPage } from './preview.js';
import { hasUnpublishedChanges, publicName } from './shared/records.js';
import { formatDateTime } from './shared/format.js';

export async function createPreviewView({ def, id, app, params }) {
  const ws = await app.workspace();
  const ctx = await ws.loadContext();
  const env = ctx.records.get(id);
  if (!env || env.kind !== def.kind) {
    return { el: h('div', { class: 'panel empty-panel' }, h('h1', { tabindex: '-1' }, 'Nothing to preview'), h('p', null, 'This record does not exist in this browser.'), linkButton(`Back to ${def.plural.toLowerCase()}`, `#/${def.path}`)), title: 'Preview', navGroup: def.navGroup, navLabel: def.listLabel, breadcrumb: `${def.navGroup} / Preview` };
  }
  const pub = ctx.published.get(id);
  const rev = params.get('rev') === 'draft' || !pub ? 'draft' : 'published';
  const record = rev === 'published' ? pub.snapshot : env.record;
  const resolver = createResolver(ctx, rev);
  const scope = new MediaUrlScope(ws.media);
  const siteHref = ref => (rev === 'published' && ref.route ? `#/site${ref.route}` : null);

  const banner = rev === 'published'
    ? notice('info', h('strong', null, 'Published snapshot'), ` · revision ${pub.revision} · published ${formatDateTime(pub.publishedAt)} · local route ${pub.route}. `,
      hasUnpublishedChanges(env) ? 'The working draft has newer changes that are NOT shown here until they are published.' : 'Matches the saved draft.')
    : notice('warning', h('strong', null, 'Saved draft preview'), ` · version ${env.record.version} · saved ${formatDateTime(env.record.updatedAt)}. `,
      env.record.status === 'archived' ? 'Archived — not visible on the local preview site.' : pub ? 'The local preview site still shows the published snapshot.' : 'Not published — not visible on the local preview site.');

  const el = h('div', { class: 'preview-view' },
    h('div', { class: 'view-head' },
      h('div', null,
        h('a', { class: 'back-link', href: `#/${def.path}/${id}` }, icon('back'), 'Back to editor'),
        h('h1', { tabindex: '-1' }, `Preview: ${publicName(record)}`)),
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Choose version' },
        h('a', { href: `#/${def.path}/${id}/preview?rev=draft`, class: rev === 'draft' ? 'is-active' : '', 'aria-current': rev === 'draft' ? 'page' : null }, 'Saved draft'),
        pub ? h('a', { href: `#/${def.path}/${id}/preview?rev=published`, class: rev === 'published' ? 'is-active' : '', 'aria-current': rev === 'published' ? 'page' : null }, 'Published snapshot')
          : h('span', { class: 'is-disabled', title: 'Not published' }, 'Published snapshot'))),
    banner,
    h('div', { class: 'preview-layout' },
      h('aside', { class: 'preview-aside' }, h('h2', { class: 'group-title' }, 'Listing card'), renderCard(record, { resolver, scope })),
      h('div', { class: 'preview-frame' }, renderRecordPage(record, { resolver, scope, linkFor: siteHref, showSeo: true }))));
  return {
    el, title: `Preview · ${publicName(record)}`, navGroup: def.navGroup, navLabel: def.listLabel, breadcrumb: `${def.navGroup} / Preview`,
    mounted() { el.querySelector('h1').focus({ preventScroll: true }); },
    destroy() { scope.revokeAll(); }
  };
}
