// Hash routes for the content modules and local tools. Record IDs in routes are stable UUIDs.
import { destinationModule } from './destinations.js';
import { accommodationModule } from './accommodations.js';
import { tourModule } from './tours.js';
import { createListView } from './list-view.js';
import { createEditorView } from './editor-view.js';
import { createPreviewView } from './preview-view.js';
import { createSiteView } from './site-view.js';
import { createMediaLibraryView } from './media-library-view.js';
import { createBackupView, createRedirectsView, createTaxonomyView } from './tools.js';

export const CONTENT_MODULES = Object.freeze({ tours: tourModule, destinations: destinationModule, accommodations: accommodationModule });

// Sidebar/quick-action labels that open working modules. Every other label stays a placeholder.
export const CONTENT_ROUTES = Object.freeze({
  'Tours List': '#/tours', 'Add Tour': '#/tours/new',
  'Destinations List': '#/destinations', 'Add Destination': '#/destinations/new',
  'Accommodations List': '#/accommodations', 'Add Accommodation': '#/accommodations/new'
});

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export function parseRoute(hash) {
  const raw = decodeURIComponent(String(hash || '').replace(/^#/, '')) || '/dashboard';
  const [pathPart, query = ''] = raw.split('?');
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  const params = new URLSearchParams(query);
  let m;
  if (path === '/' || path === '/dashboard') return { type: 'dashboard' };
  if ((m = path.match(/^\/(tours|destinations|accommodations)\/?$/))) return { type: 'list', def: CONTENT_MODULES[m[1]], params };
  if ((m = path.match(/^\/(tours|destinations|accommodations)\/new$/))) return { type: 'editor', def: CONTENT_MODULES[m[1]], id: null };
  if ((m = path.match(new RegExp(`^/(tours|destinations|accommodations)/(${UUID})$`, 'i')))) return { type: 'editor', def: CONTENT_MODULES[m[1]], id: m[2].toLowerCase() };
  if ((m = path.match(new RegExp(`^/(tours|destinations|accommodations)/(${UUID})/preview$`, 'i')))) return { type: 'preview', def: CONTENT_MODULES[m[1]], id: m[2].toLowerCase(), params };
  if (path === '/media') return { type: 'media' };
  if (path === '/taxonomies') return { type: 'taxonomies' };
  if (path === '/redirects') return { type: 'redirects' };
  if (path === '/backup') return { type: 'backup' };
  if ((m = path.match(/^\/site(\/.*)?$/))) return { type: 'site', path: m[1] || '/' };
  if ((m = path.match(/^\/section\/(\d+)\/([a-z0-9-]+)$/))) return { type: 'placeholder', moduleIndex: Number(m[1]), slug: m[2] };
  return { type: 'unknown', path };
}

export function createView(route, app) {
  switch (route.type) {
    case 'list': return createListView({ def: route.def, app, params: route.params });
    case 'editor': return createEditorView({ def: route.def, id: route.id, app });
    case 'preview': return createPreviewView({ def: route.def, id: route.id, app, params: route.params });
    case 'media': return createMediaLibraryView({ app });
    case 'taxonomies': return createTaxonomyView({ app });
    case 'redirects': return createRedirectsView({ app });
    case 'backup': return createBackupView({ app });
    case 'site': return createSiteView({ app, path: route.path });
    default: return null;
  }
}
