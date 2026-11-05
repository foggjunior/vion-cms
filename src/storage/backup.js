// Versioned JSON backup and import. The data backup excludes image binaries (stated in the file itself);
// a separate media backup carries the original image files as base64. Imports are validated completely —
// including the records an older backup would keep — and then applied in a single transaction, so a
// rejected import changes nothing.
//
// schemasVersion 3 (written now) adds day trips (a record kind in `records`/`published`), taxonomy terms with
// key/order/active, the published taxonomy snapshot (`taxonomyPublication`) and the day-trip defaults
// (`dayTripDefaults`). Importing a v3 backup replaces everything (null or an empty list clears it).
// Older backups are still accepted (see LEGACY_IMPORT_NOTICES for exactly what they replace and keep):
// - schemasVersion 2 (before day trips): replaces destinations, accommodations, tours, their snapshots and
//   redirects, taxonomy terms, site settings, team profiles, team order and image details. KEEPS the current
//   day trips (drafts, published snapshots, route history, planned redirects), the day-trip defaults, and the
//   terms and image details/files those day trips use.
// - schemasVersion 1 (before Site Settings and Team): as version 2, and additionally KEEPS the current site
//   settings, team profiles and team order with the image details/files they use.
// Older backups' terms are upgraded like the database upgrade (key, order, active added; a term already stored
// here with the same ID keeps its current key, order and active flag) and become the published taxonomy,
// because older versions showed working term labels on the local site directly.
import { ALL_STORES, STORES, request, runTransaction } from './idb.js';
import { RepoError } from './content-repository.js';
import { MEDIA_LIMITS, inspectImageFile } from './media-validation.js';
import { KINDS, LEGACY_KINDS, assetRefs, makeContext, relationRefs, taxonomyRefs } from '../modules/shared/records.js';
import { ROUTE_PREFIXES, SLUG_PATTERN, redirectProblems, routeFor } from '../modules/shared/routes.js';
import { errorsOnly, validateDraft } from '../modules/shared/validation.js';
import { LINEUP_ID, SETTINGS_ID, SITE_KINDS, siteAssetRefs } from '../modules/shared/site.js';
import { validateMemberDraft, validateSettingsDraft } from '../modules/shared/site-validation.js';
import { TAXONOMY_NAMESPACES, TAXONOMY_PUBLICATION_ID, newTaxonomyPublication, publishedTermOf, termIssues, upgradeLegacyTerms } from '../modules/shared/taxonomy.js';
import { DEFAULTS_ID } from '../modules/shared/day-trips.js';
import { shortId } from '../modules/shared/format.js';

export const BACKUP_FORMAT = 'vion-cms-local-backup';
export const MEDIA_BACKUP_FORMAT = 'vion-cms-local-media-backup';
export const SCHEMAS_VERSION = 3;
export const LEGACY_SCHEMAS_VERSIONS = Object.freeze([1, 2]);
export const LEGACY_SCHEMAS_VERSION = 1;
export const MEDIA_SCHEMAS_VERSION = 1;
export const DATA_BACKUP_NOTICE = 'This data backup contains records (destinations, accommodations, tours and day trips), published snapshots, planned local redirects, taxonomy terms and the published taxonomy, day-trip defaults, site settings, team profiles, team order and visibility, and image metadata. It does NOT contain image files or private operational bookings, rates, tour costs and quotations. Export the separate media backup for images and the private operations backup from Quotations for operational records. Content imports retain private operations separately.';
export const LEGACY_IMPORT_NOTICES = Object.freeze({
  1: 'This backup was made before Site Settings, Team and Day Trips existed (schemasVersion 1). It replaces destinations, accommodations, tours, their published snapshots, planned redirects, taxonomy terms and image details. It keeps your current site settings, team profiles and team order, your day trips (drafts, published versions and planned redirects), the day-trip defaults, and the taxonomy terms and image details/files those kept records use. Terms that already exist here keep their key, display order and active flag; other terms get them from their labels. The backup’s terms become the published taxonomy.',
  2: 'This backup was made before Day Trips existed (schemasVersion 2). It replaces destinations, accommodations, tours, their published snapshots, planned redirects, taxonomy terms, site settings, team profiles, team order and image details. It keeps your current day trips (drafts, published versions and planned redirects), the day-trip defaults, and the taxonomy terms and image details/files those day trips use. Terms that already exist here keep their key, display order and active flag; other terms get them from their labels. The backup’s terms become the published taxonomy.'
});
export const LEGACY_IMPORT_NOTICE = LEGACY_IMPORT_NOTICES[1];

