// Team list (Settings › Team): searchable profiles plus the draft team order. Move up / Move down and the
// visibility checkboxes write the DRAFT lineup immediately (stale-checked); the local team page changes only
// when "Publish order & visibility" publishes the lineup, which never publishes profile content.
import { announce, append, button, clear, h, icon, linkButton } from '../components/dom.js';
import { confirmDialog, messageDialog } from '../components/dialog.js';
import { envelopeBadges, errorDetails, notice, toast } from '../components/feedback.js';
import { STATUS_FILTERS } from './list-view.js';
import { draftLineup, lineupHasUnpublishedChanges, publishedTeam, teamPageStatus } from './shared/site.js';
import { validateLineup } from './shared/site-validation.js';
import { formatDateTime } from './shared/format.js';

export function siteNav(active) {
  const links = [['settings', '#/settings', 'Setting Options', 'settings'], ['team', '#/team', 'Team', 'users'], ['team-preview', '#/team/preview', 'Team page preview', 'eye'], ['site', '#/site', 'Local preview site', 'globe'], ['media', '#/media', 'Media library', 'image'], ['backup', '#/backup', 'Backup & import', 'database']];
  return h('nav', { class: 'tool-nav', 'aria-label': 'Settings pages' },
    links.map(([key, href, label, iconName]) => h('a', { href, class: ['tool-link', key === active && 'is-active'], 'aria-current': key === active ? 'page' : null }, icon(iconName), label)));
}

