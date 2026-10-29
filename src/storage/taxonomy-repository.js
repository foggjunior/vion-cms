// Tour taxonomy terms with stable IDs per namespace (type/category/standard/tag). No existing values are
// assumed (B4 unresolved) and nothing is seeded. Terms are never deleted in this phase: they are deactivated.
//
// Each term: { id, namespace, label, key, order, active, createdAt, updatedAt, version }.
// - IDs never change; renaming changes the label only.
// - The key is suggested from the first label and can be edited until the term is first published; after
//   that it is locked so external references (such as the day-trip ?filter=tag&value=<key>) never change.
// - Order and activation are per term; ordering moves within one namespace.
// Every write runs in one transaction, checks the version the caller saw (stale-write protection) and is
// reported only after `complete`. Term edits change the working terms only; `publish()` stores the single
// published taxonomy snapshot and never touches content records.
import { STORES, request, runTransaction } from './idb.js';
import { RepoError } from './content-repository.js';
import {
  TAXONOMY_NAMESPACES, TAXONOMY_PUBLICATION_ID, isPublishedTerm, namespaceTerms, newTaxonomyPublication, nextOrder,
  normalizeTermKey, normalizeTermLabel, sortTerms, suggestTermKey, taxonomyChanges, termIssues, termsFingerprint
} from '../modules/shared/taxonomy.js';

const TERM_STORES = [STORES.taxonomies, STORES.taxonomyPublished];

