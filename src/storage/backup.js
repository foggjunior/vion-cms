// Versioned JSON backup and import. The data backup excludes image binaries (stated in the file itself);
// a separate media backup carries the original image files as base64. Imports are validated completely
// and then applied in a single transaction, so a rejected import changes nothing.
//
// schemasVersion 2 (written now) adds siteRecords/sitePublished: the site settings singleton, team profiles
// and the team lineup (display order + visibility), each with its published snapshot. Importing a v2 backup
// replaces everything, including those collections (an empty list clears them).
// schemasVersion 1 backups (made before Site Settings and Team existed) are still accepted. They replace the
// collections they contain; the current site settings, team profiles and lineup are KEPT unchanged, together
// with the image details and files those records use, so nothing they reference is orphaned.
import { ALL_STORES, STORES, request, runTransaction } from './idb.js';
import { RepoError } from './content-repository.js';
import { MEDIA_LIMITS, inspectImageFile } from './media-validation.js';
import { KINDS, TAXONOMY_NAMESPACES, makeContext, relationRefs } from '../modules/shared/records.js';
import { ROUTE_PREFIXES, SLUG_PATTERN, redirectProblems, routeFor } from '../modules/shared/routes.js';
import { errorsOnly, validateDraft } from '../modules/shared/validation.js';
import { LINEUP_ID, SETTINGS_ID, SITE_KINDS, siteAssetRefs } from '../modules/shared/site.js';
import { validateMemberDraft, validateSettingsDraft } from '../modules/shared/site-validation.js';

export const BACKUP_FORMAT = 'vion-cms-local-backup';
export const MEDIA_BACKUP_FORMAT = 'vion-cms-local-media-backup';
export const SCHEMAS_VERSION = 2;
export const LEGACY_SCHEMAS_VERSION = 1;
export const MEDIA_SCHEMAS_VERSION = 1;
export const DATA_BACKUP_NOTICE = 'This data backup contains records, published snapshots, planned local redirects, taxonomy terms, site settings, team profiles, team order and visibility, and image metadata. It does NOT contain image files. Export the separate media backup to keep the original images.';
export const LEGACY_IMPORT_NOTICE = 'This backup was made before Site Settings and Team existed (schemasVersion 1). It replaces destinations, accommodations, tours, their published snapshots, planned redirects, taxonomy terms and image details. Your current site settings, team profiles and team order are kept unchanged, together with the image details and files they use.';

const WORKFLOW_KEYS = ['priorStatus', 'lastPublishedRoute', 'routeHistory', 'publishedRevision', 'lastPublishedAt', 'publishedSourceVersion', 'archivedAt'];
const SITE_WORKFLOW_KEYS = ['priorStatus', 'publishedRevision', 'lastPublishedAt', 'publishedSourceVersion', 'archivedAt', 'priorVisible'];
const SITE_STORES = [STORES.siteRecords, STORES.sitePublished];
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

