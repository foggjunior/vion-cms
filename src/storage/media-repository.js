// Local asset library: metadata and original Blobs are stored separately so listing never loads binaries.
import { STORES, request, runTransaction } from './idb.js';
import { RepoError, readContext } from './content-repository.js';
import { MEDIA_LIMITS } from './media-validation.js';
import { assetUsage } from '../modules/shared/records.js';

export function createMediaRepository({ db, validator, events, clock = () => new Date().toISOString(), newId = () => crypto.randomUUID(), faults = null }) {
  const emit = (type, id) => events?.emit({ type, id, kind: 'asset' });

  return {
    // `inspected` must come from inspectImageFile(); its checks are re-asserted here.
    async add(inspected, { alt = '', credit = '', caption = '' } = {}) {
      if (!inspected?.ok || !inspected.blob) throw new RepoError('validation', 'Only inspected, valid images can be stored.');
      const { info, blob } = inspected;
      if (!MEDIA_LIMITS.allowedTypes.includes(info.type) || blob.size > MEDIA_LIMITS.maxBytes) throw new RepoError('validation', 'Unsupported image type or size.');
      const now = clock();
      const asset = {
        id: newId(), fileName: info.fileName, type: info.type, size: info.size, width: info.width, height: info.height,
        alt: alt.trim(), credit: credit.trim(), caption: caption.trim(), createdAt: now, updatedAt: now, version: 1
      };
      await runTransaction(db, [STORES.assets, STORES.assetBlobs], 'readwrite', async tx => {
        await request(tx.objectStore(STORES.assets).put(asset));
        await request(tx.objectStore(STORES.assetBlobs).put({ id: asset.id, blob }));
        faults?.check('addAsset');
      });
      emit('asset-added', asset.id);
      return { ...asset, hasBlob: true };
    },

    async list() {
      return runTransaction(db, [STORES.assets, STORES.assetBlobs], 'readonly', async tx => {
        const [assets, keys] = await Promise.all([request(tx.objectStore(STORES.assets).getAll()), request(tx.objectStore(STORES.assetBlobs).getAllKeys())]);
        const present = new Set(keys);
        return assets.map(a => ({ ...a, hasBlob: present.has(a.id) })).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
      });
    },

    async get(id) {
      return runTransaction(db, [STORES.assets], 'readonly', async tx => (await request(tx.objectStore(STORES.assets).get(id))) || null);
    },

    async getBlob(id) {
      return runTransaction(db, [STORES.assetBlobs], 'readonly', async tx => (await request(tx.objectStore(STORES.assetBlobs).get(id)))?.blob || null);
    },

    async updateMeta(id, patch, { expectedVersion } = {}) {
      const asset = await runTransaction(db, [STORES.assets], 'readwrite', async tx => {
        const current = await request(tx.objectStore(STORES.assets).get(id));
        if (!current) throw new RepoError('not-found', 'This image no longer exists in the local library.');
        if (expectedVersion != null && current.version !== expectedVersion) throw new RepoError('stale', 'This image’s details were changed elsewhere. Reload and try again.');
        const next = { ...current, version: current.version + 1, updatedAt: clock() };
        for (const key of ['alt', 'credit', 'caption']) if (key in patch) next[key] = String(patch[key] || '').trim();
        await request(tx.objectStore(STORES.assets).put(next));
        faults?.check('updateAsset');
        return next;
      });
      emit('asset-updated', id);
      return asset;
    },

    async usage(id) {
      const ctx = await runTransaction(db, [STORES.records, STORES.published, STORES.redirects, STORES.assets, STORES.assetBlobs, STORES.taxonomies], 'readonly', tx => readContext(tx, validator));
      return assetUsage(id, ctx);
    },

    // Deletion is allowed only when no working draft or published snapshot references the asset.
    async remove(id) {
      await runTransaction(db, [STORES.records, STORES.published, STORES.redirects, STORES.assets, STORES.assetBlobs, STORES.taxonomies], 'readwrite', async tx => {
        const ctx = await readContext(tx, validator);
        if (!ctx.assets.has(id)) throw new RepoError('not-found', 'This image no longer exists in the local library.');
        const usage = assetUsage(id, ctx);
        if (usage.length) {
          throw new RepoError('dependency', `This image is used by ${usage.map(u => `“${u.title}” (${u.where}, ${u.role})`).join(', ')}. Remove it from those records first.`, { usage });
        }
        await request(tx.objectStore(STORES.assets).delete(id));
        await request(tx.objectStore(STORES.assetBlobs).delete(id));
        faults?.check('removeAsset');
      });
      emit('asset-removed', id);
    }
  };
}
