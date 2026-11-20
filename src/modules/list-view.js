// Generic list page for a content module: search, status filter, deterministic sorting and row actions.
// Filter state lives in the URL so reload and back/forward restore it.
//
// Rows come one page at a time from ws.summaries.cataloguePage (computed on the server in the shared
// workspace, in the browser in the local preview): only the visible columns are sent, never the whole
// workspace. Searches are debounced; a response that arrives after a newer request is discarded.
import { button, clear, h, icon, linkButton } from '../components/dom.js';
import { confirmDialog, messageDialog } from '../components/dialog.js';
import { errorDetails, notice, statusBadge, toast } from '../components/feedback.js';
import { formatDateTime } from './shared/format.js';
import { LIST_DEFINITIONS, STATUS_FILTERS, sortsFor } from './shared/list-definitions.js';

export { STATUS_FILTERS };
const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 250;

export function toolNav(active) {
  const links = [['site', '#/site', 'Local preview site', 'globe'], ['media', '#/media', 'Media library', 'image'], ['taxonomies', '#/taxonomies', 'Taxonomies', 'tag'], ['redirects', '#/redirects', 'Planned redirects', 'redirect'], ['backup', '#/backup', 'Backup & import', 'database']];
  return h('nav', { class: 'tool-nav', 'aria-label': 'Local content tools' },
    links.map(([key, href, label, iconName]) => h('a', { href, class: ['tool-link', key === active && 'is-active'], 'aria-current': key === active ? 'page' : null }, icon(iconName), label)));
}

const rowBadges = row => h('span', { class: 'badge-row' }, statusBadge(row.status),
  row.unpublishedChanges ? h('span', { class: 'status-badge status-changes', title: 'The working draft differs from the published snapshot' }, 'Unpublished changes') : null);

