// Local content tools: planned redirects, and backup/import with storage status. (Taxonomies have their own
// screen under Tour Packages › Taxonomies: taxonomy-view.js.)
import { button, clear, h, icon } from '../components/dom.js';
import { confirmDialog, messageDialog } from '../components/dialog.js';
import { errorDetails, notice, toast } from '../components/feedback.js';
import { editorHref } from './shared/site.js';
import { formatBytes, formatDateTime } from './shared/format.js';
import { DATA_BACKUP_NOTICE, LEGACY_IMPORT_NOTICES, SCHEMAS_VERSION } from '../storage/backup.js';
import { storageEstimate } from '../storage/workspace.js';
import { toolNav } from './list-view.js';

const head = (title, intro) => h('div', { class: 'view-head' }, h('div', null, h('div', { class: 'eyebrow' }, 'LOCAL CONTENT TOOLS'), h('h1', { tabindex: '-1' }, title), h('p', { class: 'view-intro' }, intro)));
const viewResult = (el, title, extra = {}) => ({ el, title, breadcrumb: `Content tools / ${title}`, mounted() { el.querySelector('h1').focus({ preventScroll: true }); }, ...extra });

export async function createRedirectsView({ app }) {
  const ws = await app.workspace();
  const ctx = await ws.loadContext();
  const redirects = [...ctx.redirects].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const el = h('div', null,
    head('Planned redirects', 'Local 308 redirect entries recorded when a published slug changes.'),
    toolNav('redirects'),
    notice('warning', 'These are planned local entries for review only. They are not real server redirects and do not change any live website URL (C2 unresolved). Query-preset aliases are not handled here.'),
    redirects.length ? h('div', { class: 'table-scroll panel table-panel' }, h('table', { class: 'data-table' },
      h('thead', null, h('tr', null, ['From', 'To', 'Status', 'Record', 'Planned (EAT)'].map(t => h('th', { scope: 'col' }, t)))),
      h('tbody', null, redirects.map(r => {
        const env = ctx.records.get(r.recordId);
        return h('tr', null, h('td', null, h('a', { href: `#/site${r.from}` }, r.from)), h('td', null, r.to), h('td', null, String(r.statusCode)),
          h('td', null, env ? h('a', { href: editorHref(env.kind, env.id) }, env.record.title) : 'Missing record'), h('td', null, formatDateTime(r.createdAt)));
      }))))
      : h('div', { class: 'empty-state panel' }, h('span', null, icon('redirect')), h('strong', null, 'No planned redirects'), h('p', null, 'A redirect is planned when you republish a record whose published slug changed.')));
  return viewResult(el, 'Planned redirects');
}