const WORKFLOW_KEYS = ['priorStatus', 'lastPublishedRoute', 'routeHistory', 'publishedRevision', 'lastPublishedAt', 'publishedSourceVersion', 'archivedAt'];
const SITE_WORKFLOW_KEYS = ['priorStatus', 'publishedRevision', 'lastPublishedAt', 'publishedSourceVersion', 'archivedAt', 'priorVisible'];
const SITE_STORES = [STORES.siteRecords, STORES.sitePublished];
const ASSET_KEYS = ['id', 'fileName', 'type', 'size', 'width', 'height', 'alt', 'credit', 'caption', 'createdAt', 'updatedAt', 'version'];
const LEGACY_TERM_KEYS = ['id', 'namespace', 'label', 'createdAt', 'updatedAt', 'version'];
const TERM_PATHS = new Set(['typeId', 'categoryId', 'standardId', 'tagIds']);
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

// Reads every collection a backup covers (inside the caller's transaction).
async function readCollections(tx) {
  const all = name => request(tx.objectStore(name).getAll());
  const [records, published, redirects, taxonomies, taxonomyPublication, assets, blobKeys, siteRecords, sitePublished, defaults] = await Promise.all([
    all(STORES.records), all(STORES.published), all(STORES.redirects), all(STORES.taxonomies),
    request(tx.objectStore(STORES.taxonomyPublished).get(TAXONOMY_PUBLICATION_ID)), all(STORES.assets), request(tx.objectStore(STORES.assetBlobs).getAllKeys()),
    all(STORES.siteRecords), all(STORES.sitePublished), request(tx.objectStore(STORES.defaults).get(DEFAULTS_ID))
  ]);
  return { records, published, redirects, taxonomies, taxonomyPublication: taxonomyPublication || null, assets, blobKeys, siteRecords, sitePublished, defaults: defaults || null };
}

