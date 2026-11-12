import {DEFINITIONS} from '../review/model.js';
import {createReviewView} from '../review/views.js';
import {createWorkspaceView} from '../review/workspace-views.js';
import {createWebsiteConnectionView} from '../operations/website-view.js';
import { createOperationsView } from '../operations/views.js';
import { createBookingsView } from './bookings-view.js';
// Hash routes for the content modules and local tools. Record IDs in routes are stable UUIDs.
import { destinationModule } from './destinations.js';
import { accommodationModule } from './accommodations.js';
import { tourModule } from './tours.js';
import { dayTripModule } from './day-trips.js';
import { createListView } from './list-view.js';
import { createEditorView } from './editor-view.js';
import { createPreviewView } from './preview-view.js';
import { createSiteView } from './site-view.js';
import { createMediaLibraryView } from './media-library-view.js';
import { createBackupView, createRedirectsView } from './tools.js';
import { createTaxonomyView } from './taxonomy-view.js';
import { createDayTripDefaultsView } from './day-trip-defaults-view.js';
import { settingsModule } from './settings.js';
import { teamModule } from './team.js';
import { createTeamListView } from './team-list-view.js';
import { createMemberPreviewView, createSettingsPreviewView, createTeamPagePreviewView } from './site-preview-view.js';

export const CONTENT_MODULES = Object.freeze({ tours: tourModule, destinations: destinationModule, accommodations: accommodationModule, 'day-trips': dayTripModule });

// Sidebar/quick-action labels that open working modules. Every other label stays a placeholder.
export const CONTENT_ROUTES = Object.freeze({
  'All Bookings': '#/bookings', 'Connect website':'#/bookings/connect', 'Quotation': '#/quotations', 'Quotations List':'#/quotations', 'Add Quotation / Itinerary':'#/quotations/new',
  'Tours List': '#/tours', 'Add Tour': '#/tours/new',
  'Activities / day trips': '#/day-trips', 'Add Activity': '#/day-trips/new', 'Taxonomies': '#/taxonomies',
  'Destinations List': '#/destinations', 'Add Destination': '#/destinations/new',
  'Accommodations List': '#/accommodations', 'Add Accommodation': '#/accommodations/new',
  'Setting Options': '#/settings', 'Team': '#/team',
  'Top Itineraries':'#/top-itineraries','Blog Posts':'#/blogs','Add Post':'#/blogs/new','Categories':'#/categories','Users List':'#/users','Gallery':'#/media','Migration Posts':'#/migration','Charity':'#/impact','Profiles':'#/foundations','Website pages':'#/pages','Experiences':'#/experiences','FAQs':'#/faqs','Navigation':'#/menus','Reports':'#/reports','Activity':'#/activity','Backup & import':'#/backup','Redirects':'#/redirects','Review guide':'#/help'
});

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

