// Local media library: upload, edit default alt/credit/caption, see usage, delete only unreferenced images.
import { button, clear, h } from '../components/dom.js';
import { confirmDialog, messageDialog } from '../components/dialog.js';
import { errorDetails, notice, toast } from '../components/feedback.js';
import { MediaUrlScope, assetImage, assetSummary } from '../components/media.js';
import { runImageUpload } from '../components/media-picker.js';
import { ACCEPT_ATTRIBUTE, MEDIA_LIMITS } from '../storage/media-validation.js';
import { formatBytes, formatDateTime } from './shared/format.js';
import { toolNav } from './list-view.js';

export async function createMediaLibraryView({ app }) {
  const ws = await app.workspace();
  // One page of images at a time from ws.summaries.mediaPage, with where each image is used.
  let page = null, rows = [], failed = null, sequence = 0, timer = null;
  const scope = new MediaUrlScope(ws.media);
  const grid = h('div', { class: 'library-grid' });
  const uploadResults = h('div', { 'aria-live': 'polite' });
  const search = h('input', { id: 'library-search', type: 'search', class: 'input', placeholder: 'Search by file name, alt text or credit', on: { input: () => { clearTimeout(timer); timer = setTimeout(() => load(), 250); } } });

  async function load({ append = false } = {}) {
    const id = ++sequence;
    grid.setAttribute('aria-busy', 'true');
    try {
      const result = await ws.summaries.mediaPage({ q: search.value, after: append ? page?.next : null });
      if (id !== sequence) return;
      rows = append ? [...rows, ...result.rows] : result.rows; page = result; failed = null;
    } catch (err) {
      if (id !== sequence) return;
      failed = err;
    } finally {
      if (id === sequence) { grid.setAttribute('aria-busy', 'false'); render(); }
    }
  }
  const reload = () => load();

  function card({ asset, usage }) {
    const fields = {};
    const field = (key, label) => {
      const id = `asset-${asset.id}-${key}`;
      fields[key] = h('input', { id, class: 'input', type: 'text', value: asset[key] || '' });
      return h('div', { class: 'field' }, h('label', { for: id, class: 'field-label' }, label), fields[key]);
    };
    const status = h('p', { class: 'small', role: 'status' });
    return h('article', { class: 'library-card panel' },
      assetImage(scope, asset.id, { alt: asset.alt || '', className: 'library-img', asset }),
      h('div', { class: 'library-body' },
        assetSummary(asset),
        h('p', { class: 'small muted' }, `${asset.type} · added ${formatDateTime(asset.createdAt)}`),
        field('alt', 'Default alt text'), field('credit', 'Credit (optional)'), field('caption', 'Default caption (optional)'),
        h('p', { class: 'field-hint' }, 'Defaults are copied when the image is placed; each placement keeps its own contextual alt text.'),
        h('div', { class: 'btn-row' },
          button('Save details', {
            onClick: async () => {
              try {
                await ws.media.updateMeta(asset.id, { alt: fields.alt.value, credit: fields.credit.value, caption: fields.caption.value }, { expectedVersion: asset.version });
                toast(`Saved details for ${asset.fileName}.`, { tone: 'success' });
                await reload();
              } catch (err) { status.textContent = err.message; toast(err.message, { tone: 'error' }); }
            }
          }),
          button('Delete', {
            variant: 'ghost-danger', disabled: usage.length > 0,
            title: usage.length ? 'In use — remove it from the records listed below first.' : 'Delete this image from the local library',
            onClick: async () => {
              if (!(await confirmDialog({ title: `Delete ${asset.fileName}?`, body: 'The image file and its details are removed from this browser. This cannot be undone.', confirmLabel: 'Delete image', danger: true }))) return;
              try { await ws.media.remove(asset.id); toast(`Deleted ${asset.fileName}.`); } catch (err) { await messageDialog({ title: 'Not deleted', body: errorDetails(err) }); }
              await reload();
            }
          })),
        status,
        h('details', { class: 'usage' }, h('summary', null, usage.length ? `Used in ${usage.length} place${usage.length === 1 ? '' : 's'}` : 'Not used'),
          usage.length ? h('ul', null, usage.map(u => h('li', null, h('a', { href: u.href }, u.label), ` — ${u.role}, ${u.where}`))) : h('p', { class: 'muted small' }, 'Safe to delete.'))));
  }

  function render() {
    clear(grid);
    if (failed) { grid.append(notice('error', 'Images could not be loaded. ', errorDetails(failed), ' ', button('Try again', { variant: 'secondary', onClick: () => load() }))); return; }
    if (!page) { grid.append(h('p', { class: 'muted' }, 'Loading images…')); return; }
    if (!page.total) grid.append(h('p', { class: 'muted' }, 'No images yet. Upload images here or from any editor’s Media tab.'));
    else if (!rows.length) grid.append(h('p', { class: 'muted' }, 'No images match your search.'));
    for (const row of rows) grid.append(card(row));
    if (page.next) grid.append(h('div', { class: 'btn-row list-more' }, button(`Show more (${page.filtered - rows.length} more)`, { variant: 'secondary', onClick: () => load({ append: true }) })));
  }

  const fileInput = h('input', {
    id: 'library-upload', type: 'file', accept: ACCEPT_ATTRIBUTE, multiple: true, class: 'visually-hidden-file',
    on: {
      change: event => runImageUpload(event.currentTarget,ws,uploadResults,reload)
    }
  });

  await load();
  const missing = page?.missing || 0;
  const el = h('div', { class: 'library-view' },
    h('div', { class: 'view-head' },
      h('div', null, h('div', { class: 'eyebrow' }, 'LOCAL CONTENT TOOLS'), h('h1', { tabindex: '-1' }, 'Media library'),
        h('p', { class: 'view-intro' }, 'One local asset library shared by destinations, accommodations, tours, site settings (logos, sharing image) and team portraits. Images are stored only in this browser.')),
      h('div', null, fileInput, h('label', { for: 'library-upload', class: 'btn btn-primary' }, 'Upload images'))),
    toolNav('media'),
    notice('info', `JPEG, PNG and WebP up to ${formatBytes(MEDIA_LIMITS.maxBytes)}; SVG uploads are rejected. Files are checked by content and must decode. Images narrower than ${MEDIA_LIMITS.lowResolutionWidth}px get a warning only. Referenced images cannot be deleted. This is the shared local gallery for every content module.`),
    missing ? notice('warning', `${missing} image${missing === 1 ? ' has' : 's have'} details but no file in this browser (usually after importing a data backup without its media backup). Import the media backup on the Backup & import page.`) : null,
    uploadResults,
    h('div', { class: 'list-toolbar panel' }, h('div', { class: 'field' }, h('label', { for: 'library-search', class: 'field-label' }, 'Search'), search)),
    grid);
  render();
  return {
    el, title: 'Media library', breadcrumb: 'Content tools / Media library',navGroup:'Media Library',navLabel:'Gallery',
    mounted() { el.querySelector('h1').focus({ preventScroll: true }); },
    destroy() { scope.revokeAll(); }
  };
}
