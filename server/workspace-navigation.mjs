import { canAccessFinance } from './policy.mjs';
import { iconMarkup } from '../src/components/dom.js';

function sidebarLink(id, href, label, icon) {
  return `<div class="nav-group" id="${id}"><a class="nav-toggle nav-page-link" href="${href}" title="${label}" aria-label="${label}">${iconMarkup(icon)}<span>${label}</span></a></div>`;
}

export function workspaceNavigation(html, role) {
  const links = [
    canAccessFinance(role) ? sidebarLink('workspace-finance', '/finance', 'Finance', 'file') : '',
    role === 'admin' ? sidebarLink('workspace-users', '/staff', 'Users', 'users') : ''
  ].join('');
  return html
    .replace('<nav id="navigation" aria-label="Main navigation">', `<nav id="navigation" aria-label="Main navigation">${links}`)
    .replace('src="/approved/app.js"', 'src="/approved/app.js?v=sidebar-links"');
}
