// Tour Packages › Taxonomies: manage tour types, categories, standards and tags. Searchable per group, with
// create/edit, keyboard Move up / Move down (focus stays on the moved term) and activate/deactivate. Terms are
// never deleted in this phase. Edits change the working terms only; "Publish taxonomy changes" publishes all
// term labels, keys, order and activation for the local preview site and never publishes content records.
import { announce, append, button, clear, h, icon } from '../components/dom.js';
import { confirmDialog, messageDialog, openDialog } from '../components/dialog.js';
import { errorDetails, notice, toast } from '../components/feedback.js';
import { createTabs } from '../components/tabs.js';
import { taxonomyUsage } from './shared/records.js';
import {
  NAMESPACE_NOTES, TAXONOMY_NAMESPACES, TAXONOMY_PLURALS, TERM_KEY_MAX, TERM_LABEL_MAX, isPublishedTerm, namespaceTerms, suggestTermKey,
  taxonomyChanges, termsFingerprint
} from './shared/taxonomy.js';
import { formatDateTime, shortId } from './shared/format.js';
import { toolNav } from './list-view.js';

const STATUS = { all: 'Active and inactive', active: 'Active only', inactive: 'Inactive only' };
const ORIGIN_NOTES = {
  upgrade: ' It was created automatically when the local database was upgraded, from the terms the local site already showed.',
  import: ' It was created by importing an older backup, whose terms the local site showed directly.',
  publish: ''
};