export function createBackupService({ db, validator, siteValidator, events, clock = () => new Date().toISOString() }) {
  async function readAll() {
    return runTransaction(db, ALL_STORES, 'readonly', async tx => {
      const all = name => request(tx.objectStore(name).getAll());
      const [records, published, redirects, taxonomies, assets, blobKeys, siteRecords, sitePublished] = await Promise.all([
        all(STORES.records), all(STORES.published), all(STORES.redirects), all(STORES.taxonomies), all(STORES.assets), request(tx.objectStore(STORES.assetBlobs).getAllKeys()),
        all(STORES.siteRecords), all(STORES.sitePublished)
      ]);
      return { records, published, redirects, taxonomies, assets, blobKeys, siteRecords, sitePublished };
    });
  }

  function validateDataBackup(data) {
    const errors = [];
    const fail = (where, message) => errors.push(`${where}: ${message}`);
    if (!isObject(data)) return { ok: false, errors: ['The file is not a JSON object.'] };
    if (data.format !== BACKUP_FORMAT) fail('format', `expected "${BACKUP_FORMAT}". This does not look like a Vion CMS data backup${data.format === MEDIA_BACKUP_FORMAT ? ' (it is a media backup — use “Import media backup”)' : ''}.`);
    const legacy = data.schemasVersion === LEGACY_SCHEMAS_VERSION;
    if (!legacy && data.schemasVersion !== SCHEMAS_VERSION) fail('schemasVersion', `expected ${SCHEMAS_VERSION} (or ${LEGACY_SCHEMAS_VERSION} for backups made before Site Settings and Team), found ${JSON.stringify(data.schemasVersion)}. This backup was made by an unsupported version.`);
    for (const key of ['records', 'published', 'redirects', 'taxonomies', 'assets']) if (!Array.isArray(data[key])) fail(key, 'must be a list.');
    if (legacy) { for (const key of ['siteRecords', 'sitePublished']) if (key in data) fail(key, 'is not part of a schemasVersion 1 backup.'); }
    else for (const key of ['siteRecords', 'sitePublished']) if (!Array.isArray(data[key])) fail(key, 'must be a list.');
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

    const siteValid = legacy ? [] : validateSiteCollections(data, ids, errors, fail);

    // Semantic draft checks (unsafe links, phone numbers, references, unique routes) on every structurally
    // valid record, so all problems are reported together even when other parts of the file are invalid.
    try {
      const objects = list => list.filter(item => isObject(item) && typeof item.id === 'string');
      const assets = objects(data.assets);
      const ctx = makeContext({
        records: structurallyValid, published: objects(data.published).filter(p => isObject(p.snapshot)), redirects: objects(data.redirects),
        assets, blobKeys: assets.map(a => a.id), taxonomies: objects(data.taxonomies), siteRecords: siteValid, validator, siteValidator
      });
      for (const env of structurallyValid) {
        for (const issue of errorsOnly(validateDraft(env.record, ctx))) fail(`${env.kind} “${env.record.title}” ${issue.path}`, issue.message);
      }
      for (const env of siteValid) {
        const check = env.kind === 'siteSettings' ? validateSettingsDraft : env.kind === 'teamMember' ? validateMemberDraft : null;
        for (const issue of errorsOnly(check ? check(env.record, ctx) : [])) fail(`${env.kind === 'teamMember' ? `team profile “${env.record.name}”` : 'site settings'} ${issue.path}`, issue.message);
      }
    } catch (err) {
      fail('records', `could not be checked (${err.message}).`);
    }
    const summary = {
      schemasVersion: data.schemasVersion, records: data.records.length, published: data.published.length, redirects: data.redirects.length, taxonomies: data.taxonomies.length, assets: data.assets.length,
      siteRecords: legacy ? null : data.siteRecords.length, sitePublished: legacy ? null : data.sitePublished.length,
      teamProfiles: legacy ? null : data.siteRecords.filter(e => e?.kind === 'teamMember').length, settings: legacy ? null : data.siteRecords.some(e => e?.kind === 'siteSettings')
    };
    return { ok: errors.length === 0, errors, summary, legacy };
  }

  // Structural and cross-record checks for siteRecords/sitePublished. Returns the structurally valid envelopes.
  function validateSiteCollections(data, ids, errors, fail) {
    const valid = [];
    const byId = new Map();
    let settingsCount = 0;
    data.siteRecords.forEach((env, i) => {
      const where = `siteRecords[${i}]`;
      const before = errors.length;
      if (!isObject(env) || !isObject(env.record) || !isObject(env.workflow)) { fail(where, 'must contain id, kind, record and workflow objects.'); return; }
      for (const key of Object.keys(env)) if (!['id', 'kind', 'record', 'workflow'].includes(key)) fail(`${where}.${key}`, 'is not an allowed field.');
      if (!SITE_KINDS.includes(env.kind)) fail(`${where}.kind`, `must be one of ${SITE_KINDS.join(', ')}.`);
      if (env.record.id !== env.id || env.record.kind !== env.kind) fail(where, 'record id/kind must match the envelope.');
      for (const e of siteValidator.validateRecord(env.record)) fail(`${where}.record.${e.path}`, e.message);
      const wf = env.workflow;
      for (const key of Object.keys(wf)) if (!SITE_WORKFLOW_KEYS.includes(key)) fail(`${where}.workflow.${key}`, 'is not an allowed field.');
      if (![null, 'draft', 'published'].includes(wf.priorStatus)) fail(`${where}.workflow.priorStatus`, 'must be null, draft or published.');
      if (!isInt(wf.publishedRevision)) fail(`${where}.workflow.publishedRevision`, 'must be a whole number.');
      for (const key of ['lastPublishedAt', 'archivedAt']) if (wf[key] !== null && !isIso(wf[key])) fail(`${where}.workflow.${key}`, 'must be null or an ISO timestamp.');
      if (wf.publishedSourceVersion !== null && !isInt(wf.publishedSourceVersion, 1)) fail(`${where}.workflow.publishedSourceVersion`, 'must be null or a positive whole number.');
      if (wf.priorVisible !== null && typeof wf.priorVisible !== 'boolean') fail(`${where}.workflow.priorVisible`, 'must be null or true/false.');
      if (env.kind === 'siteSettings' && ++settingsCount > 1) fail(where, 'is a second site settings record; a backup may contain only one (the settings are a singleton).');
      if (ids.has(env.id)) fail(`${where}.id`, 'is duplicated.');
      ids.add(env.id);
      byId.set(env.id, env);
      if (errors.length === before) valid.push(env);
    });

    const publishedIds = new Set();
    data.sitePublished.forEach((p, i) => {
      const where = `sitePublished[${i}]`;
      if (!isObject(p) || !isObject(p.snapshot)) { fail(where, 'must contain a snapshot object.'); return; }
      for (const key of Object.keys(p)) if (!['id', 'kind', 'revision', 'publishedAt', 'sourceVersion', 'snapshot'].includes(key)) fail(`${where}.${key}`, 'is not an allowed field.');
      const env = byId.get(p.id);
      if (!env) fail(`${where}.id`, 'has no matching site record.');
      else if (env.record?.status !== 'published') fail(where, `belongs to a record whose status is ${env.record?.status}; only published records may have a published snapshot.`);
      if (p.snapshot.id !== p.id || p.snapshot.kind !== p.kind || p.snapshot.status !== 'published') fail(`${where}.snapshot`, 'must match the record id/kind and have status published.');
      for (const e of siteValidator.validateRecord(p.snapshot)) fail(`${where}.snapshot.${e.path}`, e.message);
      if (!isInt(p.revision, 1) || !isInt(p.sourceVersion, 1) || !isIso(p.publishedAt)) fail(where, 'needs a revision, sourceVersion and publishedAt.');
      if (publishedIds.has(p.id)) fail(`${where}.id`, 'is duplicated.');
      publishedIds.add(p.id);
    });
    for (const env of byId.values()) {
      if (env.record?.status === 'published' && !publishedIds.has(env.id)) fail(`site record ${env.id}`, 'is marked published but has no published snapshot.');
    }

    // Lineup integrity: every active profile appears exactly once in the draft lineup; lineups only list profiles.
    const active = valid.filter(env => env.kind === 'teamMember' && env.record.status !== 'archived');
    const lineup = valid.find(env => env.id === LINEUP_ID);
    if (active.length && !lineup) fail('siteRecords', 'team profiles are present but the team order (lineup) record is missing.');
    const checkEntries = (entries, where, draft) => {
      const seen = new Set();
      entries.forEach((entry, i) => {
        const member = byId.get(entry.memberId);
        if (!member || member.kind !== 'teamMember') fail(`${where}[${i}]`, 'references a team profile that is not in this backup.');
        else if (draft && member.record?.status === 'archived') fail(`${where}[${i}]`, 'lists an archived profile; archived profiles are not in the draft team order.');
        if (seen.has(entry.memberId)) fail(`${where}[${i}]`, 'lists the same profile twice.');
        seen.add(entry.memberId);
      });
      if (draft) for (const env of active) if (!seen.has(env.id)) fail(where, `does not include the active profile “${env.record.name}”.`);
    };
    if (lineup) checkEntries(lineup.record.entries, 'team lineup entries', true);
    const publishedLineup = data.sitePublished.find(p => isObject(p) && p.id === LINEUP_ID && isObject(p.snapshot) && Array.isArray(p.snapshot.entries));
    if (publishedLineup) checkEntries(publishedLineup.snapshot.entries, 'published team lineup entries', false);
    if (valid.some(env => env.kind === 'siteSettings' && env.id !== SETTINGS_ID)) fail('siteRecords', 'site settings must use the fixed settings ID.');
    return valid;
  }

  return {
    async exportData() {
      const all = await readAll();
      return {
        format: BACKUP_FORMAT, schemasVersion: SCHEMAS_VERSION, exportedAt: clock(), binaryAssetsIncluded: false, notice: DATA_BACKUP_NOTICE,
        records: all.records, published: all.published, redirects: all.redirects, taxonomies: all.taxonomies,
        assets: all.assets, siteRecords: all.siteRecords, sitePublished: all.sitePublished
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
      return { format: MEDIA_BACKUP_FORMAT, schemasVersion: MEDIA_SCHEMAS_VERSION, exportedAt: clock(), binaryAssetsIncluded: true, assets, missingBinaries: missing };
    },

    validateDataBackup,

    // Replace-all import. A v2 backup replaces every collection, including site settings, team profiles and
    // the lineup. A v1 backup replaces the collections it contains and keeps the current site records plus the
    // image details/files they reference (see the header comment). Image files are kept only for images that
    // remain listed; the separate media backup restores files.
    async importData(data) {
      const result = validateDataBackup(data);
      if (!result.ok) throw new RepoError('validation', 'The backup was rejected. Nothing was changed.', { errors: result.errors });
      const summary = await runTransaction(db, ALL_STORES, 'readwrite', async tx => {
        const store = name => tx.objectStore(name);
        let keptAssets = [];
        let keptSite = 0;
        if (result.legacy) {
          const [siteRecords, sitePublished, assets] = await Promise.all([request(store(STORES.siteRecords).getAll()), request(store(STORES.sitePublished).getAll()), request(store(STORES.assets).getAll())]);
          const used = new Set([...siteRecords.map(env => env.record), ...sitePublished.map(p => p.snapshot)].flatMap(siteAssetRefs).map(ref => ref.assetId));
          const incoming = new Set(data.assets.map(a => a.id));
          keptAssets = assets.filter(a => used.has(a.id) && !incoming.has(a.id));
          keptSite = siteRecords.length;
        }
        const keep = new Set([...data.assets, ...keptAssets].map(a => a.id));
        const blobStore = store(STORES.assetBlobs);
        for (const key of await request(blobStore.getAllKeys())) if (!keep.has(key)) await request(blobStore.delete(key));
        const replaced = [STORES.records, STORES.published, STORES.redirects, STORES.taxonomies, STORES.assets, ...(result.legacy ? [] : SITE_STORES)];
        for (const name of replaced) await request(store(name).clear());
        for (const env of data.records) await request(store(STORES.records).put(env));
        for (const p of data.published) await request(store(STORES.published).put(p));
        for (const r of data.redirects) await request(store(STORES.redirects).put(r));
        for (const t of data.taxonomies) await request(store(STORES.taxonomies).put(t));
        for (const a of [...data.assets, ...keptAssets]) await request(store(STORES.assets).put(a));
        if (!result.legacy) {
          for (const env of data.siteRecords) await request(store(STORES.siteRecords).put(env));
          for (const p of data.sitePublished) await request(store(STORES.sitePublished).put(p));
        }
        const applied = { ...result.summary, keptSiteRecords: keptSite, keptAssets: keptAssets.length };
        await request(store(STORES.meta).put({ key: 'lastImport', at: clock(), summary: applied }));
        return applied;
      });
      events?.emit({ type: 'imported', kind: 'all' });
      return summary;
    },

    // Decodes and inspects every image before writing anything.
    async validateMediaBackup(data) {
      const errors = [];
      if (!isObject(data) || data.format !== MEDIA_BACKUP_FORMAT) return { ok: false, errors: [`format: expected "${MEDIA_BACKUP_FORMAT}". This is not a Vion CMS media backup.`], items: [] };
      if (data.schemasVersion !== MEDIA_SCHEMAS_VERSION) return { ok: false, errors: [`schemasVersion: expected ${MEDIA_SCHEMAS_VERSION}.`], items: [] };
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