export async function createListView({ def, app, params }) {
  const ws = await app.workspace();
  const columns = LIST_DEFINITIONS[def.kind].columns;
  const sorts = sortsFor(def.kind);
  const state = {
    q: params.get('q') || '',
    status: STATUS_FILTERS[params.get('status')] ? params.get('status') : 'active',
    sort: sorts[params.get('sort')] ? params.get('sort') : 'updated'
  };
  let rows = [], summary = null, next = null, failed = null, loading = false, sequence = 0, searchTimer = null;
  const results = h('div', { class: 'list-results', 'aria-busy': 'false' });
  const countEl = h('p', { class: 'list-count', role: 'status', 'aria-live': 'polite' });

  function syncUrl() {
    const query = new URLSearchParams();
    if (state.q) query.set('q', state.q);
    if (state.status !== 'active') query.set('status', state.status);
    if (state.sort !== 'updated') query.set('sort', state.sort);
    const qs = query.toString();
    app.replaceRoute(`#/${def.path}${qs ? `?${qs}` : ''}`);
  }

  // Loads the first page (or the next page when `append`). Only the newest request may update the screen.
  async function load({ append = false } = {}) {
    const id = ++sequence;
    loading = true; results.setAttribute('aria-busy', 'true'); render();
    try {
      const page = await ws.summaries.cataloguePage(def.kind, { q: state.q, status: state.status, sort: state.sort, after: append ? next : null, limit: PAGE_SIZE });
      if (id !== sequence) return;
      rows = append ? [...rows, ...page.rows] : page.rows;
      summary = page; next = page.next; failed = null;
    } catch (err) {
      if (id !== sequence) return;
      failed = err;
    } finally {
      if (id === sequence) { loading = false; results.setAttribute('aria-busy', 'false'); render(); }
    }
  }
  const reload = () => load();

  async function archive(row) {
    const ok = await confirmDialog({
      title: `Archive “${row.title}”?`,
      body: `${row.status === 'published' ? 'It will be removed from the local preview. ' : ''}The record, images and route history are kept and the slug stays reserved. You can restore it to draft later.`,
      confirmLabel: 'Archive', danger: true
    });
    if (!ok) return;
    try {
      await ws.content.archive(row.id, { expectedVersion: row.version });
      toast(`Archived “${row.title}”.`);
    } catch (err) {
      await messageDialog({ title: 'Not archived', body: errorDetails(err) });
    }
    await reload();
  }

  async function restore(row) {
    try {
      await ws.content.restore(row.id, { expectedVersion: row.version });
      toast(`Restored “${row.title}” to draft. Publish it again when ready.`);
    } catch (err) {
      await messageDialog({ title: 'Not restored', body: errorDetails(err) });
    }
    await reload();
  }

  async function duplicate(row) {
    try {
      const copy = await ws.content.duplicate(row.id);
      toast(`Created draft copy “${copy.record.title}”.`);
      app.navigate(`#/${def.path}/${copy.id}`);
    } catch (err) {
      await messageDialog({ title: 'Not duplicated', body: errorDetails(err) });
    }
  }

  function render() {
    clear(results);
    if (failed) {
      countEl.textContent = '';
      results.append(notice('error', h('strong', null, `${def.plural} could not be loaded. `), errorDetails(failed), ' ', button('Try again', { variant: 'secondary', onClick: () => load() })));
      return;
    }
    if (!summary) {
      countEl.textContent = '';
      results.append(h('p', { class: 'muted' }, `Loading ${def.plural.toLowerCase()}…`));
      return;
    }
    const { counts, total, filtered } = summary;
    const shown = rows.length < filtered ? `${rows.length} of ${filtered} shown` : `${filtered} shown`;
    countEl.textContent = `${shown} · ${total} total (${counts.published || 0} published, ${counts.draft || 0} draft, ${counts.archived || 0} archived)${loading ? ' · updating…' : ''}`;
    if (!total) {
      results.append(h('div', { class: 'empty-state panel' }, h('span', null, icon(def.icon)), h('strong', null, `No ${def.plural.toLowerCase()} yet`),
        h('p', null, `Create the first ${def.label.toLowerCase()}. Only a title is needed to save a draft.`),
        linkButton(def.addLabel, `#/${def.path}/new`, { variant: 'primary', iconName: 'plus' })));
      return;
    }
    if (!rows.length) {
      results.append(h('div', { class: 'empty-state panel' }, h('span', null, icon('search')), h('strong', null, `No ${def.plural.toLowerCase()} match these filters`),
        h('p', null, 'Change the search text or status filter.'),
        button('Clear filters', { onClick: () => { state.q = ''; state.status = 'active'; searchInput.value = ''; statusSelect.value = 'active'; syncUrl(); load(); } })));
      return;
    }
    results.append(h('div', { class: 'table-scroll panel table-panel' }, h('table', { class: 'data-table' },
      h('caption', { class: 'visually-hidden' }, `${def.plural}: ${STATUS_FILTERS[state.status].label}, sorted by ${sorts[state.sort].label}`),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Title'), h('th', { scope: 'col' }, 'Status'), columns.map(c => h('th', { scope: 'col' }, c.label)), h('th', { scope: 'col' }, 'Updated (EAT)'), h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Actions')))),
      h('tbody', null, rows.map(row => h('tr', null,
        h('td', { class: 'cell-title' }, h('a', { href: `#/${def.path}/${row.id}` }, row.title), h('small', null, row.route || 'No slug yet'),
          row.publicName ? h('small', null, `Public: ${row.publicName}`) : null),
        h('td', null, rowBadges(row)),
        row.cells.map(cell => h('td', null, cell)),
        h('td', null, formatDateTime(row.updatedAt)),
        h('td', { class: 'row-actions' },
          linkButton('Edit', `#/${def.path}/${row.id}`, { variant: 'ghost', 'aria-label': `Edit ${row.title}` }),
          linkButton('Preview', `#/${def.path}/${row.id}/preview`, { variant: 'ghost', 'aria-label': `Preview ${row.title}` }),
          button('Duplicate', { variant: 'ghost', 'aria-label': `Duplicate ${row.title}`, onClick: () => duplicate(row) }),
          row.status === 'archived'
            ? button('Restore', { variant: 'ghost', 'aria-label': `Restore ${row.title} to draft`, onClick: () => restore(row) })
            : button('Archive', { variant: 'ghost-danger', 'aria-label': `Archive ${row.title}`, onClick: () => archive(row) }))))))));
    if (next) results.append(h('div', { class: 'btn-row list-more' }, button(loading ? 'Loading…' : `Show more (${filtered - rows.length} more)`, { variant: 'secondary', disabled: loading, onClick: () => load({ append: true }) })));
  }

  const searchInput = h('input', { id: `${def.path}-search`, type: 'search', class: 'input', value: state.q, placeholder: `Search ${def.plural.toLowerCase()} by title or slug`, on: { input: e => { state.q = e.target.value; syncUrl(); clearTimeout(searchTimer); searchTimer = setTimeout(() => load(), SEARCH_DELAY_MS); } } });
  const statusSelect = h('select', { id: `${def.path}-status`, class: 'input', on: { change: e => { state.status = e.target.value; syncUrl(); load(); } } },
    Object.entries(STATUS_FILTERS).map(([value, f]) => h('option', { value }, f.label)));
  statusSelect.value = state.status;
  const sortSelect = h('select', { id: `${def.path}-sort`, class: 'input', on: { change: e => { state.sort = e.target.value; syncUrl(); load(); } } },
    Object.entries(sorts).map(([value, s]) => h('option', { value }, s.label)));
  sortSelect.value = state.sort;

  const offEvents = ws.events.on(event => { if (event.remote) reload(); });
  const el = h('div', { class: 'list-view' },
    h('div', { class: 'view-head' },
      h('div', null, h('div', { class: 'eyebrow' }, 'LOCAL CONTENT PROTOTYPE'), h('h1', { tabindex: '-1' }, def.plural), h('p', { class: 'view-intro' }, def.intro)),
      linkButton(def.addLabel, `#/${def.path}/new`, { variant: 'primary', iconName: 'plus' })),
    toolNav(null),
    def.listExtras?.() || null,
    h('div', { class: 'list-toolbar panel', role: 'search' },
      h('div', { class: 'field' }, h('label', { for: searchInput.id, class: 'field-label' }, 'Search'), searchInput),
      h('div', { class: 'field' }, h('label', { for: statusSelect.id, class: 'field-label' }, 'Status'), statusSelect),
      h('div', { class: 'field' }, h('label', { for: sortSelect.id, class: 'field-label' }, 'Sort by'), sortSelect)),
    countEl,
    results);
  // The first page is loaded before the view is mounted, so direct links and reloads render complete.
  await load();
  return {
    el, title: def.plural, breadcrumb: `${def.navGroup} / ${def.listLabel}`, navGroup: def.navGroup, navLabel: def.listLabel,
    mounted() { el.querySelector('h1').focus({ preventScroll: true }); },
    destroy() { offEvents(); clearTimeout(searchTimer); sequence++; }
  };
}