export function createTaxonomyRepository({ db, validator, events, clock = () => new Date().toISOString(), newId = () => crypto.randomUUID(), faults = null }) {
  const emit = (type, id) => events?.emit({ type, id, kind: 'taxonomy' });

  const write = (op, work) => runTransaction(db, TERM_STORES, 'readwrite', async tx => {
    const [terms, publication] = await Promise.all([
      request(tx.objectStore(STORES.taxonomies).getAll()),
      request(tx.objectStore(STORES.taxonomyPublished).get(TAXONOMY_PUBLICATION_ID))
    ]);
    const result = await work(tx, { terms, publication: publication || null });
    faults?.check(op);
    return result;
  });
  const put = (tx, term) => request(tx.objectStore(STORES.taxonomies).put(term));

  function requireTerm(terms, id, expectedVersion) {
    const term = terms.find(t => t.id === id);
    if (!term) throw new RepoError('not-found', 'This term no longer exists. Reload the taxonomy list.');
    if (expectedVersion != null && term.version !== expectedVersion) {
      throw new RepoError('stale', `“${term.label}” was changed elsewhere (you loaded version ${expectedVersion}; the stored version is ${term.version}). Your change was not saved. Reload to continue.`, { currentVersion: term.version });
    }
    return term;
  }

  // Rules plus the schema shape; duplicates are reported as conflicts, other problems as validation errors.
  function check(next, terms) {
    const issues = termIssues(next, terms);
    for (const e of validator?.validate(next, '#/$defs/taxonomyTerm') || []) if (!issues.some(i => i.path === e.path)) issues.push({ path: e.path || 'label', message: `${e.path || 'Term'} ${e.message}.`, severity: 'error' });
    if (!issues.length) return;
    const conflict = issues.find(i => i.code === 'conflict');
    throw new RepoError(conflict && issues.every(i => i.code === 'conflict') ? 'conflict' : 'validation', (conflict || issues[0]).message, { issues });
  }

  return {
    async list() {
      const terms = await runTransaction(db, [STORES.taxonomies], 'readonly', tx => request(tx.objectStore(STORES.taxonomies).getAll()));
      return sortTerms(terms);
    },

    async getPublication() {
      return runTransaction(db, [STORES.taxonomyPublished], 'readonly', async tx => (await request(tx.objectStore(STORES.taxonomyPublished).get(TAXONOMY_PUBLICATION_ID))) || null);
    },

    async changes() {
      const [terms, publication] = await Promise.all([this.list(), this.getPublication()]);
      return taxonomyChanges(terms, publication);
    },

    // input: { label, key } (key optional: suggested from the label), or a label string.
    async create(namespace, input) {
      if (!(namespace in TAXONOMY_NAMESPACES)) throw new RepoError('validation', 'Unknown taxonomy group.', { issues: [{ path: 'namespace', message: 'Unknown taxonomy group.', severity: 'error' }] });
      const { label, key } = typeof input === 'string' ? { label: input } : input || {};
      const term = await write('createTerm', async (tx, { terms }) => {
        const now = clock();
        const clean = normalizeTermLabel(label);
        const next = { id: newId(), namespace, label: clean, key: key == null || key === '' ? suggestTermKey(clean) : normalizeTermKey(key), order: nextOrder(terms, namespace), active: true, createdAt: now, updatedAt: now, version: 1 };
        check(next, terms);
        await put(tx, next);
        return next;
      });
      emit('term-created', term.id);
      return term;
    },

    // Changes the label and/or key. The ID never changes; the key is locked once the term has been published.
    async update(id, changes, { expectedVersion } = {}) {
      const term = await write('updateTerm', async (tx, { terms, publication }) => {
        const current = requireTerm(terms, id, expectedVersion);
        const next = { ...current };
        if ('label' in changes) next.label = normalizeTermLabel(changes.label);
        if ('key' in changes) {
          const key = normalizeTermKey(changes.key);
          if (key !== current.key && isPublishedTerm(id, publication)) {
            throw new RepoError('invalid-state', `The key of “${current.label}” is locked because the term has been published; external references (such as tag filter links) use it. The label can still change.`, { issues: [{ path: 'key', message: 'The key is locked because this term has been published.', severity: 'error' }] });
          }
          next.key = key;
        }
        if (next.label === current.label && next.key === current.key) return current;
        check(next, terms);
        const saved = { ...next, updatedAt: clock(), version: current.version + 1 };
        await put(tx, saved);
        return saved;
      });
      emit('term-updated', id);
      return term;
    },

    rename(id, label, options) { return this.update(id, { label }, options); },

    // Inactive terms stay on records that already use them and stay visible there; they are only withheld
    // from new selections. No record is changed.
    async setActive(id, active, { expectedVersion } = {}) {
      const term = await write('setTermActive', async (tx, { terms }) => {
        const current = requireTerm(terms, id, expectedVersion);
        if (current.active === !!active) throw new RepoError('invalid-state', `“${current.label}” is already ${active ? 'active' : 'inactive'}.`);
        const saved = { ...current, active: !!active, updatedAt: clock(), version: current.version + 1 };
        await put(tx, saved);
        return saved;
      });
      emit('term-updated', id);
      return term;
    },

    // Moves a term up (-1) or down (+1) within its namespace. `expectedOrder` is the namespace's term IDs in
    // the order the caller showed; if the stored order differs the move is rejected as stale. Orders are
    // rewritten as 1..n so they stay contiguous.
    async move(id, delta, { expectedOrder } = {}) {
      const moved = await write('moveTerm', async (tx, { terms }) => {
        const current = requireTerm(terms, id);
        const group = namespaceTerms(terms, current.namespace);
        if (expectedOrder && group.map(t => t.id).join(',') !== expectedOrder.join(',')) {
          throw new RepoError('stale', `The order of ${TAXONOMY_NAMESPACES[current.namespace].toLowerCase()}s was changed elsewhere. The latest order is shown now; try again.`);
        }
        const from = group.findIndex(t => t.id === id);
        const to = from + delta;
        if (to < 0 || to >= group.length) throw new RepoError('invalid-state', `“${current.label}” cannot move further in that direction.`);
        [group[from], group[to]] = [group[to], group[from]];
        const now = clock();
        const changed = [];
        for (const [index, term] of group.entries()) {
          if (term.order === index + 1) continue;
          const saved = { ...term, order: index + 1, updatedAt: now, version: term.version + 1 };
          await put(tx, saved);
          changed.push(saved);
        }
        return { term: changed.find(t => t.id === id) || current, position: to + 1, count: group.length };
      });
      emit('terms-reordered', id);
      return moved;
    },

    // Publishes every working term (labels, keys, order, activation) as one snapshot for the local preview
    // site. `expectedFingerprint` (termsFingerprint of the terms the person reviewed) guards against
    // publishing changes they did not see. Content records are not read or written.
    async publish({ expectedFingerprint } = {}) {
      const publication = await write('publishTaxonomy', async (tx, { terms, publication: current }) => {
        if (expectedFingerprint != null && termsFingerprint(terms) !== expectedFingerprint) {
          throw new RepoError('stale', 'Terms were changed elsewhere since you reviewed them. The latest changes are shown now; review them and publish again.');
        }
        if (!taxonomyChanges(terms, current).length && (current || !terms.length)) throw new RepoError('invalid-state', 'There are no unpublished taxonomy changes.');
        const next = newTaxonomyPublication(terms, { now: clock(), revision: (current?.revision || 0) + 1, origin: 'publish' });
        await request(tx.objectStore(STORES.taxonomyPublished).put(next));
        return next;
      });
      emit('taxonomy-published', TAXONOMY_PUBLICATION_ID);
      return publication;
    }
  };
}
