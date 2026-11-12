import {renderDashboard} from './src/review/workspace-views.js';
import {createReviewRepository} from './src/review/repository.js';
import { h, icon as iconEl, iconMarkup as icon, linkButton } from './src/components/dom.js';
import { notice, toast } from './src/components/feedback.js';
import { confirmDialog } from './src/components/dialog.js';
import { openWorkspace } from './src/storage/workspace.js';
import { slugify } from './src/modules/shared/routes.js';
import { CONTENT_ROUTES, createView, parseRoute } from './src/modules/registry.js';

window.__vionBooted = true;
document.addEventListener('cms-action-error', event => {
  toast(event.detail?.message || 'The action could not be completed.', { tone: 'error' });
});

// ---- Dashboard shell (sample fixtures; unchanged layout) ----
const modules=[['Dashboard','dashboard',[]],['Tour Packages','map',['Tours List','Add Tour','Activities / day trips','Add Activity','Taxonomies']],['Destinations','pin',['Destinations List','Add Destination']],['Accommodations','home',['Accommodations List','Add Accommodation']],['Bookings','calendar',['All Bookings','Quotation','Connect website']],['Safari Proposals','file',['Top Itineraries','Quotations List','Add Quotation / Itinerary']],['Blogs','edit',['Blog Posts','Add Post','Categories']],['Users','users',['Users List']],['Messages','message',['Messages List']],['Media Library','image',['Gallery']],['Email Subscribers','mail',['Mailing List']],['Vehicles','car',['Vehicles List','Add Vehicle']],['Migration','leaf',['Migration Posts','Add Post']],['Giving Back','heart',['Charity','Profiles']],['Settings','settings',['Setting Options','Team','Reports','Activity','Backup & import','Redirects','Review guide']],['Content','file',['Website pages','Experiences','FAQs','Navigation']]];
const moduleIndexFor = label => modules.findIndex(m => m[2].includes(label));
// Working modules get real routes; every other label opens an honest placeholder.
const hashFor = (label, index = moduleIndexFor(label)) => (label==='Add Post'&&index===12?'#/migration/new':CONTENT_ROUTES[label]) || `#/section/${index}/${slugify(label)}`;
const nav=document.getElementById('navigation');
modules.forEach(([label,i,children],n)=>{if (['Messages','Email Subscribers','Vehicles'].includes(label)) return; const group=document.createElement('div');group.className='nav-group';group.innerHTML=`<button class="nav-toggle ${n===0?'active':''}" data-module="${n}" ${children.length?`aria-expanded="false" aria-controls="submenu-${n}"`:'aria-current="page"'}>${icon(i)}<span>${label}</span>${children.length?'<span class="chevron">⌄</span>':''}</button>${children.length?`<div class="submenu" id="submenu-${n}" hidden>${children.map(c=>`<button data-child="${n}" data-href="${hashFor(c,n)}">${c}</button>`).join('')}</div>`:''}`;nav.appendChild(group)});
// ---- Shell state ----
const el = id => document.getElementById(id);
const dashboardEl = el('dashboard'), placeholderEl = el('modulePreview'), moduleRoot = el('moduleRoot'), pageHeading = document.querySelector('.page-heading'), previewNote = el('previewNote');
const DASHBOARD_NOTE = previewNote.innerHTML;


