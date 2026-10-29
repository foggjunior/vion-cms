// Media picker dialog: upload new images (inspected before storing) or reuse assets from the local library.
import { clear, h, icon } from './dom.js';
import { openDialog } from './dialog.js';
import { MediaUrlScope, assetImage } from './media.js';
import { ACCEPT_ATTRIBUTE, MEDIA_LIMITS, inspectImageFile } from '../storage/media-validation.js';
import { formatBytes } from '../modules/shared/format.js';
import { LOW_RESOLUTION_WIDTH } from '../modules/shared/validation.js';

// Uploads files after inspection. Returns { added: asset[], results: [{ fileName, ok, errors, warnings }] }.
export async function uploadFiles(workspace, files) {
  const added = [];
  const results = [];
  for (const file of files) {
    const inspected = await inspectImageFile(file);
    if (!inspected.ok) { results.push({ fileName: file.name, ok: false, errors: inspected.errors, warnings: inspected.warnings }); continue; }
    try {
      const asset = await workspace.media.add(inspected, { alt: '' });
      added.push(asset);
      results.push({ fileName: file.name, ok: true, errors: [], warnings: inspected.warnings });
    } catch (err) {
      results.push({ fileName: file.name, ok: false, errors: [err.message], warnings: [] });
    }
  }
  return { added, results };
}

export function uploadResultList(results) {
  return h('ul', { class: 'upload-results' }, results.map(r => h('li', { class: r.ok ? 'is-ok' : 'is-error' },
    icon(r.ok ? 'check' : 'alert'),
    h('div', null, h('strong', null, r.fileName), ' — ', r.ok ? 'stored in the local library' : 'rejected',
      [...r.errors, ...r.warnings].map(text => h('div', { class: 'small' }, text))))));
}

export async function openMediaPicker({ workspace, multiple = false, title = 'Choose image' }) {
  const scope = new MediaUrlScope(workspace.media);
  let assets = await workspace.media.list();
  const selected = new Map();
  const grid = h('div', { class: 'asset-grid', role: 'group', 'aria-label': 'Media library' });
  const results = h('div', { 'aria-live': 'polite' });
  const search = h('input', { type: 'search', class: 'input', placeholder: 'Search by file name or alt text', 'aria-label': 'Search media library', on: { input: renderGrid } });
  const useButtonLabel = () => (multiple ? `Use selected (${selected.size})` : 'Use image');

  function toggle(asset) {
    if (selected.has(asset.id)) selected.delete(asset.id);
    else {
      if (!multiple) selected.clear();
      selected.set(asset.id, asset);
    }
    renderGrid();
    updateUse();
  }

  function renderGrid() {
    clear(grid);
    const term = search.value.trim().toLowerCase();
    const visible = assets.filter(a => !term || a.fileName.toLowerCase().includes(term) || (a.alt || '').toLowerCase().includes(term));
    if (!assets.length) grid.append(h('p', { class: 'muted' }, 'The local library is empty. Upload an image above.'));
    else if (!visible.length) grid.append(h('p', { class: 'muted' }, 'No images match your search.'));
    for (const asset of visible) {
      const pressed = selected.has(asset.id);
      grid.append(h('button', {
        type: 'button', class: ['asset-tile', pressed && 'is-selected'], 'aria-pressed': String(pressed), disabled: !asset.hasBlob,
        title: asset.hasBlob ? asset.fileName : 'The image file is missing in this browser; import the media backup to use it.',
        on: { click: () => toggle(asset) }
      },
      assetImage(scope, asset.id, { alt: '', className: 'tile-img', asset }),
      h('span', { class: 'tile-name' }, asset.fileName),
      h('span', { class: 'tile-meta' }, `${asset.width}×${asset.height} · ${formatBytes(asset.size)}`),
      asset.width < LOW_RESOLUTION_WIDTH ? h('span', { class: 'tag tag-warn' }, 'Low resolution') : null,
      pressed ? h('span', { class: 'tile-check' }, icon('check'), 'Selected') : null));
    }
  }

  const fileInput = h('input', {
    type: 'file', id: 'media-upload-input', accept: ACCEPT_ATTRIBUTE, multiple: multiple || null, class: 'visually-hidden-file',
    on: {
      change: async e => {
        const files = [...e.target.files];
        e.target.value = '';
        if (!files.length) return;
        clear(results).append(h('p', { class: 'muted' }, `Checking ${files.length} file${files.length === 1 ? '' : 's'}…`));
        const { added, results: list } = await uploadFiles(workspace, files);
        clear(results).append(uploadResultList(list));
        assets = await workspace.media.list();
        if (!multiple) selected.clear();
        for (const asset of added) selected.set(asset.id, assets.find(a => a.id === asset.id) || asset);
        renderGrid();
        updateUse();
      }
    }
  });

  const content = h('div', { class: 'picker' },
    h('div', { class: 'upload-zone' },
      icon('upload'),
      h('div', null,
        fileInput,
        h('label', { for: 'media-upload-input', class: 'btn btn-secondary' }, 'Upload from this device'),
        h('p', { class: 'field-hint' }, `JPEG, PNG or WebP up to ${formatBytes(MEDIA_LIMITS.maxBytes)}. SVG is not accepted. Files are stored only in this browser.`))),
    results,
    h('div', { class: 'picker-library' }, h('h3', null, 'Local media library'), search, grid));

  let useBtn;
  const dialog = openDialog({
    title, wide: true, content,
    actions: [
      { label: 'Cancel', value: null },
      { label: useButtonLabel(), variant: 'primary', onClick: close => { if (selected.size) close([...selected.values()]); } }
    ],
    onClose: () => scope.revokeAll()
  });
  useBtn = dialog.dialog.querySelector('.modal-actions .btn-primary');
  function updateUse() {
    useBtn.querySelector('span').textContent = useButtonLabel();
    useBtn.disabled = selected.size === 0;
  }
  renderGrid();
  updateUse();
  search.focus();
  return dialog.result;
}
