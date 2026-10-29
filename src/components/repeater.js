// Accessible repeater: ordered items with labelled Move up / Move down / Remove buttons. After a move,
// focus follows the moved item and the new position is announced to screen readers.
import { announce, clear, h, icon } from './dom.js';
import { fieldIdFor } from './fields.js';
import { pluralNoun } from '../modules/shared/format.js';

function iconButton(name, label, action, disabled, onClick) {
  return h('button', { type: 'button', class: 'icon-btn', 'aria-label': label, title: label, 'data-action': action, disabled, on: { click: onClick } }, icon(name));
}

export function createRepeater({ items, keyOf = (item, i) => item?.id ?? String(i), itemLabel, renderItem, onChange, confirmRemove, emptyText = 'Nothing added yet.', readOnly = false, className }) {
  const list = h('ol', { class: ['repeater', className] });

  function render(focus) {
    clear(list);
    if (!items.length) list.append(h('li', { class: 'repeater-empty' }, emptyText));
    items.forEach((item, index) => {
      const label = itemLabel(item, index);
      list.append(h('li', { class: 'repeater-item', dataset: { key: keyOf(item, index) } },
        h('div', { class: 'repeater-head' },
          h('span', { class: 'repeater-title' }, label),
          readOnly ? null : h('div', { class: 'repeater-controls' },
            iconButton('up', `Move ${label} up`, 'up', index === 0, () => move(index, -1)),
            iconButton('down', `Move ${label} down`, 'down', index === items.length - 1, () => move(index, 1)),
            iconButton('trash', `Remove ${label}`, 'remove', false, () => remove(index)))),
        h('div', { class: 'repeater-body' }, renderItem(item, index))));
    });
    if (focus) restoreFocus(focus);
  }

  function restoreFocus({ key, action }) {
    const row = [...list.children].find(li => li.dataset.key === String(key));
    if (!row) return;
    const preferred = row.querySelector(`[data-action="${action}"]`);
    const fallback = row.querySelector(`[data-action="${action === 'up' ? 'down' : 'up'}"]`);
    const target = preferred && !preferred.disabled ? preferred : fallback && !fallback.disabled ? fallback : row.querySelector('input, textarea, button');
    target?.focus();
  }

  function move(index, delta) {
    const to = index + delta;
    if (to < 0 || to >= items.length) return;
    [items[index], items[to]] = [items[to], items[index]];
    onChange?.('move');
    render({ key: keyOf(items[to], to), action: delta < 0 ? 'up' : 'down' });
    announce(`${itemLabel(items[to], to)} is now position ${to + 1} of ${items.length}.`);
  }

  async function remove(index) {
    const label = itemLabel(items[index], index);
    if (confirmRemove && !(await confirmRemove(items[index], index))) return;
    items.splice(index, 1);
    onChange?.('remove');
    render();
    const next = list.children[Math.min(index, items.length - 1)];
    (next?.querySelector('[data-action="remove"]') || list.closest('fieldset, .repeater-field')?.querySelector('.repeater-add, input'))?.focus();
    announce(`${label} removed.`);
  }

  function add(item) {
    items.push(item);
    onChange?.('add');
    render();
    list.lastElementChild?.querySelector('input, textarea')?.focus();
  }

  render();
  return { el: list, render, add };
}

// Ordered list of short strings (activities, amenities, inclusions…). The add input carries the field id so
// validation errors for the list can focus it.
export function stringList({ path, label, hint, values, onChange, placeholder = '', noun = 'item', readOnly = false }) {
  const id = fieldIdFor(path);
  const nouns = pluralNoun(noun);
  const message = h('p', { class: 'field-hint list-message', 'aria-live': 'polite' });
  const repeater = createRepeater({
    items: values, keyOf: (_, i) => String(i), readOnly,
    itemLabel: (value, i) => `${noun} ${i + 1}${value ? `: ${value}` : ''}`,
    emptyText: `No ${nouns} yet.`,
    onChange,
    renderItem: (value, i) => h('input', {
      class: 'input', type: 'text', value, readOnly, 'aria-label': `${noun} ${i + 1}`,
      on: { input: e => { values[i] = e.target.value; onChange?.('edit'); } }
    })
  });
  const addInput = h('input', { id, class: 'input', type: 'text', placeholder, readOnly, 'aria-label': `New ${noun}`, on: { keydown: e => { if (e.key === 'Enter') { e.preventDefault(); addValue(); } } } });
  function addValue() {
    const value = addInput.value.replace(/\s+/g, ' ').trim();
    if (!value) { message.textContent = `Type a ${noun} first.`; return; }
    if (values.some(v => v.replace(/\s+/g, ' ').trim() === value)) { message.textContent = `“${value}” is already in the list.`; return; }
    message.textContent = '';
    addInput.value = '';
    repeater.add(value);
    addInput.focus();
  }
  const hintId = hint ? `${id}-hint` : null;
  addInput.setAttribute('aria-describedby', [hintId, `${id}-error`].filter(Boolean).join(' '));
  return h('fieldset', { class: 'field field-wide repeater-field' },
    h('legend', { class: 'field-label' }, label),
    hint ? h('p', { class: 'field-hint', id: hintId }, hint) : null,
    repeater.el,
    readOnly ? null : h('div', { class: 'add-row' }, addInput, h('button', { type: 'button', class: 'btn btn-secondary repeater-add', on: { click: addValue } }, icon('plus'), h('span', null, `Add ${noun}`))),
    message,
    h('p', { class: 'field-error', id: `${id}-error`, hidden: true }));
}
