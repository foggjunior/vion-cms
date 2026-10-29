// Many-to-many relation picker: filterable checkbox list plus an ordered list of selected items.
// Unpublished, archived and missing references stay visible with a warning instead of disappearing.
import { clear, h, icon } from './dom.js';
import { fieldIdFor } from './fields.js';
import { pluralNoun } from '../modules/shared/format.js';

export const relationStatusText = option => !option ? 'Missing record' : option.status === 'archived' ? 'Archived' : option.published ? 'Published' : 'Not published';

export function relationPicker({ path, legend, hint, options, selected, onChange, noun = 'item', readOnly = false }) {
  const id = fieldIdFor(path);
  const nouns = pluralNoun(noun);
  const byId = new Map(options.map(o => [o.id, o]));
  const chips = h('ul', { class: 'chip-list', 'aria-label': `Selected ${nouns}` });
  const list = h('ul', { class: 'option-list' });
  const filter = h('input', { id, class: 'input', type: 'search', placeholder: `Filter ${nouns}`, 'aria-label': `Filter ${nouns}`, readOnly, on: { input: renderOptions } });

  function toggle(optionId, checked) {
    const index = selected.indexOf(optionId);
    if (checked && index === -1) selected.push(optionId);
    if (!checked && index !== -1) selected.splice(index, 1);
    onChange?.();
    renderChips();
  }

  function renderChips() {
    clear(chips);
    if (!selected.length) chips.append(h('li', { class: 'chip-empty' }, `No ${nouns} selected.`));
    selected.forEach(sid => {
      const option = byId.get(sid);
      const status = relationStatusText(option);
      const warn = !option || !option.published;
      chips.append(h('li', { class: ['chip', warn && 'chip-warn'] },
        warn ? icon('alert') : null,
        h('span', null, option ? option.label : `Unknown ${noun} (${sid.slice(0, 8)})`),
        h('small', null, status),
        readOnly ? null : h('button', {
          type: 'button', class: 'chip-remove', 'aria-label': `Remove ${option ? option.label : 'missing record'}`,
          on: { click: () => { toggle(sid, false); renderOptions(); } }
        }, '×')));
    });
  }

  function renderOptions() {
    clear(list);
    const term = filter.value.trim().toLowerCase();
    const visible = options.filter(o => !term || o.label.toLowerCase().includes(term));
    if (!options.length) list.append(h('li', { class: 'option-empty' }, `No ${nouns} exist yet. Create one first; it can stay a draft while you build this record.`));
    else if (!visible.length) list.append(h('li', { class: 'option-empty' }, `No ${nouns} match “${filter.value}”.`));
    for (const option of visible) {
      list.append(h('li', null, h('label', { class: 'check option' },
        h('input', { type: 'checkbox', checked: selected.includes(option.id), disabled: readOnly, on: { change: e => toggle(option.id, e.target.checked) } }),
        h('span', null, option.label),
        h('small', { class: `option-status ${option.published ? 'is-ok' : 'is-warn'}` }, relationStatusText(option)))));
    }
  }

  renderChips();
  renderOptions();
  const hintId = hint ? `${id}-hint` : null;
  filter.setAttribute('aria-describedby', [hintId, `${id}-error`].filter(Boolean).join(' '));
  return h('fieldset', { class: 'field field-wide relation-picker' },
    h('legend', { class: 'field-label' }, legend),
    hint ? h('p', { class: 'field-hint', id: hintId }, hint) : null,
    chips, filter, list,
    h('p', { class: 'field-error', id: `${id}-error`, hidden: true }));
}

// Builds picker options from a validation context.
export function relationOptions(ctx, kind, { excludeId } = {}) {
  return [...ctx.records.values()]
    .filter(env => env.kind === kind && env.id !== excludeId)
    .map(env => ({ id: env.id, label: env.record.title, status: env.record.status, published: ctx.published.has(env.id) }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}
