// Prototype tour taxonomy terms with stable IDs per namespace (type/category/standard/tag).
// No existing values are assumed (B4 unresolved); terms cannot be deleted while referenced.
import { STORES, request, runTransaction } from './idb.js';
import { RepoError, readContext } from './content-repository.js';
import { TAXONOMY_NAMESPACES, taxonomyUsage } from '../modules/shared/records.js';

const ALL = [STORES.records, STORES.published, STORES.redirects, STORES.assets, STORES.assetBlobs, STORES.taxonomies];

export function createTaxonomyRepository({ db, validator, events, clock = () => new Date().toISOString(), newId = () => crypto.randomUUID(), faults = null }) {
  const emit = (type, id) => events?.emit({ type, id, kind: 'taxonomy' });

  function checkLabel(label, namespace, terms, exceptId) {
    const clean = String(label || '').replace(/\s+/g, ' ').trim();
    if (!clean) throw new RepoError('validation', 'Enter a label for the term.');
    if (clean.length > 80) throw new RepoError('validation', 'Keep term labels to 80 characters or fewer.');
    if (terms.some(t => t.namespace === namespace && t.id !== exceptId && t.label.toLowerCase() === clean.toLowerCase())) {
      throw new RepoError('conflict', `“${clean}” already exists as a ${TAXONOMY_NAMESPACES[namespace].toLowerCase()}.`);
    }
    return clean;
  }

  return {
    async list() {
      const terms = await runTransaction(db, [STORES.taxonomies], 'readonly', tx => request(tx.objectStore(STORES.taxonomies).getAll()));
      return terms.sort((a, b) => a.namespace.localeCompare(b.namespace) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
    },

    async create(namespace, label) {
      if (!(namespace in TAXONOMY_NAMESPACES)) throw new RepoError('validation', 'Unknown taxonomy namespace.');
      const term = await runTransaction(db, [STORES.taxonomies], 'readwrite', async tx => {
        const terms = await request(tx.objectStore(STORES.taxonomies).getAll());
        const now = clock();
        const next = { id: newId(), namespace, label: checkLabel(label, namespace, terms), createdAt: now, updatedAt: now, version: 1 };
        await request(tx.objectStore(STORES.taxonomies).put(next));
        faults?.check('createTerm');
        return next;
      });
      emit('term-created', term.id);
      return term;
    },

    async rename(id, label, { expectedVersion } = {}) {
      const term = await runTransaction(db, [STORES.taxonomies], 'readwrite', async tx => {
        const terms = await request(tx.objectStore(STORES.taxonomies).getAll());
        const current = terms.find(t => t.id === id);
        if (!current) throw new RepoError('not-found', 'This term no longer exists.');
        if (expectedVersion != null && current.version !== expectedVersion) throw new RepoError('stale', 'This term was changed elsewhere. Reload and try again.');
        const next = { ...current, label: checkLabel(label, current.namespace, terms, id), updatedAt: clock(), version: current.version + 1 };
        await request(tx.objectStore(STORES.taxonomies).put(next));
        faults?.check('renameTerm');
        return next;
      });
      emit('term-updated', id);
      return term;
    },

    async remove(id) {
      await runTransaction(db, ALL, 'readwrite', async tx => {
        const ctx = await readContext(tx, validator);
        if (!ctx.taxonomies.has(id)) throw new RepoError('not-found', 'This term no longer exists.');
        const usage = taxonomyUsage(id, ctx);
        if (usage.length) throw new RepoError('dependency', `This term is used by ${usage.map(u => `“${u.title}” (${u.where})`).join(', ')}. Remove it from those tours first.`, { usage });
        await request(tx.objectStore(STORES.taxonomies).delete(id));
        faults?.check('removeTerm');
      });
      emit('term-removed', id);
    }
  };
}
