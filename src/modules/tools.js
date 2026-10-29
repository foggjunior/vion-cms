// Local content tools: tour taxonomies, planned redirects, and backup/import with storage status.
import { button, clear, h, icon } from '../components/dom.js';
import { confirmDialog, messageDialog } from '../components/dialog.js';
import { errorDetails, notice, toast } from '../components/feedback.js';
import { TAXONOMY_NAMESPACES, taxonomyUsage } from './shared/records.js';
import { formatBytes, formatDateTime } from './shared/format.js';
import { DATA_BACKUP_NOTICE } from '../storage/backup.js';
import { storageEstimate } from '../storage/workspace.js';
import { toolNav } from './list-view.js';

const head = (title, intro) => h('div', { class: 'view-head' }, h('div', null, h('div', { class: 'eyebrow' }, 'LOCAL CONTENT TOOLS'), h('h1', { tabindex: '-1' }, title), h('p', { class: 'view-intro' }, intro)));
const viewResult = (el, title, extra = {}) => ({ el, title, breadcrumb: `Content tools / ${title}`, mounted() { el.querySelector('h1').focus({ preventScroll: true }); }, ...extra });

export async function createTaxonomyView({ app }) {
  const ws = await app.workspace();
  let ctx = await ws.loadContext();
  const body = h('div', { class: 'taxonomy-grid' });

  async function reload() { ctx = await ws.loadContext(); render(); }

  function namespaceCard(namespace, label) {
    const terms = [...ctx.taxonomies.values()].filter(t => t.namespace === namespace).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
    const addId = `term-add-${namespace}`;
    const addInput = h('input', { id: addId, class: 'input', type: 'text', maxlength: 80, placeholder: `New ${label.toLowerCase()}` });
    const message = h('p', { class: 'small', role: 'status' });
    const add = async () => {
      try { await ws.taxonomies.create(namespace, addInput.value); toast(`Added ${label.toLowerCase()} “${addInput.value.trim()}”.`); await reload(); document.getElementById(addId)?.focus(); } catch (err) { message.textContent = err.message; }
    };
    addInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    return h('section', { class: 'panel taxonomy-card' },
      h('h2', null, `${label}s`),
      terms.length ? h('ul', { class: 'term-list' }, terms.map(term => {
        const usage = taxonomyUsage(term.id, ctx);
        const input = h('input', { class: 'input', type: 'text', value: term.label, maxlength: 80, 'aria-label': `Label for ${term.label}` });
        return h('li', null, input,
          h('small', { class: 'muted' }, usage.length ? `Used by ${usage.length}` : 'Unused'),
          button('Rename', { variant: 'ghost', 'aria-label': `Rename ${term.label}`, onClick: async () => {
            try { await ws.taxonomies.rename(term.id, input.value, { expectedVersion: term.version }); toast('Term renamed. Its ID is unchanged, so tours keep their link.'); await reload(); } catch (err) { message.textContent = err.message; }
          } }),
          button('Delete', { variant: 'ghost-danger', disabled: usage.length > 0, 'aria-label': `Delete ${term.label}`, title: usage.length ? `Used by: ${usage.map(u => u.title).join(', ')}. Remove it from those tours first.` : 'Delete term', onClick: async () => {
            if (!(await confirmDialog({ title: `Delete “${term.label}”?`, body: 'The term is not used by any tour.', confirmLabel: 'Delete term', danger: true }))) return;
            try { await ws.taxonomies.remove(term.id); toast('Term deleted.'); } catch (err) { await messageDialog({ title: 'Not deleted', body: errorDetails(err) }); }
            await reload();
          } }));
      })) : h('p', { class: 'muted' }, 'No terms yet.'),
      h('div', { class: 'add-row' }, h('label', { for: addId, class: 'visually-hidden' }, `New ${label.toLowerCase()}`), addInput, button('Add', { iconName: 'plus', onClick: add })),
      message);
  }

  function render() {
    clear(body).append(...Object.entries(TAXONOMY_NAMESPACES).map(([ns, label]) => namespaceCard(ns, label)));
  }
  render();
  const el = h('div', null,
    head('Tour taxonomies', 'Prototype tour types, categories, standards and tags with stable IDs.'),
    toolNav('taxonomies'),
    notice('warning', 'Taxonomy definitions are unresolved (B4). These terms are local prototype values only and do not claim to match existing CMS values. Terms cannot be deleted while any tour (draft or published) uses them.'),
    body);
  return viewResult(el, 'Tour taxonomies');
}

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
          h('td', null, env ? h('a', { href: `#/${env.kind}s/${env.id}` }, env.record.title) : 'Missing record'), h('td', null, formatDateTime(r.createdAt)));
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
    clear(storageEl).append(
      h('p', null, `${ctx.records.size} records · ${ctx.published.size} published snapshots · ${ctx.assets.size} images · ${ctx.taxonomies.size} taxonomy terms · ${ctx.redirects.length} planned redirects.`),
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
    const check = ws.backup.validateDataBackup(data);
    if (!check.ok) {
      importOut.append(notice('error', h('strong', null, 'Backup rejected — nothing was changed. '), `${check.errors.length} problem${check.errors.length === 1 ? '' : 's'} found:`, h('ul', { class: 'error-list' }, check.errors.slice(0, 50).map(e => h('li', null, e)))));
      return;
    }
    const s = check.summary;
    const ok = await confirmDialog({
      title: 'Replace all local content with this backup?',
      body: h('div', null, h('p', null, `The backup is valid: ${s.records} records, ${s.published} published snapshots, ${s.redirects} redirects, ${s.taxonomies} terms, ${s.assets} image records.`),
        h('p', null, 'All current local records, snapshots, redirects, terms and image details will be replaced. Image files are kept only for images listed in the backup. Export a backup of the current data first if you may need it.'),
        data.binaryAssetsIncluded === false ? h('p', null, 'This data backup contains no image files; import the matching media backup afterwards.') : null),
      confirmLabel: 'Replace local content', danger: true
    });
    if (!ok) return;
    try {
      await ws.backup.importData(data);
      importOut.append(notice('success', h('strong', null, 'Import complete. '), `Imported ${s.records} records and ${s.assets} image records.`));
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
      h('p', { class: 'field-hint' }, 'The media backup stores each original image as base64 text with its details. It can be large. Format: schemasVersion 1.')),
    h('section', { class: 'panel tool-panel' }, h('h2', null, 'Import data backup'),
      h('p', null, 'Replaces all local records, published snapshots, planned redirects, taxonomy terms and image details. The whole file is validated first (format and version, record schema, unsafe links, references, unique routes, redirect loops, image types); if anything is wrong, nothing changes.'),
      h('div', { class: 'btn-row' }, fileButton('import-data-file', 'Choose data backup…', importData)), importOut),
    h('section', { class: 'panel tool-panel' }, h('h2', null, 'Import media backup'),
      h('p', null, 'Restores image files from a media backup. Every image is checked (JPEG/PNG/WebP content, size limit, decodable) before anything is stored.'),
      h('div', { class: 'btn-row' }, fileButton('import-media-file', 'Choose media backup…', importMedia)), mediaOut));
  renderStorage();
  return viewResult(el, 'Backup & import');
}