function setActiveNav(index, childLabel) {
  document.querySelectorAll('.nav-toggle').forEach(b => { const n=Number(b.dataset.module); b.classList.toggle('active', n === index); b.removeAttribute('aria-current'); if (n === index && !childLabel) b.setAttribute('aria-current', 'page'); });
  document.querySelectorAll('.submenu button').forEach(b => { const selected = Number(b.dataset.child) === index && b.firstChild.textContent === childLabel; b.classList.toggle('selected', selected); if (selected) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  if (index > 0) { const b = document.querySelector(`[data-module="${index}"]`); if (!b) return; b.setAttribute('aria-expanded', 'true'); el(`submenu-${index}`).hidden = false; }
}

function showRegion(region) {
  dashboardEl.hidden = region !== 'dashboard';
  placeholderEl.hidden = region !== 'placeholder';
  moduleRoot.hidden = region !== 'module';
  pageHeading.hidden = region === 'module';
  if (region === 'module') previewNote.replaceChildren(h('span', null, 'LOCAL PROTOTYPE'), ' Records and images are stored only in this browser. “Publish” makes content visible in the local preview only — nothing is sent to the live website.');
  else previewNote.innerHTML = DASHBOARD_NOTE;
}

function pageSkeleton(message, dashboard = false) {
  const bar = className => h('div', {class:['skeleton-bar',className]});
  return h('div', {class:'page-skeleton',role:'status'},
    h('span', {class:'visually-hidden'}, message),
    h('div', {'aria-hidden':'true',class:'skeleton-layout'},
      bar('skeleton-title'), bar('skeleton-subtitle'),
      dashboard ? h('div', {class:'skeleton-stats'}, bar(), bar(), bar()) : null,
      h('div', {class:'panel skeleton-panel'}, bar(), bar(), bar(), bar())));
}

async function showDashboard(isCurrent) {
  showRegion('dashboard');
  el('pageTitle').textContent = 'Dashboard';
  el('breadcrumb').textContent = 'Dashboard';
  el('pageSubtitle').textContent = 'Welcome back, Vion team. Here’s what’s happening today.';
  document.title = 'Dashboard · Vion Africa CMS';
  setActiveNav(0);
  dashboardEl.replaceChildren(pageSkeleton('Loading dashboard…', true));
  try { await renderDashboard(app,isCurrent); }
  catch (error) { if (isCurrent()) dashboardEl.replaceChildren(notice('error',error.message)); }
}

function showPlaceholder(index,slug){const label=modules[index]?.[2].find(c=>slugify(c)===slug);if(!label){showNotFound();return;}const destination=hashFor(label,index);if(destination.startsWith('#/section/'))showNotFound();else go(destination);}

function showNotFound() {
  mountView({ el: h('div', { class: 'panel empty-panel' }, iconEl('alert'), h('h1', { tabindex: '-1' }, 'Page not found'), h('p', null, 'This address does not match a page in the local CMS prototype.'), linkButton('Back to dashboard', '#/dashboard', { variant: 'primary' })), title: 'Not found', breadcrumb: 'Not found' });
}

function errorView(err) {
  return {
    el: h('div', { class: 'panel empty-panel' }, iconEl('alert'), h('h1', { tabindex: '-1' }, 'The local workspace could not be opened'),
      notice('error', err?.message || String(err)),
      h('p', null, 'Nothing was saved or changed. Serve the CMS at http://127.0.0.1:5173 (see README.md), allow site data for this page, then try again. If the CMS was just updated, press Ctrl+F5 (Cmd+Shift+R on a Mac) so the browser loads every new file.'),
      h('button', { type: 'button', class: 'btn btn-primary', on: { click: () => { workspacePromise = null; render(location.hash); } } }, 'Try again')),
    title: 'Storage unavailable', breadcrumb: 'Storage unavailable'
  };
}

function mountView(view) {
  showRegion('module');
  moduleRoot.replaceChildren(view.el);
  el('breadcrumb').textContent = view.breadcrumb || view.title;
  document.title = `${view.title} · Vion Africa CMS`;
  const index = view.navGroup ? modules.findIndex(m => m[0] === view.navGroup) : -1;
  setActiveNav(index, view.navLabel);
}

// ---- Workspace and app services for views ----
let workspacePromise = null;
const app = {
  workspace() {
    workspacePromise ??= openWorkspace({
      onBlocked: () => toast('Another tab is holding an older version of the local database open. Close other CMS tabs to continue.', { tone: 'error' }),
      onVersionChange: () => toast('The local database was upgraded in another tab. Reload this tab.', { tone: 'error' })
    }).catch(err => { workspacePromise = null; throw err; });
    return workspacePromise;
  },
  navigate(hash) { location.hash = hash; },
  replaceRoute(hash) { history.replaceState(history.state, '', hash); current.hash = location.hash; moduleRoot.dataset.renderedRoute = current.hash; },
  setTitle(title) { document.title = `${title} · Vion Africa CMS`; },
  setNav({ breadcrumb, navGroup, navLabel }) {
    el('breadcrumb').textContent = breadcrumb;
    setActiveNav(modules.findIndex(m => m[0] === navGroup), navLabel);
  },
  currentView() { return current.view; }
};
window.__vionApp = app; // test hook for local browser checks (e.g. simulated storage faults)

// ---- Router with unsaved-changes guard ----
let current = { hash: null, view: null };
let renderToken = 0;
let firstRender = true;

// data-route/data-ready on the module root say which route has finished rendering (used by browser checks).
function markReady(ready) {
  moduleRoot.dataset.renderedRoute = current.hash;
  moduleRoot.dataset.ready = String(ready);
}

// Each history entry gets an increasing index so the guard can tell Back from Forward.
let historyIndex = 0;
function stampHistory() {
  if (typeof history.state?.idx === 'number') { historyIndex = history.state.idx; return; }
  historyIndex = Math.max(Date.now(), historyIndex + 1);
  history.replaceState({ ...(history.state || {}), idx: historyIndex }, '');
}

async function render(hash) {
  const token = ++renderToken;
  current.view?.destroy?.();
  current = { hash: location.hash, view: null };
  stampHistory();
  markReady(false);
  // A dialog (e.g. the media picker) belongs to the view being left; it must not outlive it.
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  closeMobile();
  window.scrollTo({ top: 0 });
  const route = parseRoute(hash);
  if (route.type === 'dashboard') { await showDashboard(() => token === renderToken); if (token === renderToken) markReady(true); return; }
  if (route.type === 'placeholder') { showPlaceholder(route.moduleIndex, route.slug); markReady(true); return; }
  if (route.type === 'unknown') { showNotFound(); markReady(true); return; }
  showRegion('module');
  moduleRoot.replaceChildren(pageSkeleton('Loading page…'));
  let view;
  try { view = await createView(route, app); } catch (err) { console.error(err); view = errorView(err); }
  if (token !== renderToken) { view.destroy?.(); return; }
  current.view = view;
  mountView(view);
  if (!firstRender) (view.mounted ? view.mounted() : moduleRoot.querySelector('h1')?.focus({ preventScroll: true }));
  firstRender = false;
  markReady(true);
}

let confirming = false;
async function confirmLeave() {
  confirming = true;
  try {
    return await confirmDialog({ title: 'Leave without saving?', body: 'This editor has unsaved changes. If you leave now, they will be lost.', confirmLabel: 'Leave and discard changes', cancelLabel: 'Stay and keep editing', danger: true });
  } finally {
    confirming = false;
  }
}
const isDirty = () => !!current.view?.isDirty?.();
const discardCurrent = () => { if (current.view) current.view.isDirty = () => false; };

// Back/Forward (or an edited address) while the editor is dirty: undo the move without adding history
// entries, ask, and replay the move only if the user chooses to leave.
window.addEventListener('hashchange', async () => {
  const target = location.hash;
  if (target === current.hash) return;
  if (confirming) { history.go(history.state?.idx < historyIndex ? 1 : -1); return; }
  if (isDirty()) {
    const wentBack = typeof history.state?.idx === 'number' && history.state.idx < historyIndex;
    if (wentBack) history.forward(); else history.back();
    if (!(await confirmLeave())) return;
    discardCurrent();
    if (wentBack) history.back(); else location.hash = target;
    return;
  }
  firstRender = false;
  render(target);
});
window.addEventListener('beforeunload', e => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

// In-app navigation asks before the address changes, so choosing "Stay" leaves history untouched.
async function go(hash) {
  if (confirming) return;
  if (isDirty()) {
    if (!(await confirmLeave())) return;
    discardCurrent();
  }
  firstRender = false;
  if (location.hash !== hash) location.hash = hash;
  else render(hash);
}
document.addEventListener('click', e => {
  const link = e.target.closest('a[href^="#"]');
  if (!link || !isDirty() || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  e.stopPropagation();
  go(link.getAttribute('href'));
}, true);

// ---- Shell interactions ----
nav.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.module!==undefined){if(document.body.classList.contains('sidebar-collapsed'))setSidebarCollapsed(false);const n=Number(b.dataset.module);if(n===0){go('#/dashboard');return}const open=b.getAttribute('aria-expanded')==='true';b.setAttribute('aria-expanded',String(!open));el(`submenu-${n}`).hidden=open}else if(b.dataset.href)go(b.dataset.href)});
document.addEventListener('click',e=>{const target=e.target.closest('[data-href],[data-route]');if(target&&!nav.contains(target)&&!moduleRoot.contains(target)){go(target.dataset.href||hashFor(target.dataset.route))}if(!e.target.closest('.account-wrap'))closeAccount()});
document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();go('#/dashboard')});el('backDashboard').onclick=()=>go('#/dashboard');
const accountButton=el('accountButton'),accountMenu=el('accountMenu');function closeAccount(){accountMenu.hidden=true;accountButton.setAttribute('aria-expanded','false')}accountButton.onclick=()=>{accountMenu.hidden=!accountMenu.hidden;accountButton.setAttribute('aria-expanded',String(!accountMenu.hidden))};document.querySelectorAll('[data-account]').forEach(b=>b.onclick=()=>{closeAccount();if(b.dataset.account==='Settings')go(hashFor('Setting Options'));else if(b.dataset.account==='Profile')go('#/profile');else go('#/session-ended')});
const sidebar=el('sidebar'),scrim=el('scrim'),menuButton=el('menuButton');function closeMobile(){sidebar.classList.remove('open');scrim.classList.remove('visible');menuButton.setAttribute('aria-expanded','false')}menuButton.setAttribute('aria-expanded','false');menuButton.setAttribute('aria-controls','sidebar');menuButton.onclick=()=>{sidebar.classList.add('open');scrim.classList.add('visible');menuButton.setAttribute('aria-expanded','true')};scrim.onclick=closeMobile;document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector('dialog[open]')){const wasOpen=!accountMenu.hidden||sidebar.classList.contains('open');closeAccount();closeMobile();if(wasOpen)accountButton.focus()}});

render(location.hash);

app.workspace().then(async ws=>{const profile=await createReviewRepository(ws).profile();document.querySelector('.account-name strong').textContent=profile.name;document.querySelector('.avatar').textContent=profile.name.split(' ').map(x=>x[0]).slice(0,2).join('');}).catch(()=>{});

// Compact desktop navigation; the same control closes the phone drawer.
const sidebarCollapse=el('sidebarCollapse');
function setSidebarCollapsed(collapsed){
 document.body.classList.toggle('sidebar-collapsed',collapsed);
 sidebarCollapse.setAttribute('aria-expanded',String(!collapsed));
 sidebarCollapse.setAttribute('aria-label',collapsed?'Expand sidebar':'Collapse sidebar');
 sidebarCollapse.textContent=collapsed?'›':'‹';
}
sidebarCollapse.onclick=()=>{if(matchMedia('(max-width:700px)').matches){closeMobile();menuButton.focus();}else setSidebarCollapsed(!document.body.classList.contains('sidebar-collapsed'));};
nav.querySelectorAll('.nav-toggle').forEach(button=>{const label=button.querySelector('span')?.textContent;button.setAttribute('aria-label',label);button.title=label;});

document.getElementById('copyrightYear').textContent = String(new Date().getFullYear());
