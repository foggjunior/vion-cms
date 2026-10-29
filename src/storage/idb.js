// Minimal IndexedDB adapter. A write is reported as successful only after its transaction's
// `complete` event (requested with strict durability); errors and aborts always reject.
// Version 2 (additive) adds siteRecords/sitePublished for site settings, team profiles and the team lineup.
// Version 3 (additive) adds taxonomyPublished (the published taxonomy snapshot) and defaults (day-trip
// defaults), and gives existing taxonomy terms a key, display order and active flag (see upgradeLegacyTerms).
// Day trips are a new record kind in the existing records/published stores, so they need no new store.
import { newTaxonomyPublication, upgradeLegacyTerms } from '../modules/shared/taxonomy.js';

export const DB_VERSION = 3;
export const STORES = Object.freeze({
  records: 'records', published: 'published', redirects: 'redirects', assets: 'assets', assetBlobs: 'assetBlobs', taxonomies: 'taxonomies', meta: 'meta',
  siteRecords: 'siteRecords', sitePublished: 'sitePublished', taxonomyPublished: 'taxonomyPublished', defaults: 'defaults'
});
export const ALL_STORES = Object.freeze(Object.values(STORES));

export class StorageError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.cause = cause;
  }
}

const MESSAGES = {
  QuotaExceededError: ['quota', 'Not saved: this browser has no storage space left for the CMS. Remove unused images or export a backup, then try again.'],
  VersionError: ['version', 'Not saved: the local database was upgraded by a newer copy of the CMS. Reload this tab.'],
  InvalidStateError: ['closed', 'Not saved: the local database connection was closed. Reload this tab and try again.'],
  TransactionInactiveError: ['inactive', 'Not saved: the storage transaction ended unexpectedly. Try again.'],
  DataCloneError: ['clone', 'Not saved: the data could not be stored by the browser.'],
  ConstraintError: ['constraint', 'Not saved: a stored value conflicts with an existing entry.'],
  AbortError: ['aborted', 'Not saved: the storage transaction was cancelled. Nothing was changed.'],
  UnknownError: ['unknown', 'Not saved: the browser reported an unknown storage error. Try again; if it repeats, export a backup.']
};

export function toStorageError(err) {
  if (err instanceof StorageError) return err;
  const [code, message] = MESSAGES[err?.name] || ['failed', `Not saved: local storage failed (${err?.message || err?.name || 'unknown reason'}).`];
  return new StorageError(code, message, err);
}

export function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function openDatabase(name, { onBlocked, onVersionChange } = {}) {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new StorageError('unavailable', 'This browser does not provide IndexedDB storage, so the local CMS cannot save records.'));
      return;
    }
    let req;
    try { req = indexedDB.open(name, DB_VERSION); } catch (err) {
      reject(new StorageError('unavailable', 'Local storage is blocked in this browser (private mode or site-data settings). Records cannot be saved.', err));
      return;
    }
    req.onupgradeneeded = event => upgrade(req.result, event.oldVersion, req.transaction);
    req.onblocked = () => onBlocked?.();
    req.onerror = () => reject(new StorageError('open-failed', `The local database could not be opened (${req.error?.name || 'unknown error'}). Check that site data is allowed for this page.`, req.error));
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); onVersionChange?.(); };
      resolve(db);
    };
  });
}

// Runs inside the versionchange transaction: if any step fails, the whole upgrade is rolled back and the
// database stays at its previous version with its data unchanged.
function upgrade(db, oldVersion, tx) {
  if (oldVersion < 1) {
    db.createObjectStore(STORES.records, { keyPath: 'id' }).createIndex('kind', 'kind');
    db.createObjectStore(STORES.published, { keyPath: 'id' }).createIndex('kind', 'kind');
    db.createObjectStore(STORES.redirects, { keyPath: 'id' }).createIndex('from', 'from', { unique: true });
    db.createObjectStore(STORES.assets, { keyPath: 'id' });
    db.createObjectStore(STORES.assetBlobs, { keyPath: 'id' });
    db.createObjectStore(STORES.taxonomies, { keyPath: 'id' }).createIndex('namespace', 'namespace');
    db.createObjectStore(STORES.meta, { keyPath: 'key' });
  }
  // Additive: existing stores and their records are left untouched.
  if (oldVersion < 2) {
    db.createObjectStore(STORES.siteRecords, { keyPath: 'id' }).createIndex('kind', 'kind');
    db.createObjectStore(STORES.sitePublished, { keyPath: 'id' }).createIndex('kind', 'kind');
  }
  if (oldVersion < 3) {
    db.createObjectStore(STORES.taxonomyPublished, { keyPath: 'id' });
    db.createObjectStore(STORES.defaults, { keyPath: 'id' });
    // Terms keep their id, namespace, label, timestamps and version; key/order/active are added. Before
    // version 3 the local preview site showed the working term labels directly, so those terms become the
    // first published taxonomy snapshot (origin "upgrade") and the local site looks the same as before.
    const terms = tx.objectStore(STORES.taxonomies);
    terms.getAll().onsuccess = event => {
      const stored = event.target.result;
      if (!stored.length) return;
      const upgraded = upgradeLegacyTerms(stored);
      for (const term of upgraded) terms.put(term);
      tx.objectStore(STORES.taxonomyPublished).put(newTaxonomyPublication(upgraded, { now: new Date().toISOString(), origin: 'upgrade' }));
    };
  }
}

// Runs `work(tx)` inside one transaction. `work` may only await IndexedDB requests (no other async work),
// otherwise the transaction would auto-commit early. Domain errors thrown by `work` abort the transaction
// and are re-thrown unchanged; storage failures are mapped to StorageError.
export function runTransaction(db, storeNames, mode, work) {
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(storeNames, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
    } catch (err) {
      reject(toStorageError(err));
      return;
    }
    let workError = null;
    let outcome;
    try {
      outcome = Promise.resolve(work(tx));
    } catch (err) {
      outcome = Promise.reject(err);
    }
    outcome.catch(err => {
      workError = err;
      try { tx.abort(); } catch { /* already finishing */ }
    });
    tx.oncomplete = () => outcome.then(resolve, reject);
    tx.onabort = () => {
      if (workError && !(workError instanceof DOMException)) reject(workError);
      else reject(toStorageError(workError || tx.error || { name: 'AbortError' }));
    };
  });
}
