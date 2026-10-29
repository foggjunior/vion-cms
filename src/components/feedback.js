// Toasts, status badges and inline notices.
import { h, icon } from './dom.js';
import { hasUnpublishedChanges } from '../modules/shared/records.js';

let toastTimer;
export function toast(message, { tone = 'info' } = {}) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.dataset.tone = tone;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, tone === 'error' ? 8000 : 4500);
}

const STATUS_LABELS = { draft: 'Draft', published: 'Published', archived: 'Archived' };

export function statusBadge(status) {
  return h('span', { class: `status-badge status-${status}` }, STATUS_LABELS[status] || status);
}

export function envelopeBadges(env) {
  return h('span', { class: 'badge-row' }, statusBadge(env.record.status),
    hasUnpublishedChanges(env) ? h('span', { class: 'status-badge status-changes', title: 'The working draft differs from the published snapshot' }, 'Unpublished changes') : null);
}

export function notice(tone, ...content) {
  return h('div', { class: `notice notice-${tone}`, role: tone === 'error' ? 'alert' : null }, icon(tone === 'error' || tone === 'warning' ? 'alert' : tone === 'success' ? 'check' : 'info'), h('div', null, ...content));
}

// Explains a repository/storage error with its details (validation issues, dependents, import errors).
export function errorDetails(err) {
  const items = [...(err.issues || []).map(i => i.message), ...(err.errors || [])];
  return h('div', null, h('p', null, err.message || String(err)),
    items.length ? h('ul', { class: 'error-list' }, items.slice(0, 40).map(text => h('li', null, text)), items.length > 40 ? h('li', null, `…and ${items.length - 40} more.`) : null) : null);
}