export async function createTeamListView({ app, params }) {
  const ws = await app.workspace();
  let ctx = await ws.loadContext();
  const state = { q: params.get('q') || '', status: STATUS_FILTERS[params.get('status')] ? params.get('status') : 'active' };
  const lineupEl = h('section', { class: 'panel lineup-panel', 'aria-labelledby': 'lineup-heading' });
  const lineupStatus = h('p', { class: 'save-status', role: 'status', 'aria-live': 'polite' });
  const results = h('div', { class: 'list-results' });
  const countEl = h('p', { class: 'list-count', role: 'status', 'aria-live': 'polite' });
  let busy = false;

  const members = () => [...ctx.siteRecords.values()].filter(env => env.kind === 'teamMember');
  const reorderable = () => !state.q.trim() && state.status === 'active';

  function syncUrl() {
    const query = new URLSearchParams();
    if (state.q) query.set('q', state.q);
    if (state.status !== 'active') query.set('status', state.status);
    const qs = query.toString();
    app.replaceRoute(`#/team${qs ? `?${qs}` : ''}`);
  }

  // Active profiles in draft lineup order; archived ones (not in the lineup) follow by name.
  function rows() {
    const order = new Map((draftLineup(ctx)?.record.entries || []).map((e, i) => [e.memberId, i]));
    const term = state.q.trim().toLowerCase();
    const rank = env => (order.has(env.id) ? order.get(env.id) : Number.MAX_SAFE_INTEGER);
    return members()
      .filter(STATUS_FILTERS[state.status].test)
      .filter(env => !term || [env.record.name, env.record.position].join(' ').toLowerCase().includes(term))
      .sort((a, b) => rank(a) - rank(b) || a.record.name.localeCompare(b.record.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id));
  }

  async function reload() { ctx = await ws.loadContext(); render(); }

  // Runs a lineup write, then re-renders and puts focus back on the same control of the same profile.
  async function lineupWrite(fn, { memberId, action, success }) {
    if (busy) return;
    busy = true;
    lineupStatus.dataset.state = 'saving';
    lineupStatus.textContent = 'Saving draft team order…';
    try {
      const env = await fn(draftLineup(ctx).record.version);
      lineupStatus.dataset.state = 'saved';
      lineupStatus.textContent = `Draft team order saved ${formatDateTime(env.record.updatedAt)} · not published yet`;
      if (success) announce(success(env));
    } catch (err) {
      lineupStatus.dataset.state = 'error';
      lineupStatus.textContent = err.code === 'stale' ? 'Not saved — the team order was changed elsewhere. The latest order is shown now; try again.' : `Not saved — ${err.message}`;
      if (err.code !== 'stale') toast(err.message, { tone: 'error' });
    }
    busy = false;
    await reload();
    const target = results.querySelector(`[data-member="${memberId}"][data-action="${action}"]`);
    const fallback = results.querySelector(`[data-member="${memberId}"][data-action="${action === 'up' ? 'down' : 'up'}"]`);
    (target && !target.disabled ? target : fallback && !fallback.disabled ? fallback : results.querySelector(`[data-member="${memberId}"]`))?.focus();
  }

  const move = (env, delta) => lineupWrite(version => ws.site.moveMember(env.id, delta, { expectedVersion: version }), {
    memberId: env.id, action: delta < 0 ? 'up' : 'down',
    success: next => `${env.record.name} is now position ${next.record.entries.findIndex(e => e.memberId === env.id) + 1} of ${next.record.entries.length} in the draft order.`
  });
  const setVisible = (env, visible) => lineupWrite(version => ws.site.setMemberVisibility(env.id, visible, { expectedVersion: version }), {
    memberId: env.id, action: 'visible', success: () => `${env.record.name} will be ${visible ? 'shown' : 'hidden'} once the order is published.`
  });

  async function publishOrder() {
    const lineup = draftLineup(ctx);
    if (!lineup) return;
    const issues = validateLineup(lineup.record, ctx);
    const shown = lineup.record.entries.filter(e => e.visible && ctx.sitePublished.has(e.memberId)).map(e => ctx.siteRecords.get(e.memberId)?.record.name);
    const warnings = issues.filter(i => i.severity === 'warning');
    const ok = await confirmDialog({
      title: 'Publish team order and visibility locally?',
      body: h('div', null,
        h('p', null, shown.length ? `The local team page will show ${shown.length} profile${shown.length === 1 ? '' : 's'} in this order:` : 'No published, visible profiles yet — the local team page will be empty.'),
        shown.length ? h('ol', { class: 'error-list' }, shown.map(name => h('li', null, name))) : null,
        warnings.length ? h('div', null, h('p', null, 'Not shown:'), h('ul', { class: 'error-list' }, warnings.map(w => h('li', null, w.message)))) : null,
        h('p', null, 'Only order and visibility are published. Profile text and portraits stay as last published; unpublished profile edits are not published by this step.')),
      confirmLabel: 'Publish order & visibility'
    });
    if (!ok) return;
    try {
      await ws.site.publishLineup({ expectedVersion: lineup.record.version });
      toast('Team order and visibility published to the local preview.');
    } catch (err) {
      await messageDialog({ title: 'Not published', body: errorDetails(err) });
    }
    await reload();
    lineupEl.querySelector('[data-action="publish-lineup"]')?.focus();
  }

  async function archive(env) {
    const ok = await confirmDialog({ title: `Archive “${env.record.name}”?`, body: `${env.record.status === 'published' ? 'Its published version is removed from the local preview. ' : ''}It is taken out of the draft team order and becomes read-only. You can restore it to draft later.`, confirmLabel: 'Archive', danger: true });
    if (!ok) return;
    try { await ws.site.archiveMember(env.id, { expectedVersion: env.record.version }); toast(`Archived “${env.record.name}”.`); } catch (err) { await messageDialog({ title: 'Not archived', body: errorDetails(err) }); }
    await reload();
  }

  async function restore(env) {
    try { await ws.site.restoreMember(env.id, { expectedVersion: env.record.version }); toast(`Restored “${env.record.name}” to draft at the end of the team order. Publish it again when ready.`); } catch (err) { await messageDialog({ title: 'Not restored', body: errorDetails(err) }); }
    await reload();
  }

  function renderLineup() {
    const env = draftLineup(ctx);
    const pub = ctx.sitePublished.get(env?.id);
    const changes = lineupHasUnpublishedChanges(env);
    const onPage = publishedTeam(ctx).length;
    const warnings = env ? validateLineup(env.record, ctx).filter(i => i.severity === 'warning') : [];
    if (!lineupStatus.dataset.state) lineupStatus.textContent = env ? `Draft team order: version ${env.record.version}, saved ${formatDateTime(env.record.updatedAt)}` : 'No team order yet — it is created with the first profile.';
    append(clear(lineupEl), [
      h('div', { class: 'lineup-head' },
        h('div', null,
          h('h2', { id: 'lineup-heading' }, 'Team page order and visibility'),
          h('p', { class: 'muted' }, 'Move up / Move down and “Visible” change the draft order immediately. The local team page keeps the published order until you publish it. Publishing the order never publishes profile edits; profiles are published from their own editor.')),
        h('div', { class: 'btn-row' },
          button(env && !changes ? 'Order published' : 'Publish order & visibility', { variant: 'primary', iconName: 'globe', disabled: !env || !changes, onClick: publishOrder, 'data-action': 'publish-lineup', title: !env ? 'The team order is created with the first profile.' : changes ? 'Publish the draft order and visibility to the local preview only' : 'The published order matches the draft order.' }),
          linkButton('Preview draft team page', '#/team/preview?rev=draft', { variant: 'ghost', iconName: 'eye' }),
          linkButton('Preview published team page', '#/team/preview?rev=published', { variant: 'ghost', iconName: 'globe' }))),
      h('p', { class: 'badge-row' },
        env ? h('span', { class: `status-badge ${changes ? 'status-changes' : 'status-published'}` }, changes ? (pub ? 'Unpublished order changes' : 'Order never published') : 'Published order is up to date') : null,
        h('span', { class: 'muted small' }, pub ? `Published order: revision ${pub.revision}, ${formatDateTime(pub.publishedAt)} · ${onPage} profile${onPage === 1 ? '' : 's'} on the local team page` : 'Nothing is on the local team page yet.')),
      lineupStatus,
      warnings.length ? notice('warning', h('strong', null, 'Visible but not published: '), warnings.map(w => w.message).join(' ')) : null]);
  }

  function render() {
    renderLineup();
    const list = rows();
    const everything = members();
    const counts = { published: 0, draft: 0, archived: 0 };
    for (const env of everything) counts[env.record.status] += 1;
    countEl.textContent = `${list.length} shown · ${everything.length} total (${counts.published} published, ${counts.draft} draft, ${counts.archived} archived)`;
    clear(results);
    if (!everything.length) {
      results.append(h('div', { class: 'empty-state panel' }, h('span', null, icon('users')), h('strong', null, 'No team profiles yet'),
        h('p', null, 'Add the first profile. Only a name is needed to save a draft.'), linkButton('Add profile', '#/team/new', { variant: 'primary', iconName: 'plus' })));
      return;
    }
    if (!list.length) {
      results.append(h('div', { class: 'empty-state panel' }, h('span', null, icon('search')), h('strong', null, 'No profiles match these filters'),
        button('Clear filters', { onClick: () => { state.q = ''; state.status = 'active'; searchInput.value = ''; statusSelect.value = 'active'; syncUrl(); render(); } })));
      return;
    }
    const entries = draftLineup(ctx)?.record.entries || [];
    const canMove = reorderable();
    if (!canMove) results.append(notice('info', 'Clear the search and show “Active” profiles to change the order.'));
    results.append(h('div', { class: 'table-scroll panel table-panel' }, h('table', { class: 'data-table team-table' },
      h('caption', { class: 'visually-hidden' }, `Team profiles: ${STATUS_FILTERS[state.status].label}, in draft team order`),
      h('thead', null, h('tr', null, ['Order', 'Profile', 'Status', 'Visible (draft)', 'Published team page', 'Updated (EAT)'].map(t => h('th', { scope: 'col' }, t)), h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Actions')))),
      h('tbody', null, list.map(env => {
        const index = entries.findIndex(e => e.memberId === env.id);
        const entry = entries[index];
        const page = teamPageStatus(env.id, ctx);
        const name = env.record.name;
        return h('tr', null,
          h('td', { class: 'order-cell' }, index === -1 ? '—' : h('div', { class: 'order-controls' },
            h('span', { class: 'order-number' }, String(index + 1)),
            canMove ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Move ${name} up`, title: `Move ${name} up`, 'data-member': env.id, 'data-action': 'up', disabled: index === 0, on: { click: () => move(env, -1) } }, icon('up')) : null,
            canMove ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Move ${name} down`, title: `Move ${name} down`, 'data-member': env.id, 'data-action': 'down', disabled: index === entries.length - 1, on: { click: () => move(env, 1) } }, icon('down')) : null)),
          h('td', { class: 'cell-title' }, h('a', { href: `#/team/${env.id}` }, name), h('small', null, env.record.position || 'No position yet')),
          h('td', null, envelopeBadges(env)),
          h('td', null, entry ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: entry.visible, 'data-member': env.id, 'data-action': 'visible', 'aria-label': `Show ${name} on the team page (draft)`, on: { change: e => setVisible(env, e.target.checked) } }), h('span', { 'aria-hidden': 'true' }, entry.visible ? 'Visible' : 'Hidden')) : h('span', { class: 'muted' }, 'Not in order')),
          h('td', { class: 'wrap-cell' }, page.onPage ? h('span', { class: 'msg-ok' }, `Shown at position ${page.pagePosition}`) : h('span', { class: 'muted small' }, page.reason)),
          h('td', null, formatDateTime(env.record.updatedAt)),
          h('td', { class: 'row-actions' },
            linkButton('Edit', `#/team/${env.id}`, { variant: 'ghost', 'aria-label': `Edit ${name}` }),
            linkButton('Preview', `#/team/${env.id}/preview`, { variant: 'ghost', 'aria-label': `Preview ${name}` }),
            env.record.status === 'archived'
              ? button('Restore', { variant: 'ghost', 'aria-label': `Restore ${name} to draft`, onClick: () => restore(env) })
              : button('Archive', { variant: 'ghost-danger', 'aria-label': `Archive ${name}`, onClick: () => archive(env) })));
      })))));
  }

  const searchInput = h('input', { id: 'team-search', type: 'search', class: 'input', value: state.q, placeholder: 'Search by name or position', on: { input: e => { state.q = e.target.value; syncUrl(); render(); } } });
  const statusSelect = h('select', { id: 'team-status', class: 'input', on: { change: e => { state.status = e.target.value; syncUrl(); render(); } } },
    Object.entries(STATUS_FILTERS).map(([value, f]) => h('option', { value }, f.label.replace('records', 'profiles'))));
  statusSelect.value = state.status;

  const offEvents = ws.events.on(event => { if (event.remote) reload(); });
  const el = h('div', { class: 'list-view team-list' },
    h('div', { class: 'view-head' },
      h('div', null, h('div', { class: 'eyebrow' }, 'SETTINGS'), h('h1', { tabindex: '-1' }, 'Team'),
        h('p', { class: 'view-intro' }, 'Public team profiles for the local team page. Profiles are not staff accounts: they have no login and grant no permissions.')),
      linkButton('Add profile', '#/team/new', { variant: 'primary', iconName: 'plus' })),
    siteNav('team'),
    lineupEl,
    h('div', { class: 'list-toolbar panel', role: 'search' },
      h('div', { class: 'field' }, h('label', { for: searchInput.id, class: 'field-label' }, 'Search'), searchInput),
      h('div', { class: 'field' }, h('label', { for: statusSelect.id, class: 'field-label' }, 'Status'), statusSelect)),
    countEl,
    results);
  render();
  return {
    el, title: 'Team', breadcrumb: 'Settings / Team', navGroup: 'Settings', navLabel: 'Team',
    mounted() { el.querySelector('h1').focus({ preventScroll: true }); },
    destroy() { offEvents(); }
  };
}

