// Versioned JSON backup and import. The data backup excludes image binaries (stated in the file itself);
// a separate media backup carries the original image files as base64. Imports are validated completely
// and then applied in a single transaction, so a rejected import changes nothing.
import { ALL_STORES, STORES, request, runTransaction } from './idb.js';
import { RepoError } from './content-repository.js';
import { MEDIA_LIMITS, inspectImageFile } from './media-validation.js';
import { KINDS, TAXONOMY_NAMESPACES, makeContext, relationRefs } from '../modules/shared/records.js';
import { ROUTE_PREFIXES, SLUG_PATTERN, redirectProblems, routeFor } from '../modules/shared/routes.js';
import { errorsOnly, validateDraft } from '../modules/shared/validation.js';

export const BACKUP_FORMAT = 'vion-cms-local-backup';
export const MEDIA_BACKUP_FORMAT = 'vion-cms-local-media-backup';
export const SCHEMAS_VERSION = 1;
export const DATA_BACKUP_NOTICE = 'This data backup contains records, published snapshots, planned local redirects, taxonomy terms and image metadata. It does NOT contain image files. Export the separate media backup to keep the original images.';

const WORKFLOW_KEYS = ['priorStatus', 'lastPublishedRoute', 'routeHistory', 'publishedRevision', 'lastPublishedAt', 'publishedSourceVersion', 'archivedAt'];
const ASSET_KEYS = ['id', 'fileName', 'type', 'size', 'width', 'height', 'alt', 'credit', 'caption', 'createdAt', 'updatedAt', 'version'];
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isIso = v => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T/.test(v);
const isUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isInt = (v, min = 0) => Number.isInteger(v) && v >= min;
const isRoute = v => typeof v === 'string' && Object.values(ROUTE_PREFIXES).some(p => v.startsWith(p) && SLUG_PATTERN.test(v.slice(p.length)));

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(data, type) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function createBackupService({ db, validator, events, clock = () => new Date().toISOString() }) {
  async function readAll() {
    return runTransaction(db, ALL_STORES, 'readonly', async tx => {
      const all = name => request(tx.objectStore(name).getAll());
      const [records, published, redirects, taxonomies, assets, blobKeys] = await Promise.all([
        all(STORES.records), all(STORES.published), all(STORES.redirects), all(STORES.taxonomies), all(STORES.assets), request(tx.objectStore(STORES.assetBlobs).getAllKeys())
      ]);
      return { records, published, redirects, taxonomies, assets, blobKeys };
    });
  }

  function validateDataBackup(data) {
    const errors = [];
    const fail = (where, message) => errors.push(`${where}: ${message}`);
    if (!isObject(data)) return { ok: false, errors: ['The file is not a JSON object.'] };
    if (data.format !== BACKUP_FORMAT) fail('format', `expected "${BACKUP_FORMAT}". This does not look like a Vion CMS data backup${data.format === MEDIA_BACKUP_FORMAT ? ' (it is a media backup — use “Import media backup”)' : ''}.`);
    if (data.schemasVersion !== SCHEMAS_VERSION) fail('schemasVersion', `expected ${SCHEMAS_VERSION}, found ${JSON.stringify(data.schemasVersion)}. This backup was made by an unsupported version.`);
    for (const key of ['records', 'published', 'redirects', 'taxonomies', 'assets']) if (!Array.isArray(data[key])) fail(key, 'must be a list.');
    if (errors.length) return { ok: false, errors };

    const ids = new Set();
    data.assets.forEach((a, i) => {
      const where = `assets[${i}]`;
      if (!isObject(a)) { fail(where, 'must be an object.'); return; }
      for (const key of Object.keys(a)) if (!ASSET_KEYS.includes(key)) fail(`${where}.${key}`, 'is not an allowed field.');
      if (!isUuid(a.id)) fail(`${where}.id`, 'must be a UUID.');
      if (typeof a.fileName !== 'string' || !a.fileName) fail(`${where}.fileName`, 'must be text.');
      if (!MEDIA_LIMITS.allowedTypes.includes(a.type)) fail(`${where}.type`, `must be one of ${MEDIA_LIMITS.allowedTypes.join(', ')} (SVG and other types are rejected).`);
      if (!isInt(a.size, 1) || a.size > MEDIA_LIMITS.maxBytes) fail(`${where}.size`, 'must be a positive size within the upload limit.');
      if (!isInt(a.width) || !isInt(a.height)) fail(`${where}`, 'width and height must be whole numbers.');
      for (const key of ['alt', 'credit', 'caption']) if (typeof a[key] !== 'string') fail(`${where}.${key}`, 'must be text.');
      if (!isIso(a.createdAt) || !isIso(a.updatedAt)) fail(where, 'createdAt and updatedAt must be ISO timestamps.');
      if (!isInt(a.version, 1)) fail(`${where}.version`, 'must be a positive whole number.');
      if (ids.has(a.id)) fail(`${where}.id`, 'is duplicated.');
      ids.add(a.id);
    });

    const namespaceLabels = new Set();
    data.taxonomies.forEach((t, i) => {
      const where = `taxonomies[${i}]`;
      if (!isObject(t)) { fail(where, 'must be an object.'); return; }
      for (const key of Object.keys(t)) if (!['id', 'namespace', 'label', 'createdAt', 'updatedAt', 'version'].includes(key)) fail(`${where}.${key}`, 'is not an allowed field.');
      if (!isUuid(t.id)) fail(`${where}.id`, 'must be a UUID.');
      if (!(t.namespace in TAXONOMY_NAMESPACES)) fail(`${where}.namespace`, `must be one of ${Object.keys(TAXONOMY_NAMESPACES).join(', ')}.`);
      if (typeof t.label !== 'string' || !t.label.trim() || t.label.length > 80) fail(`${where}.label`, 'must be 1–80 characters.');
      const key = `${t.namespace}|${String(t.label).toLowerCase()}`;
      if (namespaceLabels.has(key)) fail(`${where}.label`, 'duplicates another term in the same namespace.');
      namespaceLabels.add(key);
      if (!isIso(t.createdAt) || !isIso(t.updatedAt) || !isInt(t.version, 1)) fail(where, 'needs ISO timestamps and a positive version.');
      if (ids.has(t.id)) fail(`${where}.id`, 'is duplicated.');
      ids.add(t.id);
    });

    const structurallyValid = [];
    data.records.forEach((env, i) => {
      const where = `records[${i}]`;
      const before = errors.length;
      if (!isObject(env) || !isObject(env.record) || !isObject(env.workflow)) { fail(where, 'must contain id, kind, record and workflow objects.'); return; }
      for (const key of Object.keys(env)) if (!['id', 'kind', 'record', 'workflow'].includes(key)) fail(`${where}.${key}`, 'is not an allowed field.');
      if (!KINDS.includes(env.kind)) fail(`${where}.kind`, 'must be destination, accommodation or tour.');
      if (env.record.id !== env.id || env.record.kind !== env.kind) fail(where, 'record id/kind must match the envelope.');
      for (const e of validator.validateRecord(env.record)) fail(`${where}.record.${e.path}`, e.message);
      const wf = env.workflow;
      for (const key of Object.keys(wf)) if (!WORKFLOW_KEYS.includes(key)) fail(`${where}.workflow.${key}`, 'is not an allowed field.');
      if (![null, 'draft', 'published'].includes(wf.priorStatus)) fail(`${where}.workflow.priorStatus`, 'must be null, draft or published.');
      if (wf.lastPublishedRoute !== null && !isRoute(wf.lastPublishedRoute)) fail(`${where}.workflow.lastPublishedRoute`, 'must be null or a local route.');
      if (!Array.isArray(wf.routeHistory) || wf.routeHistory.some(h => !isObject(h) || !isRoute(h.route) || !isIso(h.firstPublishedAt))) fail(`${where}.workflow.routeHistory`, 'must list {route, firstPublishedAt} entries.');
      if (!isInt(wf.publishedRevision)) fail(`${where}.workflow.publishedRevision`, 'must be a whole number.');
      for (const key of ['lastPublishedAt', 'archivedAt']) if (wf[key] !== null && !isIso(wf[key])) fail(`${where}.workflow.${key}`, 'must be null or an ISO timestamp.');
      if (wf.publishedSourceVersion !== null && !isInt(wf.publishedSourceVersion, 1)) fail(`${where}.workflow.publishedSourceVersion`, 'must be null or a positive whole number.');
      if (ids.has(env.id)) fail(`${where}.id`, 'is duplicated.');
      ids.add(env.id);
      if (errors.length === before) structurallyValid.push(env);
    });

    const recordIds = new Map(data.records.filter(isObject).map(env => [env.id, env]));
    const publishedIds = new Set();
    data.published.forEach((p, i) => {
      const where = `published[${i}]`;
      if (!isObject(p) || !isObject(p.snapshot)) { fail(where, 'must contain a snapshot object.'); return; }
      for (const key of Object.keys(p)) if (!['id', 'kind', 'revision', 'publishedAt', 'sourceVersion', 'route', 'snapshot'].includes(key)) fail(`${where}.${key}`, 'is not an allowed field.');
      const env = recordIds.get(p.id);
      if (!env) fail(`${where}.id`, 'has no matching record.');
      else if (env.record.status !== 'published') fail(where, `belongs to a record whose status is ${env.record.status}; only published records may have a published snapshot.`);
      if (p.snapshot.id !== p.id || p.snapshot.kind !== p.kind || p.snapshot.status !== 'published') fail(`${where}.snapshot`, 'must match the record id/kind and have status published.');
      for (const e of validator.validateRecord(p.snapshot)) fail(`${where}.snapshot.${e.path}`, e.message);
      if (p.route !== routeFor(p.kind, p.snapshot.slug)) fail(`${where}.route`, 'does not match the snapshot slug.');
      if (!isInt(p.revision, 1) || !isInt(p.sourceVersion, 1) || !isIso(p.publishedAt)) fail(where, 'needs a revision, sourceVersion and publishedAt.');
      if (publishedIds.has(p.id)) fail(`${where}.id`, 'is duplicated.');
      publishedIds.add(p.id);
    });
    for (const env of recordIds.values()) {
      if (env.record?.status === 'published' && !publishedIds.has(env.id)) fail(`record ${env.id}`, 'is marked published but has no published snapshot.');
    }
    data.published.filter(isObject).forEach((p, i) => {
      for (const ref of relationRefs(p.snapshot || {})) if (!publishedIds.has(ref.id)) fail(`published[${i}].snapshot.${ref.path}`, `references ${ref.kind} ${ref.id}, which has no published snapshot in this backup.`);
    });

    data.redirects.forEach((r, i) => {
      const where = `redirects[${i}]`;
      if (!isObject(r)) { fail(where, 'must be an object.'); return; }
      for (const key of Object.keys(r)) if (!['id', 'from', 'to', 'statusCode', 'recordId', 'kind', 'createdAt', 'updatedAt'].includes(key)) fail(`${where}.${key}`, 'is not an allowed field.');
      if (!isUuid(r.id) || !isRoute(r.from) || !isRoute(r.to) || r.statusCode !== 308) fail(where, 'must have an id, local from/to routes and statusCode 308.');
      if (!recordIds.has(r.recordId)) fail(`${where}.recordId`, 'has no matching record.');
    });
    for (const problem of redirectProblems(data.redirects.filter(isObject))) fail('redirects', problem);

    // Semantic draft checks (unsafe links, phone numbers, references, unique routes) on every structurally
    // valid record, so all problems are reported together even when other parts of the file are invalid.
    try {
      const objects = list => list.filter(item => isObject(item) && typeof item.id === 'string');
      const assets = objects(data.assets);
      const ctx = makeContext({
        records: structurallyValid, published: objects(data.published).filter(p => isObject(p.snapshot)), redirects: objects(data.redirects),
        assets, blobKeys: assets.map(a => a.id), taxonomies: objects(data.taxonomies), validator
      });
      for (const env of structurallyValid) {
        for (const issue of errorsOnly(validateDraft(env.record, ctx))) fail(`${env.kind} “${env.record.title}” ${issue.path}`, issue.message);
      }
    } catch (err) {
      fail('records', `could not be checked (${err.message}).`);
    }
    const summary = { records: data.records.length, published: data.published.length, redirects: data.redirects.length, taxonomies: data.taxonomies.length, assets: data.assets.length };
    return { ok: errors.length === 0, errors, summary };
  }

  return {
    async exportData() {
      const all = await readAll();
      return {
        format: BACKUP_FORMAT, schemasVersion: SCHEMAS_VERSION, exportedAt: clock(), binaryAssetsIncluded: false, notice: DATA_BACKUP_NOTICE,
        records: all.records, published: all.published, redirects: all.redirects, taxonomies: all.taxonomies,
        assets: all.assets
      };
    },

    async exportMedia() {
      const items = await runTransaction(db, [STORES.assets, STORES.assetBlobs], 'readonly', async tx => {
        const [assets, blobs] = await Promise.all([request(tx.objectStore(STORES.assets).getAll()), request(tx.objectStore(STORES.assetBlobs).getAll())]);
        const byId = new Map(blobs.map(b => [b.id, b.blob]));
        return assets.map(asset => ({ asset, blob: byId.get(asset.id) || null }));
      });
      const assets = [];
      const missing = [];
      for (const { asset, blob } of items) {
        if (!blob) { missing.push(asset.fileName); continue; }
        assets.push({ ...asset, dataBase64: await blobToBase64(blob) });
      }
      return { format: MEDIA_BACKUP_FORMAT, schemasVersion: SCHEMAS_VERSION, exportedAt: clock(), binaryAssetsIncluded: true, assets, missingBinaries: missing };
    },

    validateDataBackup,

    // Replaces all local records, snapshots, redirects, taxonomy terms and image metadata.
    async importData(data) {
      const result = validateDataBackup(data);
      if (!result.ok) throw new RepoError('validation', 'The backup was rejected. Nothing was changed.', { errors: result.errors });
      await runTransaction(db, ALL_STORES, 'readwrite', async tx => {
        const keep = new Set(data.assets.map(a => a.id));
        const blobStore = tx.objectStore(STORES.assetBlobs);
        for (const key of await request(blobStore.getAllKeys())) if (!keep.has(key)) await request(blobStore.delete(key));
        for (const name of [STORES.records, STORES.published, STORES.redirects, STORES.taxonomies, STORES.assets]) await request(tx.objectStore(name).clear());
        for (const env of data.records) await request(tx.objectStore(STORES.records).put(env));
        for (const p of data.published) await request(tx.objectStore(STORES.published).put(p));
        for (const r of data.redirects) await request(tx.objectStore(STORES.redirects).put(r));
        for (const t of data.taxonomies) await request(tx.objectStore(STORES.taxonomies).put(t));
        for (const a of data.assets) await request(tx.objectStore(STORES.assets).put(a));
        await request(tx.objectStore(STORES.meta).put({ key: 'lastImport', at: clock(), summary: result.summary }));
      });
      events?.emit({ type: 'imported', kind: 'all' });
      return result.summary;
    },

    // Decodes and inspects every image before writing anything.
    async validateMediaBackup(data) {
      const errors = [];
      if (!isObject(data) || data.format !== MEDIA_BACKUP_FORMAT) return { ok: false, errors: [`format: expected "${MEDIA_BACKUP_FORMAT}". This is not a Vion CMS media backup.`], items: [] };
      if (data.schemasVersion !== SCHEMAS_VERSION) return { ok: false, errors: [`schemasVersion: expected ${SCHEMAS_VERSION}.`], items: [] };
      if (!Array.isArray(data.assets)) return { ok: false, errors: ['assets: must be a list.'], items: [] };
      const existing = new Map((await readAll()).assets.map(a => [a.id, a]));
      const items = [];
      for (const [i, item] of data.assets.entries()) {
        const where = `assets[${i}]`;
        if (!isObject(item) || !isUuid(item.id) || typeof item.dataBase64 !== 'string') { errors.push(`${where}: needs an id and dataBase64.`); continue; }
        let blob;
        try { blob = base64ToBlob(item.dataBase64, item.type); } catch { errors.push(`${where}: image data is not valid base64.`); continue; }
        const inspected = await inspectImageFile(new File([blob], item.fileName || 'image', { type: item.type || '' }));
        if (!inspected.ok) { errors.push(`${where} (${item.fileName}): ${inspected.errors.join(' ')}`); continue; }
        const current = existing.get(item.id);
        if (current && (current.type !== inspected.info.type || current.size !== inspected.info.size)) { errors.push(`${where} (${item.fileName}): does not match the stored image metadata.`); continue; }
        const { dataBase64, ...meta } = item;
        const asset = current || {
          id: item.id, fileName: String(item.fileName || 'image'), type: inspected.info.type, size: inspected.info.size, width: inspected.info.width, height: inspected.info.height,
          alt: String(meta.alt || ''), credit: String(meta.credit || ''), caption: String(meta.caption || ''), createdAt: isIso(meta.createdAt) ? meta.createdAt : clock(), updatedAt: clock(), version: 1
        };
        items.push({ asset, blob: inspected.blob, isNew: !current });
      }
      return { ok: errors.length === 0, errors, items };
    },

    async importMedia(data) {
      const result = await this.validateMediaBackup(data);
      if (!result.ok) throw new RepoError('validation', 'The media backup was rejected. Nothing was changed.', { errors: result.errors });
      await runTransaction(db, [STORES.assets, STORES.assetBlobs], 'readwrite', async tx => {
        for (const { asset, blob, isNew } of result.items) {
          if (isNew) await request(tx.objectStore(STORES.assets).put(asset));
          await request(tx.objectStore(STORES.assetBlobs).put({ id: asset.id, blob }));
        }
      });
      events?.emit({ type: 'media-imported', kind: 'asset' });
      return { restored: result.items.length, added: result.items.filter(i => i.isNew).length };
    }
  };
}
