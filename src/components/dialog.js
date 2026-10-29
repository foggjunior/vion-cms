// In-app modal dialogs built on <dialog>. Focus returns to the element that opened the dialog.
import { button, h } from './dom.js';

export function openDialog({ title, content, actions = [], wide = false, onClose }) {
  const opener = document.activeElement;
  let settle;
  const result = new Promise(resolve => { settle = resolve; });
  let returnValue;
  const titleId = `dialog-title-${Math.random().toString(36).slice(2)}`;
  const dialog = h('dialog', { class: ['modal', wide && 'modal-wide'], 'aria-labelledby': titleId },
    h('div', { class: 'modal-header' }, h('h2', { id: titleId }, title),
      h('button', { type: 'button', class: 'modal-close', 'aria-label': 'Close dialog', on: { click: () => close(undefined) } }, '×')),
    h('div', { class: 'modal-body' }, content),
    actions.length ? h('div', { class: 'modal-actions' }, actions.map(a => button(a.label, { variant: a.variant || 'secondary', onClick: () => (a.onClick ? a.onClick(close) : close(a.value)), 'data-autofocus': a.autofocus ? 'true' : null }))) : null);

  function close(value) {
    returnValue = value;
    if (dialog.open) dialog.close();
  }
  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose?.(returnValue);
    settle(returnValue);
    if (opener && document.contains(opener)) opener.focus();
  });
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector('[data-autofocus="true"]')?.focus();
  return { dialog, close, result };
}

export function confirmDialog({ title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return openDialog({
    title,
    content: typeof body === 'string' ? h('p', null, body) : body,
    actions: [
      { label: cancelLabel, value: false, autofocus: true },
      { label: confirmLabel, value: true, variant: danger ? 'danger' : 'primary' }
    ]
  }).result.then(value => value === true);
}

export function messageDialog({ title, body, closeLabel = 'OK' }) {
  return openDialog({ title, content: typeof body === 'string' ? h('p', null, body) : body, actions: [{ label: closeLabel, value: true, variant: 'primary', autofocus: true }] }).result;
}
