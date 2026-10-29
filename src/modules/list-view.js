// Generic list page for a content module: search, status filter, deterministic sorting and row actions.
// Filter state lives in the URL so reload and back/forward restore it.
import { button, clear, h, icon, linkButton } from '../components/dom.js';
import { confirmDialog, messageDialog } from '../components/dialog.js';
import { envelopeBadges, errorDetails, toast } from '../components/feedback.js';
import { hasUnpublishedChanges, publicName } from './shared/records.js';
import { routeFor } from './shared/routes.js';
import { comparePricing } from './shared/pricing.js';
import { formatDateTime } from './shared/format.js';

export const STATUS_FILTERS = {
  active: { label: 'Active (draft + published)', test: env => env.record.status !== 'archived' },
  draft: { label: 'Drafts', test: env => env.record.status === 'draft' },
  published: { label: 'Published', test: env => env.record.status === 'published' },
  changes: { label: 'Published with unpublished changes', test: hasUnpublishedChanges },
  archived: { label: 'Archived', test: env => env.record.status === 'archived' },
  all: { label: 'All records', test: () => true }
};

const byTitle = (a, b) => a.record.title.localeCompare(b.record.title, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id);
const BASE_SORTS = {
  updated: { label: 'Last updated', compare: (a, b) => b.record.updatedAt.localeCompare(a.record.updatedAt) },
  title: { label: 'Title A–Z', compare: () => 0 }
};

export function toolNav(active) {
  const links = [['site', '#/site', 'Local preview site', 'globe'], ['media', '#/media', 'Media library', 'image'], ['taxonomies', '#/taxonomies', 'Tour taxonomies', 'tag'], ['redirects', '#/redirects', 'Planned redirects', 'redirect'], ['backup', '#/backup', 'Backup & import', 'database']];
  return h('nav', { class: 'tool-nav', 'aria-label': 'Local content tools' },
    links.map(([key, href, label, iconName]) => h('a', { href, class: ['tool-link', key === active && 'is-active'], 'aria-current': key === active ? 'page' : null }, icon(iconName), label)));
}

