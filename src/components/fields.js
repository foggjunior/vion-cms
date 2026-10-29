// Accessible labelled form controls. Every control has a <label>, optional hint and an error slot
// wired through aria-describedby; errors set aria-invalid.
import { h } from './dom.js';

export function fieldIdFor(path) { return `f-${String(path).replace(/[^a-zA-Z0-9]+/g, '-')}`; }

export function fieldWrap({ id, label, hint, required, control, wide = false, labelTag = 'label' }) {
  const hintId = hint ? `${id}-hint` : null;
  const errorId = `${id}-error`;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ');
  control.setAttribute('aria-describedby', describedBy);
  const labelEl = labelTag === 'label' ? h('label', { for: id, class: 'field-label' }, label, required ? h('span', { class: 'req', title: required === 'publish' ? 'Required to publish' : 'Required' }, required === 'publish' ? ' · required to publish' : ' *') : null)
    : h('span', { class: 'field-label', id: `${id}-label` }, label);
  return h('div', { class: ['field', wide && 'field-wide'] },
    labelEl,
    hint ? h('p', { class: 'field-hint', id: hintId }, hint) : null,
    control,
    h('p', { class: 'field-error', id: errorId, hidden: true }));
}

export function setFieldMessage(wrap, control, issue) {
  const slot = wrap?.querySelector(':scope > .field-error') || wrap?.querySelector('.field-error');
  if (!slot) return;
  if (!issue) {
    slot.hidden = true;
    slot.textContent = '';
    slot.className = 'field-error';
    control?.removeAttribute('aria-invalid');
    return;
  }
  slot.hidden = false;
  slot.className = `field-error ${issue.severity === 'warning' ? 'is-warning' : 'is-error'}`;
  slot.textContent = `${issue.severity === 'warning' ? 'Warning' : 'Error'}: ${issue.message}`;
  if (issue.severity === 'error') control?.setAttribute('aria-invalid', 'true');
  else control?.removeAttribute('aria-invalid');
}

export function textControl({ id, value = '', multiline = false, rows = 4, placeholder, inputmode, maxlength, onInput, autocomplete = 'off', list, readOnly, className }) {
  const props = { id, name: id, placeholder, inputmode, maxlength, autocomplete, list, readOnly, class: ['input', className], value: value ?? '', on: { input: e => onInput?.(e.target.value, e) } };
  return multiline ? h('textarea', { ...props, rows }) : h('input', { ...props, type: 'text', spellcheck: inputmode ? 'false' : null });
}

export function selectControl({ id, value, options, onChange }) {
  const select = h('select', { id, name: id, class: 'input', on: { change: e => onChange?.(e.target.value) } },
    options.map(o => h('option', { value: o.value, disabled: o.disabled }, o.label)));
  select.value = value ?? '';
  return select;
}

export function checkboxField({ id, label, checked, hint, onChange }) {
  const input = h('input', { type: 'checkbox', id, name: id, checked: !!checked, on: { change: e => onChange?.(e.target.checked) } });
  const hintId = hint ? `${id}-hint` : null;
  input.setAttribute('aria-describedby', [hintId, `${id}-error`].filter(Boolean).join(' '));
  return h('div', { class: 'field field-check' },
    h('label', { class: 'check' }, input, h('span', null, label)),
    hint ? h('p', { class: 'field-hint', id: hintId }, hint) : null,
    h('p', { class: 'field-error', id: `${id}-error`, hidden: true }));
}

export function radioGroup({ id, legend, value, options, onChange, hint }) {
  const hintId = hint ? `${id}-hint` : null;
  return h('fieldset', { class: 'field radio-group', id, 'aria-describedby': [hintId, `${id}-error`].filter(Boolean).join(' ') },
    h('legend', { class: 'field-label' }, legend),
    hint ? h('p', { class: 'field-hint', id: hintId }, hint) : null,
    h('div', { class: 'radio-options' }, options.map(o => h('label', { class: 'check' },
      h('input', { type: 'radio', name: id, value: o.value, checked: o.value === value, on: { change: () => onChange?.(o.value) } }),
      h('span', null, o.label)))),
    h('p', { class: 'field-error', id: `${id}-error`, hidden: true }));
}