function download(filename, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function readJsonFile(file) {
  const text = await file.text();
  try { return JSON.parse(text); } catch { throw new Error('The file is not valid JSON.'); }
}

export async function createBackupView({ app }) {
  const ws = await app.workspace();
  const storageEl = h('div', { class: 'storage-status' });
  const importOut = h('div', { 'aria-live': 'polite' });
  const mediaOut = h('div', { 'aria-live': 'polite' });
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  async function renderStorage() {
    const est = await storageEstimate();
    const ctx = await ws.loadContext();
    const site = [...ctx.siteRecords.values()];
    const profiles = site.filter(env => env.kind === 'teamMember').length;
    const dayTrips = [...ctx.records.values()].filter(env => env.kind === 'dayTrip').length;
    const defaults = await ws.defaults.getDayTripDefaults();
    clear(storageEl).append(
      h('p', null, `${ctx.records.size} records (${dayTrips} day trip${dayTrips === 1 ? '' : 's'}) · ${ctx.published.size} published snapshots · ${ctx.assets.size} images · ${ctx.taxonomies.size} taxonomy terms (${ctx.taxonomyPublication ? `published taxonomy revision ${ctx.taxonomyPublication.revision}` : 'taxonomy not published'}) · ${ctx.redirects.length} planned redirects · day-trip defaults ${defaults ? 'saved' : 'not saved'}.`),
      h('p', null, `Site settings: ${ctx.siteRecords.has('site-settings') ? (ctx.sitePublished.has('site-settings') ? 'saved and published' : 'saved, not published') : 'not saved yet'} · ${profiles} team profile${profiles === 1 ? '' : 's'} · team order ${ctx.sitePublished.has('team-lineup') ? 'published' : ctx.siteRecords.has('team-lineup') ? 'not published' : 'not created yet'}.`),
      h('p', null, est.usage != null ? `Browser storage used by this site: ${formatBytes(est.usage)} of about ${formatBytes(est.quota)} available.` : 'Storage usage is not reported by this browser.'),
      h('p', null, est.persisted ? 'Persistent storage is granted: the browser should not clear this data automatically.' : 'Storage is “best effort”: the browser may clear it under storage pressure. Export backups regularly.'),
      est.persisted ? null : button('Request persistent storage', { onClick: async () => { const ok = await navigator.storage?.persist?.(); toast(ok ? 'Persistent storage granted.' : 'The browser did not grant persistent storage.'); renderStorage(); } }));
  }

  function fileButton(id, label, onFile) {
    const input = h('input', { id, type: 'file', accept: 'application/json,.json', class: 'visually-hidden-file', on: { change: async e => { const file = e.target.files[0]; e.target.value = ''; if (file) await onFile(file); } } });
    return [input, h('label', { for: id, class: 'btn btn-secondary' }, label)];
  }

  async function importData(file) {
    clear(importOut);
    let data;
    try { data = await readJsonFile(file); } catch (err) { importOut.append(notice('error', err.message)); return; }
    // Dry run: validates the file and, for older backups, the current records it would keep.
    const check = await ws.backup.previewImport(data);
    if (!check.ok) {
      importOut.append(notice('error', h('strong', null, 'Backup rejected — nothing was changed. '), `${check.errors.length} problem${check.errors.length === 1 ? '' : 's'} found:`, h('ul', { class: 'error-list' }, check.errors.slice(0, 50).map(e => h('li', null, e)))));
      return;
    }
    const s = check.summary;
    const ok = await confirmDialog({
      title: check.legacy ? `Import this older backup (schemasVersion ${check.version})?` : 'Replace all local content with this backup?',
      body: h('div', null, h('p', null, `The backup is valid: ${s.records} records (${s.dayTrips} day trip${s.dayTrips === 1 ? '' : 's'}), ${s.published} published snapshots, ${s.redirects} redirects, ${s.taxonomies} terms, ${s.assets} image records${s.settings === null ? '' : `, ${s.settings ? 'site settings' : 'no site settings'}, ${s.teamProfiles} team profile${s.teamProfiles === 1 ? '' : 's'}`}${check.legacy ? '' : `, ${s.dayTripDefaults ? 'day-trip defaults' : 'no day-trip defaults'}`}.`),
        check.legacy
          ? h('div', null, notice('warning', LEGACY_IMPORT_NOTICES[check.version]),
            h('p', null, `Kept from this browser: ${check.kept.dayTrips} day trip${check.kept.dayTrips === 1 ? '' : 's'}, ${check.kept.terms} term${check.kept.terms === 1 ? '' : 's'} they use, ${check.kept.defaults ? 'the day-trip defaults' : 'no day-trip defaults (none saved)'}${check.version === 1 ? `, ${check.kept.siteRecords} site record${check.kept.siteRecords === 1 ? '' : 's'}` : ''} and ${check.kept.assets} image record${check.kept.assets === 1 ? '' : 's'} they use.`))
          : h('p', null, 'All current local records (including day trips), snapshots, redirects, taxonomy terms and the published taxonomy, day-trip defaults, site settings, team profiles, team order and image details will be replaced. Image files are kept only for images listed in the backup.'),
        check.warnings.length ? h('div', null, h('p', null, `${check.warnings.length} warning${check.warnings.length === 1 ? '' : 's'} (imported as they are, flagged in the editors):`), h('ul', { class: 'error-list' }, check.warnings.slice(0, 20).map(w => h('li', null, w)))) : null,
        h('p', null, 'Export a backup of the current data first if you may need it.'),
        data.binaryAssetsIncluded === false ? h('p', null, 'This data backup contains no image files; import the matching media backup afterwards.') : null),
      confirmLabel: 'Replace local content', danger: true
    });
    if (!ok) return;
    try {
      const applied = await ws.backup.importData(data);
      importOut.append(notice('success', h('strong', null, 'Import complete. '), `Imported ${s.records} records and ${s.assets} image records.`,
        check.legacy
          ? ` Kept ${applied.keptDayTrips} day trip${applied.keptDayTrips === 1 ? '' : 's'}, ${applied.keptTerms} term${applied.keptTerms === 1 ? '' : 's'} they use${applied.keptDefaults ? ', the day-trip defaults' : ''}${check.version === 1 ? `, ${applied.keptSiteRecords} site record${applied.keptSiteRecords === 1 ? '' : 's'} (settings, team profiles, team order)` : ''} and ${applied.keptAssets} image record${applied.keptAssets === 1 ? '' : 's'} they use.`
          : ` Imported ${s.teamProfiles} team profile${s.teamProfiles === 1 ? '' : 's'}${s.settings ? ' and the site settings' : ''}${s.dayTripDefaults ? ' and the day-trip defaults' : ''}.`,
        applied.missingFiles ? ` ${applied.missingFiles} image${applied.missingFiles === 1 ? ' has' : 's have'} no file in this browser yet — import the matching media backup; until then they show as “file missing” and block publishing.` : ''));
      toast('Backup imported.');
      renderStorage();
    } catch (err) {
      importOut.append(notice('error', errorDetails(err)));
    }
  }

  async function importMedia(file) {
    clear(mediaOut);
    let data;
    try { data = await readJsonFile(file); } catch (err) { mediaOut.append(notice('error', err.message)); return; }
    mediaOut.append(h('p', { class: 'muted' }, 'Checking every image…'));
    try {
      const result = await ws.backup.importMedia(data);
      clear(mediaOut).append(notice('success', h('strong', null, 'Media restored. '), `${result.restored} image file${result.restored === 1 ? '' : 's'} stored (${result.added} new image record${result.added === 1 ? '' : 's'}).`));
      toast('Media backup imported.');
      renderStorage();
    } catch (err) {
      clear(mediaOut).append(notice('error', errorDetails(err)));
    }
  }

  const el = h('div', null,
    head('Backup & import', 'Versioned JSON backups of the local content. Imports are fully validated before anything is changed.'),
    toolNav('backup'),
    h('section', { class: 'panel tool-panel' }, h('h2', null, 'Local storage'), storageEl),
    h('section', { class: 'panel tool-panel' }, h('h2', null, 'Export'),
      notice('warning', DATA_BACKUP_NOTICE),
      h('div', { class: 'btn-row' },
        button('Download data backup (JSON)', { variant: 'primary', iconName: 'database', onClick: async () => {
          try { download(`vion-cms-data-${stamp()}.json`, await ws.backup.exportData()); toast('Data backup downloaded (records only, no image files).'); } catch (err) { messageDialog({ title: 'Export failed', body: errorDetails(err) }); }
        } }),
        button('Download media backup (JSON with images)', { iconName: 'image', onClick: async () => {
          try {
            const media = await ws.backup.exportMedia();
            download(`vion-cms-media-${stamp()}.json`, media);
            toast(media.missingBinaries.length ? `Media backup downloaded; ${media.missingBinaries.length} image file(s) were missing and not included.` : 'Media backup downloaded.');
          } catch (err) { messageDialog({ title: 'Export failed', body: errorDetails(err) }); }
        } })),
      h('p', { class: 'field-hint' }, `Data backups are schemasVersion ${SCHEMAS_VERSION}. The media backup stores each original image (including day-trip images, portraits, logos and sharing images) as base64 text with its details. It can be large. Media format: schemasVersion 1 (unchanged).`)),
    h('section', { class: 'panel tool-panel' }, h('h2', null, 'Import data backup'),
      h('p', null, 'Replaces all local records (including day trips), published snapshots, planned redirects, taxonomy terms and the published taxonomy, day-trip defaults, site settings, team profiles, team order and image details. The whole file is validated first (format and version, record schemas, unsafe links, references, term groups, unique routes, redirect loops, singleton settings, team order integrity, image types and references); if anything is wrong, nothing changes.'),
      h('p', { class: 'field-hint' }, 'Older backups still import. schemasVersion 2 (before Day Trips) replaces destinations, accommodations, tours, terms, site settings, team and image details, and keeps your day trips, the day-trip defaults and the terms and images those day trips use. schemasVersion 1 (before Site Settings and Team) also keeps the current site settings, team profiles and team order. Kept records are checked against the imported content first; the import is refused if they would end up with broken links.'),
      h('div', { class: 'btn-row' }, fileButton('import-data-file', 'Choose data backup…', importData)), importOut),
    h('section', { class: 'panel tool-panel' }, h('h2', null, 'Import media backup'),
      h('p', null, 'Restores image files from a media backup. Every image is checked (JPEG/PNG/WebP content, size limit, decodable) before anything is stored.'),
      h('div', { class: 'btn-row' }, fileButton('import-media-file', 'Choose media backup…', importMedia)), mediaOut));
  renderStorage();
  return viewResult(el, 'Backup & import');
}