export async function createListView({ def, app, params }) {
  const ws = await app.workspace();
  let ctx = await ws.loadContext();
  const sorts = { ...BASE_SORTS, ...def.sorts };
  const state = {
    q: params.get('q') || '',
    status: STATUS_FILTERS[params.get('status')] ? params.get('status') : 'active',
    sort: sorts[params.get('sort')] ? params.get('sort') : 'updated'
  };
  const results = h('div', { class: 'list-results' });
  const countEl = h('p', { class: 'list-count', role: 'status', 'aria-live': 'polite' });
  const all = () => [...ctx.records.values()].filter(env => env.kind === def.kind);

  function syncUrl() {
    const query = new URLSearchParams();
    if (state.q) query.set('q', state.q);
    if (state.status !== 'active') query.set('status', state.status);
    if (state.sort !== 'updated') query.set('sort', state.sort);
    const qs = query.toString();
    app.replaceRoute(`#/${def.path}${qs ? `?${qs}` : ''}`);
  }

  function rows() {
    const term = state.q.trim().toLowerCase();
    const sort = sorts[state.sort];
    const compare = state.sort === 'price' ? (a, b) => comparePricing(a.record.pricing, b.record.pricing) : sort.compare;
    return all()
      .filter(STATUS_FILTERS[state.status].test)
      .filter(env => !term || def.searchText(env).toLowerCase().includes(term))
      .sort((a, b) => compare(a, b) || byTitle(a, b));
  }

  async function reload() {
    ctx = await ws.loadContext();
    render();
  }

  async function archive(env) {
    const ok = await confirmDialog({
      title: `Archive “${env.record.title}”?`,
      body: `${env.record.status === 'published' ? 'It will be removed from the local preview. ' : ''}The record, images and route history are kept and the slug stays reserved. You can restore it to draft later.`,
      confirmLabel: 'Archive', danger: true
    });
    if (!ok) return;
    try {
      await ws.content.archive(env.id, { expectedVersion: env.record.version });
      toast(`Archived “${env.record.title}”.`);
    } catch (err) {
      await messageDialog({ title: 'Not archived', body: errorDetails(err) });
    }
    await reload();
  }

  async function restore(env) {
    try {
      await ws.content.restore(env.id, { expectedVersion: env.record.version });
      toast(`Restored “${env.record.title}” to draft. Publish it again when ready.`);
    } catch (err) {
      await messageDialog({ title: 'Not restored', body: errorDetails(err) });
    }
    await reload();
  }

  async function duplicate(env) {
    try {
      const copy = await ws.content.duplicate(env.id);
      toast(`Created draft copy “${copy.record.title}”.`);
      app.navigate(`#/${def.path}/${copy.id}`);
    } catch (err) {
      await messageDialog({ title: 'Not duplicated', body: errorDetails(err) });
    }
  }

  function render() {
    const list = rows();
    const everything = all();
    const counts = { published: 0, draft: 0, archived: 0 };
    for (const env of everything) counts[env.record.status] += 1;
    countEl.textContent = `${list.length} shown · ${everything.length} total (${counts.published} published, ${counts.draft} draft, ${counts.archived} archived)`;
    clear(results);
    if (!everything.length) {
      results.append(h('div', { class: 'empty-state panel' }, h('span', null, icon(def.icon)), h('strong', null, `No ${def.plural.toLowerCase()} yet`),
        h('p', null, `Create the first ${def.label.toLowerCase()}. Only a title is needed to save a draft.`),
        linkButton(def.addLabel, `#/${def.path}/new`, { variant: 'primary', iconName: 'plus' })));
      return;
    }
    if (!list.length) {
      results.append(h('div', { class: 'empty-state panel' }, h('span', null, icon('search')), h('strong', null, `No ${def.plural.toLowerCase()} match these filters`),
        h('p', null, 'Change the search text or status filter.'),
        button('Clear filters', { onClick: () => { state.q = ''; state.status = 'active'; searchInput.value = ''; statusSelect.value = 'active'; syncUrl(); render(); } })));
      return;
    }
    results.append(h('div', { class: 'table-scroll panel table-panel' }, h('table', { class: 'data-table' },
      h('caption', { class: 'visually-hidden' }, `${def.plural}: ${STATUS_FILTERS[state.status].label}, sorted by ${sorts[state.sort].label}`),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Title'), h('th', { scope: 'col' }, 'Status'), def.columns.map(c => h('th', { scope: 'col' }, c.label)), h('th', { scope: 'col' }, 'Updated (EAT)'), h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Actions')))),
      h('tbody', null, list.map(env => h('tr', null,
        h('td', { class: 'cell-title' }, h('a', { href: `#/${def.path}/${env.id}` }, env.record.title), h('small', null, routeFor(env.kind, env.record.slug) || 'No slug yet'),
          def.kind === 'destination' && publicName(env.record) !== env.record.title ? h('small', null, `Public: ${publicName(env.record)}`) : null),
        h('td', null, envelopeBadges(env)),
        def.columns.map(c => h('td', null, c.cell(env, ctx))),
        h('td', null, formatDateTime(env.record.updatedAt)),
        h('td', { class: 'row-actions' },
          linkButton('Edit', `#/${def.path}/${env.id}`, { variant: 'ghost', 'aria-label': `Edit ${env.record.title}` }),
          linkButton('Preview', `#/${def.path}/${env.id}/preview`, { variant: 'ghost', 'aria-label': `Preview ${env.record.title}` }),
          button('Duplicate', { variant: 'ghost', 'aria-label': `Duplicate ${env.record.title}`, onClick: () => duplicate(env) }),
          env.record.status === 'archived'
            ? button('Restore', { variant: 'ghost', 'aria-label': `Restore ${env.record.title} to draft`, onClick: () => restore(env) })
            : button('Archive', { variant: 'ghost-danger', 'aria-label': `Archive ${env.record.title}`, onClick: () => archive(env) }))))))));
  }

  const searchInput = h('input', { id: `${def.path}-search`, type: 'search', class: 'input', value: state.q, placeholder: `Search ${def.plural.toLowerCase()} by title or slug`, on: { input: e => { state.q = e.target.value; syncUrl(); render(); } } });
  const statusSelect = h('select', { id: `${def.path}-status`, class: 'input', on: { change: e => { state.status = e.target.value; syncUrl(); render(); } } },
    Object.entries(STATUS_FILTERS).map(([value, f]) => h('option', { value }, f.label)));
  statusSelect.value = state.status;
  const sortSelect = h('select', { id: `${def.path}-sort`, class: 'input', on: { change: e => { state.sort = e.target.value; syncUrl(); render(); } } },
    Object.entries(sorts).map(([value, s]) => h('option', { value }, s.label)));
  sortSelect.value = state.sort;

  const offEvents = ws.events.on(event => { if (event.remote) reload(); });
  const el = h('div', { class: 'list-view' },
    h('div', { class: 'view-head' },
      h('div', null, h('div', { class: 'eyebrow' }, 'LOCAL CONTENT PROTOTYPE'), h('h1', { tabindex: '-1' }, def.plural), h('p', { class: 'view-intro' }, def.intro)),
      linkButton(def.addLabel, `#/${def.path}/new`, { variant: 'primary', iconName: 'plus' })),
    toolNav(null),
    h('div', { class: 'list-toolbar panel', role: 'search' },
      h('div', { class: 'field' }, h('label', { for: searchInput.id, class: 'field-label' }, 'Search'), searchInput),
      h('div', { class: 'field' }, h('label', { for: statusSelect.id, class: 'field-label' }, 'Status'), statusSelect),
      h('div', { class: 'field' }, h('label', { for: sortSelect.id, class: 'field-label' }, 'Sort by'), sortSelect)),
    countEl,
    results);
  render();
  return {
    el, title: def.plural, breadcrumb: `${def.navGroup} / ${def.listLabel}`, navGroup: def.navGroup, navLabel: def.listLabel,
    mounted() { el.querySelector('h1').focus({ preventScroll: true }); },
    destroy() { offEvents(); }
  };
}