export function createBackupService({ db, validator, siteValidator, events, clock = () => new Date().toISOString() }) {
  async function readAll() {
    return runTransaction(db, ALL_STORES, 'readonly', readCollections);
  }

  // Structural and semantic validation of the incoming file on its own. Returns { ok, errors, warnings,
  // summary, legacy, version }. Older backups' terms are checked with the rules they were written under.
  function validateDataBackup(data) {
    const errors = [];
    const warnings = [];
    const fail = (where, message) => errors.push(`${where}: ${message}`);
    if (!isObject(data)) return { ok: false, errors: ['The file is not a JSON object.'], warnings };
    if (data.format !== BACKUP_FORMAT) fail('format', `expected "${BACKUP_FORMAT}". This does not look like a Vion CMS data backup${data.format === MEDIA_BACKUP_FORMAT ? ' (it is a media backup — use “Import media backup”)' : ''}.`);
    const version = data.schemasVersion;
    const legacy = LEGACY_SCHEMAS_VERSIONS.includes(version);
    const hasSite = version === 2 || version === 3;
    if (!legacy && version !== SCHEMAS_VERSION) fail('schemasVersion', `expected ${SCHEMAS_VERSION} (or 2 for backups made before Day Trips, 1 for backups made before Site Settings and Team), found ${JSON.stringify(version)}. This backup was made by an unsupported version.`);
    for (const key of ['records', 'published', 'redirects', 'taxonomies', 'assets']) if (!Array.isArray(data[key])) fail(key, 'must be a list.');
    for (const key of ['siteRecords', 'sitePublished']) {
      if (hasSite && !Array.isArray(data[key])) fail(key, 'must be a list.');
      if (version === 1 && key in data) fail(key, 'is not part of a schemasVersion 1 backup.');
    }
    for (const key of ['taxonomyPublication', 'dayTripDefaults']) {
      if (version === SCHEMAS_VERSION && !(key in data)) fail(key, 'is missing (use null when there is none).');
      if (legacy && key in data) fail(key, `is not part of a schemasVersion ${version} backup.`);
    }
    if (errors.length) return { ok: false, errors, warnings, legacy, version };

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
    const assetIds = new Set(data.assets.filter(isObject).map(a => a.id));

    const terms = validateTerms(data, legacy, ids, fail);
    const publication = legacy
      ? (terms.length ? newTaxonomyPublication(terms, { now: new Date(0).toISOString(), origin: 'import' }) : null)
      : validatePublication(data.taxonomyPublication, terms, fail);
    const publishedTerms = new Map((publication?.terms || []).map(t => [t.id, t]));
    if (!legacy) validateDefaults(data.dayTripDefaults, fail);

    const kinds = legacy ? LEGACY_KINDS : KINDS;
    const structurallyValid = [];
    data.records.forEach((env, i) => {
      const where = `records[${i}]`;
      const before = errors.length;
      if (!isObject(env) || !isObject(env.record) || !isObject(env.workflow)) { fail(where, 'must contain id, kind, record and workflow objects.'); return; }
      for (const key of Object.keys(env)) if (!['id', 'kind', 'record', 'workflow'].includes(key)) fail(`${where}.${key}`, 'is not an allowed field.');
      if (!kinds.includes(env.kind)) fail(`${where}.kind`, legacy ? `must be destination, accommodation or tour${env.kind === 'dayTrip' ? ' (day trips need a schemasVersion 3 backup)' : ''}.` : 'must be destination, accommodation, tour or dayTrip.');
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
    // Published snapshots may only reference published records, terms of the published taxonomy (in the
    // right group) and images listed in this backup.
    data.published.filter(p => isObject(p) && isObject(p.snapshot)).forEach(p => {
      const where = `published[${data.published.indexOf(p)}].snapshot`;
      for (const ref of relationRefs(p.snapshot)) if (!publishedIds.has(ref.id)) fail(`${where}.${ref.path}`, `references ${ref.kind} ${ref.id}, which has no published snapshot in this backup.`);
      for (const ref of taxonomyRefs(p.snapshot)) {
        const term = publishedTerms.get(ref.id);
        if (!term) fail(`${where}.${ref.path}`, `references term ${ref.id}, which is not in the published taxonomy of this backup.`);
        else if (term.namespace !== ref.namespace) fail(`${where}.${ref.path}`, `references the ${TAXONOMY_NAMESPACES[term.namespace].toLowerCase()} “${term.label}” where a ${TAXONOMY_NAMESPACES[ref.namespace].toLowerCase()} is required.`);
      }
      for (const ref of assetRefs(p.snapshot)) if (!assetIds.has(ref.assetId)) fail(`${where}.${ref.path}`, `references image ${ref.assetId}, which is not in this backup’s image list.`);
    });

    data.redirects.forEach((r, i) => {
      const where = `redirects[${i}]`;
      if (!isObject(r)) { fail(where, 'must be an object.'); return; }
      for (const key of Object.keys(r)) if (!['id', 'from', 'to', 'statusCode', 'recordId', 'kind', 'createdAt', 'updatedAt'].includes(key)) fail(`${where}.${key}`, 'is not an allowed field.');
      if (!isUuid(r.id) || !isRoute(r.from) || !isRoute(r.to) || r.statusCode !== 308) fail(where, 'must have an id, local from/to routes and statusCode 308.');
      if (!recordIds.has(r.recordId)) fail(`${where}.recordId`, 'has no matching record.');
    });
    for (const problem of redirectProblems(data.redirects.filter(isObject))) fail('redirects', problem);

    const siteValid = hasSite ? validateSiteCollections(data, ids, errors, fail, assetIds) : [];

    // Semantic draft checks (unsafe links, phone numbers, references, unique routes, term groups) on every
    // structurally valid record, so all problems are reported together even when other parts are invalid.
    // Inactive or unresolved terms already saved on a record are kept and reported as warnings.
    try {
      const objects = list => list.filter(item => isObject(item) && typeof item.id === 'string');
      const assets = objects(data.assets);
      const ctx = makeContext({
        records: structurallyValid, published: objects(data.published).filter(p => isObject(p.snapshot)), redirects: objects(data.redirects),
        assets, blobKeys: assets.map(a => a.id), taxonomies: terms, taxonomyPublication: publication, siteRecords: siteValid, validator, siteValidator
      });
      for (const env of structurallyValid) {
        for (const issue of validateDraft(env.record, ctx)) {
          const line = `${env.kind === 'dayTrip' ? 'day trip' : env.kind} “${env.record.title}” ${issue.path}: ${issue.message}`;
          if (issue.severity === 'error') errors.push(line);
          else if (TERM_PATHS.has(issue.path)) warnings.push(line);
        }
      }
      for (const env of siteValid) {
        const check = env.kind === 'siteSettings' ? validateSettingsDraft : env.kind === 'teamMember' ? validateMemberDraft : null;
        for (const issue of errorsOnly(check ? check(env.record, ctx) : [])) fail(`${env.kind === 'teamMember' ? `team profile “${env.record.name}”` : 'site settings'} ${issue.path}`, issue.message);
      }
    } catch (err) {
      fail('records', `could not be checked (${err.message}).`);
    }
    const summary = {
      schemasVersion: version, records: data.records.length, published: data.published.length, redirects: data.redirects.length, taxonomies: data.taxonomies.length, assets: data.assets.length,
      dayTrips: data.records.filter(e => e?.kind === 'dayTrip').length,
      taxonomyPublished: legacy ? null : !!data.taxonomyPublication, dayTripDefaults: legacy ? null : !!data.dayTripDefaults,
      siteRecords: hasSite ? data.siteRecords.length : null, sitePublished: hasSite ? data.sitePublished.length : null,
      teamProfiles: hasSite ? data.siteRecords.filter(e => e?.kind === 'teamMember').length : null, settings: hasSite ? data.siteRecords.some(e => e?.kind === 'siteSettings') : null
    };
    return { ok: errors.length === 0, errors, warnings, summary, legacy, version };
  }

  // Returns the terms (upgraded for older backups) used for the semantic checks.
  function validateTerms(data, legacy, ids, fail) {
    const valid = [];
    const seenLabels = new Set();
    data.taxonomies.forEach((t, i) => {
      const where = `taxonomies[${i}]`;
      if (!isObject(t)) { fail(where, 'must be an object.'); return; }
      const before = ids.size;
      if (legacy) {
        for (const key of Object.keys(t)) if (!LEGACY_TERM_KEYS.includes(key)) fail(`${where}.${key}`, 'is not an allowed field.');
        if (!isUuid(t.id)) fail(`${where}.id`, 'must be a UUID.');
        if (!(t.namespace in TAXONOMY_NAMESPACES)) fail(`${where}.namespace`, `must be one of ${Object.keys(TAXONOMY_NAMESPACES).join(', ')}.`);
        if (typeof t.label !== 'string' || !t.label.trim() || t.label.length > 80) fail(`${where}.label`, 'must be 1–80 characters.');
        const key = `${t.namespace}|${String(t.label).toLowerCase()}`;
        if (seenLabels.has(key)) fail(`${where}.label`, 'duplicates another term in the same namespace.');
        seenLabels.add(key);
        if (!isIso(t.createdAt) || !isIso(t.updatedAt) || !isInt(t.version, 1)) fail(where, 'needs ISO timestamps and a positive version.');
      } else {
        for (const e of validator.validate(t, '#/$defs/taxonomyTerm')) fail(`${where}.${e.path}`, e.message);
        for (const issue of termIssues(t, data.taxonomies.filter(isObject))) fail(`${where}.${issue.path}`, issue.message);
      }
      if (ids.has(t.id)) fail(`${where}.id`, 'is duplicated.');
      ids.add(t.id);
      if (ids.size > before) valid.push(t);
    });
    return legacy ? upgradeLegacyTerms(valid.filter(t => t.namespace in TAXONOMY_NAMESPACES)) : valid;
  }

  function validatePublication(pub, terms, fail) {
    if (pub === null) return null;
    if (!isObject(pub)) { fail('taxonomyPublication', 'must be an object or null.'); return null; }
    const before = [];
    for (const e of validator.validate(pub, '#/$defs/taxonomyPublication')) { fail(`taxonomyPublication.${e.path}`, e.message); before.push(e); }
    if (before.length || !Array.isArray(pub.terms)) return null;
    const byId = new Map(terms.map(t => [t.id, t]));
    const seen = new Set();
    pub.terms.forEach((p, i) => {
      const where = `taxonomyPublication.terms[${i}]`;
      const term = byId.get(p.id);
      if (!term) fail(where, `term ${p.id} is published but not in this backup’s term list (terms are never deleted).`);
      else {
        if (term.namespace !== p.namespace) fail(where, 'is in a different group than the stored term.');
        if (term.key !== p.key) fail(where, `has key “${p.key}” but the stored term has “${term.key}”; keys of published terms cannot change.`);
      }
      if (seen.has(p.id)) fail(where, 'is duplicated.');
      seen.add(p.id);
    });
    return pub;
  }

  function validateDefaults(defaults, fail) {
    if (defaults === null) return;
    if (!isObject(defaults)) { fail('dayTripDefaults', 'must be an object or null.'); return; }
    for (const e of validator.validate(defaults, '#/$defs/dayTripDefaults')) fail(`dayTripDefaults.${e.path}`, e.message);
  }

  // Structural and cross-record checks for siteRecords/sitePublished. Returns the structurally valid envelopes.
  function validateSiteCollections(data, ids, errors, fail, assetIds) {
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
      for (const ref of siteAssetRefs(p.snapshot)) if (!assetIds.has(ref.assetId)) fail(`${where}.snapshot.${ref.path}`, `references image ${ref.assetId}, which is not in this backup’s image list.`);
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

  // Combines a validated backup with what an import keeps from the current data, then checks the kept records
  // against the combined result. Pure apart from `now`; used by both previewImport and importData.
  function planImport(data, check, current, now) {
    const errors = [];
    if (!check.legacy) {
      return {
        errors,
        kept: { siteRecords: 0, assets: 0, dayTrips: 0, terms: 0, defaults: false },
        final: {
          records: data.records, published: data.published, redirects: data.redirects, taxonomies: data.taxonomies, taxonomyPublication: data.taxonomyPublication,
          defaults: data.dayTripDefaults, assets: data.assets, siteRecords: data.siteRecords, sitePublished: data.sitePublished
        }
      };
    }
    const keepSite = check.version === 1;
    const keptTrips = current.records.filter(env => env.kind === 'dayTrip');
    const keptTripSnapshots = current.published.filter(p => p.kind === 'dayTrip');
    const keptTripRecords = [...keptTrips.map(env => env.record), ...keptTripSnapshots.map(p => p.snapshot)];
    const siteRecords = keepSite ? current.siteRecords : data.siteRecords;
    const sitePublished = keepSite ? current.sitePublished : data.sitePublished;

    // Terms: the backup's (upgraded) terms replace the current ones; current terms used by kept day trips stay.
    // An older backup has no keys, order or active flags: a term that exists here with the same ID and group
    // keeps its current key, order and active flag (so published keys never change); others get them derived.
    const currentTerms = new Map(current.taxonomies.map(t => [t.id, t]));
    const incomingTerms = upgradeLegacyTerms(data.taxonomies.map(t => {
      const known = currentTerms.get(t.id);
      return known?.namespace === t.namespace ? { ...t, key: known.key, order: known.order, active: known.active } : t;
    }));
    const incomingTermIds = new Set(incomingTerms.map(t => t.id));
    const tripTermIds = new Set(keptTripRecords.flatMap(taxonomyRefs).map(ref => ref.id));
    const keptTerms = current.taxonomies.filter(t => tripTermIds.has(t.id) && !incomingTermIds.has(t.id));
    const taxonomies = [...incomingTerms, ...keptTerms];
    // Published taxonomy: the backup's terms plus the published versions of kept terms (a kept term that was
    // never published stays unpublished, and unpublished edits to kept terms are not published by an import).
    const currentPublished = new Map((current.taxonomyPublication?.terms || []).map(t => [t.id, t]));
    const publishedTerms = [...incomingTerms.map(publishedTermOf), ...keptTerms.filter(t => currentPublished.has(t.id)).map(t => currentPublished.get(t.id))];
    const taxonomyPublication = publishedTerms.length ? newTaxonomyPublication(publishedTerms, { now, revision: (current.taxonomyPublication?.revision || 0) + 1, origin: 'import' }) : null;

    // Image details: the backup's, plus current ones used by kept records (day trips; site records for v1).
    const usedByKept = new Set([
      ...keptTripRecords.flatMap(assetRefs),
      ...(keepSite ? [...siteRecords.map(env => env.record), ...sitePublished.map(p => p.snapshot)].flatMap(siteAssetRefs) : [])
    ].map(ref => ref.assetId));
    const incomingAssetIds = new Set(data.assets.map(a => a.id));
    const keptAssets = current.assets.filter(a => usedByKept.has(a.id) && !incomingAssetIds.has(a.id));

    const final = {
      records: [...data.records, ...keptTrips], published: [...data.published, ...keptTripSnapshots],
      redirects: [...data.redirects, ...current.redirects.filter(r => r.kind === 'dayTrip')],
      taxonomies, taxonomyPublication, defaults: current.defaults, assets: [...data.assets, ...keptAssets], siteRecords, sitePublished
    };

    if (keptTrips.length) {
      const ctx = makeContext({ ...final, blobKeys: current.blobKeys, validator, siteValidator });
      for (const env of keptTrips) {
        for (const issue of errorsOnly(validateDraft(env.record, ctx))) errors.push(`Kept day trip “${env.record.title}” ${issue.path}: ${issue.message} Fix or archive the day trip before importing, or import a newer backup.`);
      }
      for (const pub of keptTripSnapshots) {
        const title = pub.snapshot.title;
        for (const ref of relationRefs(pub.snapshot)) {
          if (ctx.published.get(ref.id)?.kind !== ref.kind) errors.push(`Published day trip “${title}”: it links ${ref.kind} ${shortId(ref.id)}, which is not published in this backup. Unpublish the day trip first (Tour Packages › Activities / day trips), or import a newer backup.`);
        }
        for (const ref of taxonomyRefs(pub.snapshot)) {
          if (!ctx.publishedTerms.has(ref.id)) errors.push(`Published day trip “${title}”: its tag ${shortId(ref.id)} would not be in the published taxonomy after this import. Unpublish the day trip first, or import a newer backup.`);
        }
      }
      for (const term of keptTerms) {
        for (const issue of termIssues(term, taxonomies)) errors.push(`Kept tag “${term.label}” (used by day trips): ${issue.message}`);
      }
    }
    for (const problem of redirectProblems(final.redirects)) errors.push(`redirects: ${problem}`);
    return {
      errors, final,
      kept: { siteRecords: keepSite ? siteRecords.length : 0, assets: keptAssets.length, dayTrips: keptTrips.length, terms: keptTerms.length, defaults: !!current.defaults }
    };
  }

  return {
    async exportData() {
      const all = await readAll();
      return {
        format: BACKUP_FORMAT, schemasVersion: SCHEMAS_VERSION, exportedAt: clock(), binaryAssetsIncluded: false, notice: DATA_BACKUP_NOTICE,
        records: all.records, published: all.published, redirects: all.redirects, taxonomies: all.taxonomies, taxonomyPublication: all.taxonomyPublication,
        dayTripDefaults: all.defaults, assets: all.assets, siteRecords: all.siteRecords, sitePublished: all.sitePublished
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

    // Read-only dry run: validates the file and what an older backup would keep, without changing anything.
    async previewImport(data) {
      const check = validateDataBackup(data);
      if (!check.ok) return { ...check, kept: null };
      const current = await readAll();
      const plan = planImport(data, check, current, clock());
      return { ...check, ok: !plan.errors.length, errors: plan.errors, kept: plan.kept };
    },

    // Applies a backup in one transaction (see the header comment for what each version replaces or keeps).
    // Image files are kept only for images that remain listed; the separate media backup restores files.
    async importData(data) {
      const check = validateDataBackup(data);
      if (!check.ok) throw new RepoError('validation', 'The backup was rejected. Nothing was changed.', { errors: check.errors });
      const summary = await runTransaction(db, ALL_STORES, 'readwrite', async tx => {
        const store = name => tx.objectStore(name);
        const now = clock();
        const plan = planImport(data, check, await readCollections(tx), now);
        if (plan.errors.length) throw new RepoError('validation', 'The backup was rejected. Nothing was changed.', { errors: plan.errors });
        const { final } = plan;
        const keep = new Set(final.assets.map(a => a.id));
        const blobStore = store(STORES.assetBlobs);
        const blobKeys = await request(blobStore.getAllKeys());
        for (const key of blobKeys) if (!keep.has(key)) await request(blobStore.delete(key));
        const replaceSite = check.version !== 1;
        const replaced = [STORES.records, STORES.published, STORES.redirects, STORES.taxonomies, STORES.taxonomyPublished, STORES.assets, ...(replaceSite ? SITE_STORES : []), ...(check.legacy ? [] : [STORES.defaults])];
        for (const name of replaced) await request(store(name).clear());
        for (const env of final.records) await request(store(STORES.records).put(env));
        for (const p of final.published) await request(store(STORES.published).put(p));
        for (const r of final.redirects) await request(store(STORES.redirects).put(r));
        for (const t of final.taxonomies) await request(store(STORES.taxonomies).put(t));
        if (final.taxonomyPublication) await request(store(STORES.taxonomyPublished).put(final.taxonomyPublication));
        if (!check.legacy && final.defaults) await request(store(STORES.defaults).put(final.defaults));
        for (const a of final.assets) await request(store(STORES.assets).put(a));
        if (replaceSite) {
          for (const env of final.siteRecords) await request(store(STORES.siteRecords).put(env));
          for (const p of final.sitePublished) await request(store(STORES.sitePublished).put(p));
        }
        const remainingBlobs = new Set(blobKeys.filter(key => keep.has(key)));
        const applied = {
          ...check.summary, keptSiteRecords: plan.kept.siteRecords, keptAssets: plan.kept.assets, keptDayTrips: plan.kept.dayTrips, keptTerms: plan.kept.terms,
          keptDefaults: check.legacy && plan.kept.defaults, missingFiles: final.assets.filter(a => !remainingBlobs.has(a.id)).length, warnings: check.warnings.length
        };
        await request(store(STORES.meta).put({ key: 'lastImport', at: now, summary: applied }));
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
