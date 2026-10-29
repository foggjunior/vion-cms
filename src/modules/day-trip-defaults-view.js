// Day-trip defaults editor (#/day-trips/defaults): default inclusions and default what-to-bring items.
// Proposed replacement behaviour. The defaults are editor templates only: they are copied into a day-trip draft
// only through that editor's explicit "Copy defaults into this draft" action, and saving them here never
// changes any day trip (draft or published). Nothing is pre-filled because the approved texts are not known.
import { button, clear, h, icon } from '../components/dom.js';
import { confirmDialog } from '../components/dialog.js';
import { notice, toast } from '../components/feedback.js';
import { stringList } from '../components/repeater.js';
import { formatDateTime, formatTime } from './shared/format.js';

const toModel = stored => ({ inclusions: [...(stored?.inclusions || [])], whatToBring: [...(stored?.whatToBring || [])] });

export async function createDayTripDefaultsView({ app }) {
  const ws = await app.workspace();
  let stored = await ws.defaults.getDayTripDefaults();
  let model = toModel(stored);
  let baseline = JSON.stringify(model);
  let busy = false;
  const statusEl = h('p', { class: 'save-status', role: 'status', 'aria-live': 'polite' });
  const metaEl = h('p', { class: 'muted small' });
  const bannersEl = h('div', { class: 'editor-banners' });
  const listsEl = h('div', { class: 'form-group' });
  const isDirty = () => JSON.stringify(model) !== baseline;

  function setStatus(state, text) {
    statusEl.dataset.state = state;
    statusEl.textContent = text;
  }

  function changed() {
    if (busy) return;
    if (isDirty()) setStatus('dirty', 'Unsaved changes');
    else if (statusEl.dataset.state === 'dirty') setStatus('idle', 'No unsaved changes');
  }

  function render() {
    metaEl.textContent = stored ? `Stored version ${stored.version}, saved ${formatDateTime(stored.updatedAt)}.` : 'No defaults saved yet.';
    clear(listsEl).append(h('div', { class: 'form-grid' },
      stringList({ path: 'defaults.inclusions', label: 'Default inclusions', hint: 'Copied into a day-trip draft’s inclusions only when someone chooses to.', noun: 'inclusion', values: model.inclusions, onChange: changed }),
      stringList({ path: 'defaults.whatToBring', label: 'Default what-to-bring items', hint: 'Copied into a day-trip draft’s “What to bring” list only when someone chooses to.', noun: 'item', values: model.whatToBring, onChange: changed })));
  }

  async function reloadLatest() {
    if (isDirty() && !(await confirmDialog({ title: 'Discard your unsaved changes?', body: 'Reloading shows the stored defaults. Your unsaved edits here will be lost.', confirmLabel: 'Discard and reload', danger: true }))) return;
    stored = await ws.defaults.getDayTripDefaults();
    model = toModel(stored);
    baseline = JSON.stringify(model);
    clear(bannersEl);
    render();
    setStatus('idle', stored ? `Reloaded version ${stored.version}` : 'Reloaded: no defaults saved yet');
  }

  async function save() {
    if (busy) return;
    if (!isDirty()) { setStatus('idle', 'No changes to save.'); return; }
    busy = true;
    setStatus('saving', 'Saving…');
    const submitted = JSON.stringify(model);
    try {
      const saved = await ws.defaults.saveDayTripDefaults(model, { expectedVersion: stored?.version ?? null });
      busy = false;
      stored = saved;
      if (JSON.stringify(model) === submitted) {
        model = toModel(saved);
        baseline = JSON.stringify(model);
        render();
      } else {
        // Edits made while saving stay in the form (unsaved).
        baseline = JSON.stringify(toModel(saved));
        metaEl.textContent = `Stored version ${saved.version}, saved ${formatDateTime(saved.updatedAt)}.`;
      }
      clear(bannersEl);
      setStatus('saved', `Defaults saved ${formatTime(saved.updatedAt)} · no day trip was changed${isDirty() ? ' · newer edits not saved yet' : ''}`);
      toast('Day-trip defaults saved. Existing day trips are unchanged.');
    } catch (err) {
      busy = false;
      setStatus('error', `Not saved — ${err.message}`);
      if (err.code === 'stale' || err.code === 'conflict') {
        bannersEl.replaceChildren(notice('error', h('strong', null, 'Your change was not saved. '), err.message, ' ', button('Reload stored defaults', { variant: 'secondary', onClick: reloadLatest })));
      } else {
        toast(err.message, { tone: 'error' });
      }
    }
  }

  const offEvents = ws.events.on(event => {
    if (!event.remote || event.kind !== 'dayTripDefaults') return;
    bannersEl.replaceChildren(notice('warning', h('strong', null, 'The defaults were changed in another tab or window. '), 'Saving here will be rejected to protect that change. ', button('Reload stored defaults', { variant: 'secondary', onClick: reloadLatest })));
  });

  const el = h('div', { class: 'editor defaults-view' },
    h('div', { class: 'editor-bar' },
      h('div', { class: 'editor-bar-main' },
        h('a', { class: 'back-link', href: '#/day-trips' }, icon('back'), 'All day trips'),
        h('h1', { class: 'editor-title', tabindex: '-1' }, 'Day-trip defaults'),
        h('div', { class: 'editor-meta' }, metaEl, statusEl)),
      h('div', { class: 'editor-actions' }, button('Save defaults', { variant: 'primary', iconName: 'check', onClick: save, 'data-action': 'save' }))),
    bannersEl,
    notice('warning', h('strong', null, 'Proposed replacement behaviour. '), 'The audit observed site-wide day-trip inclusions and what-to-bring lists, but their approved text was not provided, so nothing is pre-filled. Defaults are copied into a day-trip draft only when someone chooses “Copy defaults into this draft” in that editor (with a warning before populated lists are replaced). Saving defaults here never changes existing day trips, their drafts or their published versions.'),
    listsEl);
  render();
  setStatus('idle', stored ? 'No unsaved changes' : 'Nothing entered yet');
  return {
    el, title: 'Day-trip defaults', breadcrumb: 'Tour Packages / Day-trip defaults', navGroup: 'Tour Packages', navLabel: 'Activities / day trips',
    isDirty,
    mounted() { el.querySelector('h1').focus({ preventScroll: true }); },
    destroy() { offEvents(); }
  };
}