export async function createTaxonomyView({ app, params }) {
  const ws = await app.workspace();
  let ctx = await ws.loadContext();
  const state = {
    q: params.get('q') || '',
    status: STATUS[params.get('status')] ? params.get('status') : 'all',
    group: TAXONOMY_NAMESPACES[params.get('group')] ? params.get('group') : 'type'
  };
  const publicationEl = h('section', { class: 'panel taxonomy-publication', 'aria-labelledby': 'taxonomy-publication-heading' });
  const panels = Object.fromEntries(Object.keys(TAXONOMY_NAMESPACES).map(ns => [ns, h('div', { class: 'taxonomy-panel' })]));
  const forms = {};
  let busy = false;

  const terms = () => [...ctx.taxonomies.values()];
  const filtering = () => !!state.q.trim() || state.status !== 'all';

  function syncUrl() {
    const query = new URLSearchParams();
    if (state.group !== 'type') query.set('group', state.group);
    if (state.q) query.set('q', state.q);
    if (state.status !== 'all') query.set('status', state.status);
    const qs = query.toString();
    app.replaceRoute(`#/taxonomies${qs ? `?${qs}` : ''}`);
  }

  async function reload() {
    ctx = await ws.loadContext();
    render();
  }

  // Re-renders, then returns focus to the same control of the same term (or a sensible neighbour).
  async function afterWrite(termId, action) {
    await reload();
    const panel = panels[state.group];
    const find = a => panel.querySelector(`[data-term="${termId}"][data-action="${a}"]`);
    const fallback = { up: 'down', down: 'up' }[action];
    const target = [find(action), fallback && find(fallback), panel.querySelector(`[data-term="${termId}"]`)].find(el => el && !el.disabled);
    target?.focus();
  }

  // ---- publication ----
  function renderPublication() {
    const publication = ctx.taxonomyPublication;
    const changes = taxonomyChanges(terms(), publication);
    append(clear(publicationEl), [
      h('div', { class: 'lineup-head' },
        h('div', null,
          h('h2', { id: 'taxonomy-publication-heading' }, 'Local publication'),
          h('p', { class: 'muted' }, 'Term edits (labels, order, activation, new terms) change the working terms only. The local preview site shows the published taxonomy until you publish these changes. Publishing the taxonomy never publishes tours, day trips or any other draft.')),
        h('div', { class: 'btn-row' },
          button(changes.length ? 'Publish taxonomy changes' : 'Taxonomy published', { variant: 'primary', iconName: 'globe', disabled: !changes.length || busy, 'data-action': 'publish-taxonomy', onClick: publish }))),
      h('p', { class: 'badge-row' },
        h('span', { class: `status-badge ${changes.length ? 'status-changes' : 'status-published'}` }, changes.length ? `${changes.length} unpublished change${changes.length === 1 ? '' : 's'}` : publication ? 'Published taxonomy is up to date' : 'Nothing to publish'),
        h('span', { class: 'muted small' }, publication
          ? `Published taxonomy: revision ${publication.revision}, ${formatDateTime(publication.publishedAt)}.${ORIGIN_NOTES[publication.origin] || ''}`
          : 'The taxonomy has not been published yet. Records that use terms can be published once their terms are published.')),
      changes.length ? h('details', { class: 'usage' }, h('summary', null, 'Show unpublished changes'), h('ul', { class: 'error-list' }, changes.map(c => h('li', null, c.text)))) : null]);
  }

  async function publish() {
    const snapshotTerms = terms();
    const changes = taxonomyChanges(snapshotTerms, ctx.taxonomyPublication);
    const ok = await confirmDialog({
      title: 'Publish taxonomy changes locally?',
      body: h('div', null,
        h('p', null, `These ${changes.length} change${changes.length === 1 ? '' : 's'} will be visible on the local preview site:`),
        h('ul', { class: 'error-list' }, changes.slice(0, 30).map(c => h('li', null, c.text)), changes.length > 30 ? h('li', null, `…and ${changes.length - 30} more.`) : null),
        h('p', null, 'Only term labels, keys, order and activation are published. No tour, day trip or other draft is published, and published records keep their own snapshots. Keys of published terms are locked afterwards.')),
      confirmLabel: 'Publish taxonomy changes'
    });
    if (!ok) return;
    try {
      const pub = await ws.taxonomies.publish({ expectedFingerprint: termsFingerprint(snapshotTerms) });
      toast(`Taxonomy published locally (revision ${pub.revision}).`);
    } catch (err) {
      await messageDialog({ title: 'Not published', body: errorDetails(err) });
    }
    await reload();
    publicationEl.querySelector('[data-action="publish-taxonomy"]')?.focus();
  }

  // ---- create ----
  function addForm(ns) {
    const noun = TAXONOMY_NAMESPACES[ns].toLowerCase();
    const labelId = `term-new-${ns}-label`;
    const keyId = `term-new-${ns}-key`;
    let keyEdited = false;
    const labelError = h('p', { class: 'field-error', id: `${labelId}-error`, hidden: true });
    const keyError = h('p', { class: 'field-error', id: `${keyId}-error`, hidden: true });
    const labelInput = h('input', { id: labelId, class: 'input', type: 'text', maxlength: TERM_LABEL_MAX, 'aria-describedby': `${labelId}-error`, on: { input: () => { if (!keyEdited) keyInput.value = suggestTermKey(labelInput.value); }, keydown: e => { if (e.key === 'Enter') { e.preventDefault(); add(); } } } });
    const keyInput = h('input', { id: keyId, class: 'input', type: 'text', maxlength: TERM_KEY_MAX, spellcheck: 'false', 'aria-describedby': `${keyId}-hint ${keyId}-error`, on: { input: () => { keyEdited = keyInput.value !== ''; }, keydown: e => { if (e.key === 'Enter') { e.preventDefault(); add(); } } } });
    const setError = (slot, input, message) => {
      slot.hidden = !message;
      slot.className = message ? 'field-error is-error' : 'field-error';
      slot.textContent = message ? `Error: ${message}` : '';
      if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    };
    async function add() {
      if (busy) return;
      setError(labelError, labelInput, null);
      setError(keyError, keyInput, null);
      busy = true;
      try {
        const term = await ws.taxonomies.create(ns, { label: labelInput.value, key: keyInput.value });
        labelInput.value = '';
        keyInput.value = '';
        keyEdited = false;
        busy = false;
        toast(`Added ${noun} “${term.label}” (key ${term.key}). It is not on the local site until the taxonomy is published.`);
        announce(`Added ${noun} ${term.label}.`);
        await reload();
        forms[ns].label.focus();
      } catch (err) {
        busy = false;
        const issues = err.issues || [{ path: 'label', message: err.message }];
        const labelIssue = issues.find(i => i.path === 'label' || i.path === 'namespace');
        const keyIssue = issues.find(i => i.path === 'key');
        setError(labelError, labelInput, labelIssue?.message);
        setError(keyError, keyInput, keyIssue?.message);
        (labelIssue ? labelInput : keyIssue ? keyInput : labelInput).focus();
      }
    }
    forms[ns] = { label: labelInput, key: keyInput };
    return h('div', { class: 'form-group term-add' },
      h('h3', { class: 'group-title' }, `Add a ${noun}`),
      h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('label', { for: labelId, class: 'field-label' }, 'Label', h('span', { class: 'req' }, ' *')), labelInput, labelError),
        h('div', { class: 'field' }, h('label', { for: keyId, class: 'field-label' }, 'Key'),
          h('p', { class: 'field-hint', id: `${keyId}-hint` }, 'Stable value for links and filters: lowercase letters, numbers and hyphens. Suggested from the label; it never changes when the label changes, and it is locked once the term is published.'),
          keyInput, keyError)),
      h('div', { class: 'btn-row' }, button(`Add ${noun}`, { iconName: 'plus', onClick: add })));
  }

  // ---- edit ----
  async function editTerm(term) {
    const published = isPublishedTerm(term.id, ctx.taxonomyPublication);
    const noun = TAXONOMY_NAMESPACES[term.namespace].toLowerCase();
    const labelInput = h('input', { id: 'term-edit-label', class: 'input', type: 'text', value: term.label, maxlength: TERM_LABEL_MAX, 'aria-describedby': 'term-edit-label-error' });
    const keyInput = h('input', { id: 'term-edit-key', class: 'input', type: 'text', value: term.key, maxlength: TERM_KEY_MAX, spellcheck: 'false', readOnly: published, 'aria-describedby': 'term-edit-key-hint term-edit-key-error' });
    const labelError = h('p', { class: 'field-error', id: 'term-edit-label-error', hidden: true });
    const keyError = h('p', { class: 'field-error', id: 'term-edit-key-error', hidden: true });
    const general = h('div', { 'aria-live': 'polite' });
    const show = (slot, input, message) => { slot.hidden = !message; slot.className = message ? 'field-error is-error' : 'field-error'; slot.textContent = message ? `Error: ${message}` : ''; if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); };
    const { result } = openDialog({
      title: `Edit ${noun}`,
      content: h('div', { class: 'term-edit' },
        h('div', { class: 'field' }, h('label', { for: 'term-edit-label', class: 'field-label' }, 'Label', h('span', { class: 'req' }, ' *')), labelInput, labelError),
        h('div', { class: 'field' }, h('label', { for: 'term-edit-key', class: 'field-label' }, 'Key'),
          h('p', { class: 'field-hint', id: 'term-edit-key-hint' }, published ? 'Locked: this term has been published, so external references (such as tag filter links) depend on this key.' : 'Editable until the term is first published; renaming never changes it.'),
          keyInput, keyError),
        h('p', { class: 'field-hint' }, `ID ${shortId(term.id)}… never changes, so records that use this ${noun} keep their link when you rename it.`),
        general),
      actions: [
        { label: 'Cancel', value: false },
        { label: 'Save', variant: 'primary', onClick: async close => {
          show(labelError, labelInput, null);
          show(keyError, keyInput, null);
          clear(general);
          try {
            await ws.taxonomies.update(term.id, published ? { label: labelInput.value } : { label: labelInput.value, key: keyInput.value }, { expectedVersion: term.version });
            close(true);
          } catch (err) {
            const issues = err.issues || [];
            const li = issues.find(i => i.path === 'label');
            const ki = issues.find(i => i.path === 'key');
            show(labelError, labelInput, li?.message);
            show(keyError, keyInput, ki?.message);
            if (!li && !ki) general.append(notice('error', err.message));
            (li ? labelInput : ki ? keyInput : labelInput).focus();
          }
        } }
      ]
    });
    labelInput.focus();
    if (await result) {
      toast(`Saved. The ID is unchanged, so records keep their link.${isPublishedTerm(term.id, ctx.taxonomyPublication) ? ' Publish taxonomy changes to update the local site.' : ''}`);
      await afterWrite(term.id, 'edit');
    }
  }

  // ---- activation and order ----
  async function toggleActive(term) {
    if (busy) return;
    const usage = taxonomyUsage(term.id, ctx);
    if (term.active) {
      const ok = await confirmDialog({
        title: `Deactivate “${term.label}”?`,
        body: h('div', null,
          h('p', null, 'Inactive terms are not offered for new selections. Nothing is deleted and no record is changed.'),
          usage.length ? h('div', null, h('p', null, `Used by ${usage.length} record version${usage.length === 1 ? '; it keeps' : 's; they keep'} the term (still displayed, with a warning in the editor):`), h('ul', { class: 'error-list' }, usage.map(u => h('li', null, `${u.title} (${u.where})`)))) : h('p', null, 'No record uses it.'),
          h('p', null, 'The local site changes only after you publish taxonomy changes.')),
        confirmLabel: 'Deactivate', danger: true
      });
      if (!ok) return;
    }
    busy = true;
    try {
      await ws.taxonomies.setActive(term.id, !term.active, { expectedVersion: term.version });
      announce(`${term.label} is now ${term.active ? 'inactive' : 'active'}.`);
    } catch (err) {
      await messageDialog({ title: 'Not changed', body: errorDetails(err) });
    }
    busy = false;
    await afterWrite(term.id, 'toggle');
  }

  async function move(term, delta, group) {
    if (busy) return;
    busy = true;
    try {
      const moved = await ws.taxonomies.move(term.id, delta, { expectedOrder: group.map(t => t.id) });
      announce(`${term.label} is now position ${moved.position} of ${moved.count}.`);
    } catch (err) {
      toast(err.message, { tone: 'error' });
    }
    busy = false;
    await afterWrite(term.id, delta < 0 ? 'up' : 'down');
  }

  // ---- term table ----
  function renderPanel(ns) {
    const all = namespaceTerms(terms(), ns);
    const q = state.q.trim().toLowerCase();
    const shown = all.filter(t => (state.status === 'all' || (state.status === 'active') === t.active) && (!q || t.label.toLowerCase().includes(q) || t.key.includes(q)));
    const plural = TAXONOMY_PLURALS[ns].toLowerCase();
    const changes = new Map(taxonomyChanges(all, ctx.taxonomyPublication).map(c => [c.id, c]));
    const canMove = !filtering();
    const table = shown.length ? h('div', { class: 'table-scroll panel table-panel' }, h('table', { class: 'data-table taxonomy-table' },
      h('caption', { class: 'visually-hidden' }, `${TAXONOMY_PLURALS[ns]} in display order`),
      h('thead', null, h('tr', null, ['Order', 'Label and key', 'Status', 'Used by', ''].map((t, i) => h('th', { scope: 'col' }, i === 4 ? h('span', { class: 'visually-hidden' }, 'Actions') : t)))),
      h('tbody', null, shown.map(term => {
        const index = all.indexOf(term);
        const usage = taxonomyUsage(term.id, ctx);
        const published = isPublishedTerm(term.id, ctx.taxonomyPublication);
        return h('tr', { class: term.active ? null : 'is-inactive' },
          h('td', { class: 'order-cell' }, h('div', { class: 'order-controls' },
            h('span', { class: 'order-number' }, String(index + 1)),
            canMove ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Move ${term.label} up`, title: `Move ${term.label} up`, 'data-term': term.id, 'data-action': 'up', disabled: index === 0, on: { click: () => move(term, -1, all) } }, icon('up')) : null,
            canMove ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Move ${term.label} down`, title: `Move ${term.label} down`, 'data-term': term.id, 'data-action': 'down', disabled: index === all.length - 1, on: { click: () => move(term, 1, all) } }, icon('down')) : null)),
          h('td', { class: 'cell-title' }, h('strong', null, term.label), h('small', null, 'Key ', h('code', null, term.key)),
            !published ? h('small', { class: 'msg-warning' }, 'Not published yet') : changes.has(term.id) ? h('small', { class: 'msg-warning' }, 'Unpublished changes') : null),
          h('td', null, h('span', { class: `status-badge ${term.active ? 'status-published' : 'status-archived'}` }, term.active ? 'Active' : 'Inactive')),
          h('td', { class: 'wrap-cell' }, usage.length
            ? h('details', { class: 'usage' }, h('summary', null, `${usage.length} record version${usage.length === 1 ? '' : 's'}`), h('ul', null, usage.map(u => h('li', null, h('a', { href: u.href }, u.title), ` (${u.where})`))))
            : h('span', { class: 'muted' }, 'Unused')),
          h('td', { class: 'row-actions' },
            button('Edit', { variant: 'ghost', 'aria-label': `Edit ${term.label}`, 'data-term': term.id, 'data-action': 'edit', onClick: () => editTerm(term) }),
            button(term.active ? 'Deactivate' : 'Activate', { variant: term.active ? 'ghost-danger' : 'ghost', 'aria-label': `${term.active ? 'Deactivate' : 'Activate'} ${term.label}`, 'data-term': term.id, 'data-action': 'toggle', onClick: () => toggleActive(term) })));
      }))))
      : h('div', { class: 'empty-state panel' }, h('span', null, icon(all.length ? 'search' : 'tag')),
        h('strong', null, all.length ? `No ${plural} match the search or status filter` : `No ${plural} yet`),
        h('p', null, all.length ? 'Change the search text or status filter.' : 'Nothing is pre-filled. Add terms once their names are confirmed.'));
    append(clear(panels[ns]), [
      h('p', { class: 'section-intro' }, NAMESPACE_NOTES[ns]),
      addForm(ns),
      filtering() && all.length ? notice('info', 'Clear the search and show both active and inactive terms to change the order.') : null,
      table]);
  }

  function render() {
    renderPublication();
    for (const ns of Object.keys(TAXONOMY_NAMESPACES)) {
      // Keep typed-but-unsaved text in the add form when re-rendering.
      const typed = forms[ns] ? { label: forms[ns].label.value, key: forms[ns].key.value } : null;
      renderPanel(ns);
      if (typed) { forms[ns].label.value = typed.label; forms[ns].key.value = typed.key; }
    }
  }

  const tabs = createTabs({
    id: 'taxonomy', label: 'Taxonomy groups', initial: state.group,
    tabs: Object.keys(TAXONOMY_NAMESPACES).map(ns => ({ id: ns, label: TAXONOMY_PLURALS[ns], content: panels[ns] })),
    onSelect: ns => { state.group = ns; syncUrl(); }
  });
  const searchInput = h('input', { id: 'taxonomy-search', type: 'search', class: 'input', value: state.q, placeholder: 'Search labels and keys', on: { input: e => { state.q = e.target.value; syncUrl(); render(); } } });
  const statusSelect = h('select', { id: 'taxonomy-status', class: 'input', on: { change: e => { state.status = e.target.value; syncUrl(); render(); } } },
    Object.entries(STATUS).map(([value, label]) => h('option', { value }, label)));
  statusSelect.value = state.status;

  const offEvents = ws.events.on(event => { if (event.remote) reload(); });
  const el = h('div', { class: 'taxonomy-view' },
    h('div', { class: 'view-head' }, h('div', null,
      h('div', { class: 'eyebrow' }, 'TOUR PACKAGES'),
      h('h1', { tabindex: '-1' }, 'Taxonomies'),
      h('p', { class: 'view-intro' }, 'Tour types, categories, standards and tags used by tours and day trips. Each term has a stable ID, a label, a stable key, a display order and an active/inactive state.'))),
    toolNav('taxonomies'),
    notice('warning', h('strong', null, 'Definitions await owner confirmation (B4). '), 'These groups and their terms are local prototype values: nothing is pre-filled and no label claims to match the existing CMS. Terms are never deleted — deactivate a term instead; records that already use it keep it.'),
    publicationEl,
    h('div', { class: 'list-toolbar panel', role: 'search' },
      h('div', { class: 'field' }, h('label', { for: searchInput.id, class: 'field-label' }, 'Search'), searchInput),
      h('div', { class: 'field' }, h('label', { for: statusSelect.id, class: 'field-label' }, 'Status'), statusSelect)),
    h('div', { class: 'editor-tabs taxonomy-tabs' }, tabs.list, h('div', { class: 'tabpanels' }, tabs.panels)));
  render();
  return {
    el, title: 'Taxonomies', breadcrumb: 'Tour Packages / Taxonomies', navGroup: 'Tour Packages', navLabel: 'Taxonomies',
    mounted() { el.querySelector('h1').focus({ preventScroll: true }); },
    destroy() { offEvents(); }
  };
}
