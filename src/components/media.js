// Media display and placement fields. Object URLs are owned by a scope and revoked when the view closes.
// Missing assets render as visible errors; nothing is silently substituted.
import { button, clear, h, icon } from './dom.js';
import { fieldIdFor } from './fields.js';
import { createRepeater } from './repeater.js';
import { formatBytes } from '../modules/shared/format.js';
import { LOW_RESOLUTION_WIDTH } from '../modules/shared/validation.js';

export class MediaUrlScope {
  constructor(media) { this.media = media; this.urls = new Map(); }
  async url(assetId) {
    if (!this.urls.has(assetId)) {
      const blob = await this.media.getBlob(assetId);
      this.urls.set(assetId, blob ? URL.createObjectURL(blob) : null);
    }
    return this.urls.get(assetId);
  }
  revokeAll() {
    for (const url of this.urls.values()) if (url) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}

export function assetImage(scope, assetId, { alt = '', className = '', asset } = {}) {
  const box = h('div', { class: ['img-box', className] }, h('span', { class: 'img-loading' }, 'Loading image…'));
  const showMissing = text => { clear(box); box.classList.add('img-missing'); box.append(icon('alert'), h('span', null, text)); };
  scope.url(assetId).then(url => {
    if (!url) { showMissing(asset ? 'Image file missing in this browser' : 'Missing image asset'); return; }
    clear(box);
    box.append(h('img', { src: url, alt, loading: 'lazy', decoding: 'async' }));
  }).catch(() => showMissing('Image could not be loaded'));
  return box;
}

export function assetSummary(asset) {
  if (!asset) return h('p', { class: 'asset-meta is-error' }, 'This image is not in the local media library. Choose another image.');
  return h('p', { class: 'asset-meta' },
    h('strong', null, asset.fileName), ` · ${asset.width} × ${asset.height}px · ${formatBytes(asset.size)}`,
    asset.width < LOW_RESOLUTION_WIDTH ? h('span', { class: 'tag tag-warn' }, 'Low resolution') : null,
    asset.hasBlob === false ? h('span', { class: 'tag tag-error' }, 'File missing') : null);
}

const errorSlot = path => h('p', { class: 'field-error', id: `${fieldIdFor(path)}-error`, hidden: true });

function placementInputs(path, placement, { onChange, readOnly, allowDecorative }) {
  const altId = fieldIdFor(`${path}.alt`);
  const capId = fieldIdFor(`${path}.caption`);
  const decoId = fieldIdFor(`${path}.decorative`);
  return h('div', { class: 'placement-fields' },
    h('div', { class: 'field' },
      h('label', { for: altId, class: 'field-label' }, 'Alt text', h('span', { class: 'req' }, allowDecorative ? ' · required unless decorative' : ' · required to publish')),
      h('input', { id: altId, class: 'input', type: 'text', value: placement.alt || '', readOnly, 'aria-describedby': `${altId}-error`, placeholder: 'Describe what this image shows here', on: { input: e => { placement.alt = e.target.value; onChange(); } } }),
      errorSlot(`${path}.alt`)),
    allowDecorative ? h('label', { class: 'check' },
      h('input', { id: decoId, type: 'checkbox', checked: !!placement.decorative, disabled: readOnly, on: { change: e => { placement.decorative = e.target.checked; onChange(); } } }),
      h('span', null, 'Decorative (no alt text needed)')) : null,
    h('div', { class: 'field' },
      h('label', { for: capId, class: 'field-label' }, 'Caption (optional)'),
      h('input', { id: capId, class: 'input', type: 'text', value: placement.caption || '', readOnly, on: { input: e => { placement.caption = e.target.value; onChange(); } } })));
}

// Single cover placement. `pick()` resolves to an array of asset metadata or null.
export function coverField({ path = 'cover', label = 'Cover image', hint, model, ctx, scope, pick, onChange, readOnly = false }) {
  const container = h('div', { class: 'field field-wide media-field' });
  const id = fieldIdFor(path);
  async function choose() {
    const picked = await pick({ multiple: false, title: 'Choose cover image' });
    if (!picked?.length) return;
    const asset = picked[0];
    model[path] = { assetId: asset.id, alt: model[path]?.assetId === asset.id ? model[path].alt : asset.alt || '' };
    onChange();
    render();
    container.querySelector(`#${fieldIdFor(`${path}.alt`)}`)?.focus();
  }
  function render() {
    clear(container);
    const placement = model[path];
    container.append(h('span', { class: 'field-label' }, label, h('span', { class: 'req' }, ' · required to publish')));
    if (hint) container.append(h('p', { class: 'field-hint' }, hint));
    if (!placement) {
      container.append(h('div', { class: 'media-empty' }, icon('image'), h('p', null, 'No cover image selected.'),
        readOnly ? null : button('Choose or upload cover', { variant: 'secondary', iconName: 'upload', id, onClick: choose, 'aria-describedby': `${id}-error` })));
    } else {
      const asset = ctx.assets.get(placement.assetId);
      container.append(h('div', { class: 'media-card' },
        assetImage(scope, placement.assetId, { alt: placement.alt, className: 'media-preview', asset }),
        h('div', { class: 'media-card-body' },
          assetSummary(asset),
          placementInputs(path, placement, { onChange, readOnly, allowDecorative: false }),
          readOnly ? null : h('div', { class: 'btn-row' },
            button('Replace image', { iconName: 'image', id, onClick: choose, 'aria-describedby': `${id}-error` }),
            button('Remove cover', { variant: 'ghost', iconName: 'trash', onClick: () => { model[path] = null; onChange(); render(); container.querySelector('button')?.focus(); } })))));
    }
    container.append(errorSlot(path));
  }
  render();
  return { el: container, render };
}

// Ordered gallery, separate from the cover. Items can be reordered, captioned or marked decorative.
export function galleryField({ path = 'gallery', items, ctx, scope, pick, onChange, readOnly = false }) {
  const id = fieldIdFor(path);
  const repeater = createRepeater({
    items, readOnly, className: 'gallery-list',
    keyOf: (item, i) => `${item.assetId}-${i}`,
    itemLabel: (item, i) => `Gallery image ${i + 1}`,
    emptyText: 'No gallery images. The cover is managed separately above.',
    onChange: () => onChange(),
    renderItem: (item, i) => {
      const asset = ctx.assets.get(item.assetId);
      return h('div', { class: 'media-card media-card-compact' },
        assetImage(scope, item.assetId, { alt: item.alt, className: 'media-thumb', asset }),
        h('div', { class: 'media-card-body' }, assetSummary(asset), errorSlot(`${path}.${i}`),
          placementInputs(`${path}.${i}`, item, { onChange, readOnly, allowDecorative: true })));
    }
  });
  async function addImages() {
    const picked = await pick({ multiple: true, title: 'Add gallery images' });
    if (!picked?.length) return;
    let skipped = 0;
    for (const asset of picked) {
      if (items.some(p => p.assetId === asset.id)) { skipped += 1; continue; }
      items.push({ assetId: asset.id, alt: asset.alt || '', decorative: false });
    }
    onChange();
    repeater.render();
    note.textContent = skipped ? `${skipped} image${skipped === 1 ? ' was' : 's were'} already in the gallery and not added again.` : '';
  }
  const note = h('p', { class: 'field-hint', 'aria-live': 'polite' });
  return h('div', { class: 'field field-wide media-field' },
    h('span', { class: 'field-label' }, 'Gallery images (ordered)'),
    h('p', { class: 'field-hint' }, 'Three or more images (including the cover) are recommended. Images at least 1200px wide are recommended; smaller images only produce a warning.'),
    repeater.el,
    readOnly ? null : button('Add images', { iconName: 'plus', id, onClick: addImages, 'aria-describedby': `${id}-error` }),
    note,
    errorSlot(path));
}

// Optional share image for SEO; falls back to the cover when empty.
export function shareImageField({ model, ctx, scope, pick, onChange, readOnly = false }) {
  const path = 'seo.shareAssetId';
  const id = fieldIdFor(path);
  const container = h('div', { class: 'field field-wide media-field' });
  function render() {
    clear(container);
    const assetId = model.seo.shareAssetId;
    container.append(h('span', { class: 'field-label' }, 'Share image (optional)'),
      h('p', { class: 'field-hint' }, 'Used for social previews. When empty, the cover image is used.'));
    if (assetId) {
      const asset = ctx.assets.get(assetId);
      container.append(h('div', { class: 'media-card media-card-compact' }, assetImage(scope, assetId, { alt: '', className: 'media-thumb', asset }), h('div', { class: 'media-card-body' }, assetSummary(asset))));
    } else {
      container.append(h('p', { class: 'muted' }, model.cover ? 'Using the cover image (default).' : 'No share image; add a cover image to provide the default.'));
    }
    if (!readOnly) {
      container.append(h('div', { class: 'btn-row' },
        button(assetId ? 'Change share image' : 'Choose share image', { iconName: 'image', id, onClick: async () => {
          const picked = await pick({ multiple: false, title: 'Choose share image' });
          if (picked?.length) { model.seo.shareAssetId = picked[0].id; onChange(); render(); }
        } }),
        assetId ? button('Use cover instead', { variant: 'ghost', onClick: () => { model.seo.shareAssetId = null; onChange(); render(); } }) : null));
    }
    container.append(errorSlot(path));
  }
  render();
  return { el: container, render };
}
