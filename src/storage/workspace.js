// Opens the local workspace: one IndexedDB database shared by the content, site (settings + team), media,
// taxonomy and backup services.
import { StorageError, openDatabase } from './idb.js';
import { createContentRepository } from './content-repository.js';
import { createMediaRepository } from './media-repository.js';
import { createTaxonomyRepository } from './taxonomy-repository.js';
import { createSiteRepository } from './site-repository.js';
import { createBackupService } from './backup.js';
import { createSchemaValidator } from '../modules/shared/schema-validator.js';

export const DEFAULT_DB_NAME = 'vion-cms-local';

// Local listeners plus a BroadcastChannel so other tabs learn about changes (stale-edit warnings).
export function createEvents(channelName) {
  const listeners = new Set();
  let channel = null;
  try { channel = new BroadcastChannel(channelName); } catch { channel = null; }
  if (channel) channel.onmessage = event => listeners.forEach(fn => fn({ ...event.data, remote: true }));
  return {
    emit(event) {
      listeners.forEach(fn => fn(event));
      try { channel?.postMessage(event); } catch { /* other tabs simply miss the hint */ }
    },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    close() { channel?.close(); listeners.clear(); }
  };
}

// Test hook: `faults.failNext(op, errorName)` makes the next matching write abort inside its transaction.
export function createFaults() {
  const pending = [];
  return {
    failNext(op = '*', errorName = 'QuotaExceededError') { pending.push({ op, errorName }); },
    clear() { pending.length = 0; },
    check(op) {
      const index = pending.findIndex(f => f.op === op || f.op === '*');
      if (index === -1) return;
      const [fault] = pending.splice(index, 1);
      throw new DOMException(`Simulated ${fault.errorName} during ${op}`, fault.errorName);
    }
  };
}

export async function loadSchema(url = new URL('../../schemas/content.schema.json', import.meta.url)) {
  const response = await fetch(url);
  if (!response.ok) throw new StorageError('schema', `The record schema could not be loaded (${response.status}). Serve the CMS over http://127.0.0.1:5173 as described in README.md.`);
  return response.json();
}

export const loadSiteSchema = () => loadSchema(new URL('../../schemas/site.schema.json', import.meta.url));

export async function openWorkspace({ dbName = DEFAULT_DB_NAME, schema, siteSchema, onBlocked, onVersionChange, clock, newId } = {}) {
  const validator = createSchemaValidator(schema || await loadSchema());
  const siteValidator = createSchemaValidator(siteSchema || await loadSiteSchema());
  const db = await openDatabase(dbName, { onBlocked, onVersionChange });
  const events = createEvents(`vion-cms:${dbName}`);
  const faults = createFaults();
  const options = { db, validator, siteValidator, events, faults, ...(clock && { clock }), ...(newId && { newId }) };
  const content = createContentRepository(options);
  return {
    dbName, db, validator, siteValidator, events, faults, content,
    site: createSiteRepository(options),
    media: createMediaRepository(options),
    taxonomies: createTaxonomyRepository(options),
    backup: createBackupService(options),
    loadContext: () => content.loadContext(),
    close() { events.close(); db.close(); }
  };
}

export async function deleteWorkspace(dbName) {
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
    req.onblocked = resolve;
  });
}

export async function storageEstimate() {
  const result = { usage: null, quota: null, persisted: null };
  try { Object.assign(result, await navigator.storage?.estimate?.()); } catch { /* unsupported */ }
  try { result.persisted = await navigator.storage?.persisted?.(); } catch { /* unsupported */ }
  return result;
}
