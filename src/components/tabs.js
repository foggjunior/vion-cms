// WAI-ARIA tabs: arrow keys/Home/End move between tabs; all panels stay in the DOM so form state persists.
import { h } from './dom.js';

export function createTabs({ id, tabs, initial, onSelect }) {
  const buttons = new Map();
  const panels = new Map();
  const badges = new Map();
  const list = h('div', { class: 'tablist', role: 'tablist', 'aria-label': 'Editor sections' });
  for (const tab of tabs) {
    const badge = h('span', { class: 'tab-badge', hidden: true });
    const btn = h('button', {
      type: 'button', role: 'tab', id: `${id}-tab-${tab.id}`, 'aria-controls': `${id}-panel-${tab.id}`, class: 'tab',
      on: { click: () => select(tab.id, true), keydown: onKey }
    }, tab.label, badge);
    const panel = h('section', { role: 'tabpanel', id: `${id}-panel-${tab.id}`, 'aria-labelledby': btn.id, class: 'tabpanel', tabindex: '-1' }, tab.content);
    buttons.set(tab.id, btn);
    panels.set(tab.id, panel);
    badges.set(tab.id, badge);
    list.append(btn);
  }
  let current = null;

  function select(tabId, focusTab = false) {
    if (!buttons.has(tabId)) return;
    current = tabId;
    for (const [key, btn] of buttons) {
      const active = key === tabId;
      btn.setAttribute('aria-selected', String(active));
      btn.tabIndex = active ? 0 : -1;
      panels.get(key).hidden = !active;
    }
    if (focusTab) buttons.get(tabId).focus();
    onSelect?.(tabId);
  }

  function onKey(event) {
    const ids = [...buttons.keys()];
    const index = ids.indexOf(current);
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: ids.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(ids[(next + ids.length) % ids.length], true);
  }

  function setBadge(tabId, count, tone = 'error') {
    const badge = badges.get(tabId);
    if (!badge) return;
    badge.hidden = !count;
    badge.textContent = count ? String(count) : '';
    badge.className = `tab-badge tab-badge-${tone}`;
    badge.setAttribute('aria-label', count ? `${count} ${tone === 'error' ? 'error' : 'warning'}${count === 1 ? '' : 's'}` : '');
  }

  select(initial || tabs[0].id);
  return { list, panels: [...panels.values()], select, setBadge, get current() { return current; } };
}