// The query is split off before decoding, so encoded "&", "=" or "?" inside a value (a search term or a
// filter value) stay part of that value.
export function parseRoute(hash) {
  const text = String(hash || '').replace(/^#/, '') || '/dashboard';
  const cut = text.indexOf('?');
  let pathPart = cut === -1 ? text : text.slice(0, cut);
  try { pathPart = decodeURIComponent(pathPart); } catch { return { type: 'unknown', path: pathPart }; }
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  const params = new URLSearchParams(cut === -1 ? '' : text.slice(cut + 1));
  const modules = 'tours|destinations|accommodations|day-trips';
  let m;
  const reviewKeys=Object.keys(DEFINITIONS).join('|');
  if((m=path.match(new RegExp(`^/(${reviewKeys})(?:/(new|${UUID}))?(?:/(preview))?$`,'i'))))return {type:'review',key:m[1],id:m[2]&&m[2]!=='new'?m[2]:null,mode:m[3]?'preview':m[2]?'editor':'list'};
  if(['/profile','/activity','/reports','/help','/session-ended','/top-itineraries'].includes(path))return {type:'workspace-view',name:path.slice(1)};
  if (path === '/' || path === '/dashboard') return { type: 'dashboard' };
  if (path === '/bookings/connect') return {type:'website-connection'};
  if (path === '/bookings') return { type: 'bookings' };
  if (path === '/bookings/new') return { type: 'bookings', edit: true, params };
  if ((m = path.match(new RegExp(`^/bookings/(${UUID})$`, 'i')))) return { type: 'bookings', id: m[1] };
  if (path === '/quotations') return params.get('booking') ? {type:'operation', mode:'quote', params} : {type:'operation',mode:'list',params};
  if (path === '/quotations/new') return {type:'operation',mode:'quote',params};
  if ((m=path.match(new RegExp(`^/quotations/(${UUID})$`,'i')))) return {type:'operation',mode:'quote',id:m[1],params};
  if ((m=path.match(new RegExp(`^/costing/tour/(${UUID})$`,'i')))) return {type:'operation',mode:'tour',id:m[1],params};
  if ((m=path.match(new RegExp(`^/rates/(accommodation)/(${UUID})$`,'i')))) return {type:'operation',mode:'rates',entityKind:m[1],id:m[2],params};
  if (path === '/day-trips/defaults') return { type: 'day-trip-defaults' };
  if ((m = path.match(new RegExp(`^/(${modules})/?$`)))) return { type: 'list', def: CONTENT_MODULES[m[1]], params };
  if ((m = path.match(new RegExp(`^/(${modules})/new$`)))) return { type: 'editor', def: CONTENT_MODULES[m[1]], id: null };
  if ((m = path.match(new RegExp(`^/(${modules})/(${UUID})$`, 'i')))) return { type: 'editor', def: CONTENT_MODULES[m[1]], id: m[2].toLowerCase() };
  if ((m = path.match(new RegExp(`^/(${modules})/(${UUID})/preview$`, 'i')))) return { type: 'preview', def: CONTENT_MODULES[m[1]], id: m[2].toLowerCase(), params };
  if (path === '/settings') return { type: 'editor', def: settingsModule, id: null };
  if (path === '/settings/preview') return { type: 'settings-preview', params };
  if (path === '/team' || path === '/team/') return { type: 'team-list', params };
  if (path === '/team/new') return { type: 'editor', def: teamModule, id: null };
  if (path === '/team/preview') return { type: 'team-preview', params };
  if ((m = path.match(new RegExp(`^/team/(${UUID})$`, 'i')))) return { type: 'editor', def: teamModule, id: m[1].toLowerCase() };
  if ((m = path.match(new RegExp(`^/team/(${UUID})/preview$`, 'i')))) return { type: 'member-preview', id: m[1].toLowerCase(), params };
  if (path === '/media') return { type: 'media' };
  if (path === '/taxonomies') return { type: 'taxonomies', params };
  if (path === '/redirects') return { type: 'redirects' };
  if (path === '/backup') return { type: 'backup' };
  if ((m = path.match(/^\/site(\/.*)?$/))) return { type: 'site', path: m[1] || '/', params };
  if ((m = path.match(/^\/section\/(\d+)\/([a-z0-9-]+)$/))) return { type: 'placeholder', moduleIndex: Number(m[1]), slug: m[2] };
  return { type: 'unknown', path };
}

export function createView(route, app) {
  switch (route.type) {
    case 'review': return createReviewView({app,key:route.key,id:route.id,mode:route.mode});
    case 'workspace-view':return createWorkspaceView({app,type:route.name});
    case 'website-connection': return createWebsiteConnectionView({app});
    case 'bookings': return createBookingsView({ app, id: route.id, edit: route.edit, params:route.params });
    case 'operation': return createOperationsView({ app, mode:route.mode, id:route.id, entityKind:route.entityKind, params:route.params });
    case 'list': return createListView({ def: route.def, app, params: route.params });
    case 'editor': return createEditorView({ def: route.def, id: route.id, app });
    case 'preview': return createPreviewView({ def: route.def, id: route.id, app, params: route.params });
    case 'media': return createMediaLibraryView({ app });
    case 'taxonomies': return createTaxonomyView({ app, params: route.params });
    case 'day-trip-defaults': return createDayTripDefaultsView({ app });
    case 'redirects': return createRedirectsView({ app });
    case 'backup': return createBackupView({ app });
    case 'site': return createSiteView({ app, path: route.path, params: route.params });
    case 'settings-preview': return createSettingsPreviewView({ app, params: route.params });
    case 'team-list': return createTeamListView({ app, params: route.params });
    case 'team-preview': return createTeamPagePreviewView({ app, params: route.params });
    case 'member-preview': return createMemberPreviewView({ app, id: route.id, params: route.params });
    default: return null;
  }
}
