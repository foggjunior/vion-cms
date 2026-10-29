// Local media library: upload, edit default alt/credit/caption, see usage, delete only unreferenced images.
import { button, clear, h } from '../components/dom.js';
import { confirmDialog, messageDialog } from '../components/dialog.js';
import { errorDetails, notice, toast } from '../components/feedback.js';
import { MediaUrlScope, assetImage, assetSummary } from '../components/media.js';
import { uploadFiles, uploadResultList } from '../components/media-picker.js';
import { ACCEPT_ATTRIBUTE, MEDIA_LIMITS } from '../storage/media-validation.js';
import { KIND_LABELS, assetUsage } from './shared/records.js';
import { formatBytes, formatDateTime } from './shared/format.js';
import { toolNav } from './list-view.js';

export async function createMediaLibraryView({ app }) {
  const ws = await app.workspace();
  let ctx = await ws.loadContext();
  const scope = new MediaUrlScope(ws.media);
  const grid = h('div', { class: 'library-grid' });
  const uploadResults = h('div', { 'aria-live': 'polite' });
  const search = h('input', { id: 'library-search', type: 'search', class: 'input', placeholder: 'Search by file name, alt text or credit', on: { input: render } });

  async function reload() {
    ctx = await ws.loadContext();
    render();
  }

  function card(asset) {
    const usage = assetUsage(asset.id, ctx);
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
                toast(`Saved details for ${asset.fileName}.`);
                await reload();
              } catch (err) { status.textContent = err.message; }
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
          usage.length ? h('ul', null, usage.map(u => h('li', null, h('a', { href: `#/${u.kind}s/${u.recordId}` },`${KIND_LABELS[u.kind]} “${u.title}”`), ` — ${u.role}, ${u.where}`))) : h('p', { class: 'muted small' }, 'Safe to delete.'))));
  }

  function render() {
    clear(grid);
    const term = search.value.trim().toLowerCase();
    const assets = [...ctx.assets.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
      .filter(a => !term || [a.fileName, a.alt, a.credit].join(' ').toLowerCase().includes(term));
    if (!ctx.assets.size) grid.append(h('p', { class: 'muted' }, 'No images yet. Upload images here or from any editor’s Media tab.'));
    else if (!assets.length) grid.append(h('p', { class: 'muted' }, 'No images match your search.'));
    for (const asset of assets) grid.append(card(asset));
  }

  const fileInput = h('input', {
    id: 'library-upload', type: 'file', accept: ACCEPT_ATTRIBUTE, multiple: true, class: 'visually-hidden-file',
    on: {
      change: async e => {
        const files = [...e.target.files];
        e.target.value = '';
        if (!files.length) return;
        clear(uploadResults).append(h('p', { class: 'muted' }, 'Checking files…'));
        const { results } = await uploadFiles(ws, files);
        clear(uploadResults).append(uploadResultList(results));
        await reload();
      }
    }
  });

  const missing = [...ctx.assets.values()].filter(a => !a.hasBlob).length;
  const el = h('div', { class: 'library-view' },
    h('div', { class: 'view-head' },
      h('div', null, h('div', { class: 'eyebrow' }, 'LOCAL CONTENT TOOLS'), h('h1', { tabindex: '-1' }, 'Media library'),
        h('p', { class: 'view-intro' }, 'One local asset library shared by destinations, accommodations and tours. Images are stored only in this browser.')),
      h('div', null, fileInput, h('label', { for: 'library-upload', class: 'btn btn-primary' }, 'Upload images'))),
    toolNav('media'),
    notice('info', `JPEG, PNG and WebP up to ${formatBytes(MEDIA_LIMITS.maxBytes)}; SVG uploads are rejected. Files are checked by content and must decode. Images narrower than ${MEDIA_LIMITS.lowResolutionWidth}px get a warning only. Referenced images cannot be deleted. This is a local prototype library; the existing Gallery section’s behaviour (E1) is unconfirmed.`),
    missing ? notice('warning', `${missing} image${missing === 1 ? ' has' : 's have'} details but no file in this browser (usually after importing a data backup without its media backup). Import the media backup on the Backup & import page.`) : null,
    uploadResults,
    h('div', { class: 'list-toolbar panel' }, h('div', { class: 'field' }, h('label', { for: 'library-search', class: 'field-label' }, 'Search'), search)),
    grid);
  render();
  return {
    el, title: 'Media library', breadcrumb: 'Content tools / Media library',
    mounted() { el.querySelector('h1').focus({ preventScroll: true }); },
    destroy() { scope.revokeAll(); }
  };
}
