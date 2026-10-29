// Content repository for destinations, accommodations and tours. UI code talks to this interface only.
// Every mutation re-validates inside its own readwrite transaction, so rules hold even if the UI is bypassed.
import { STORES, request, runTransaction } from './idb.js';
import { KIND_LABELS, dependentsOf, duplicateRecord, makeContext, newWorkflow } from '../modules/shared/records.js';
import { planRedirects, routeFor, uniqueSlug } from '../modules/shared/routes.js';
import { errorsOnly, validateDraft, validatePublish } from '../modules/shared/validation.js';

export class RepoError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RepoError';
    this.code = code;
    Object.assign(this, details);
  }
}

const CONTENT_STORES = [STORES.records, STORES.published, STORES.redirects, STORES.assets, STORES.assetBlobs, STORES.taxonomies];

export async function readContext(tx, validator) {
  const store = name => tx.objectStore(name);
  const [records, published, redirects, assets, blobKeys, taxonomies] = await Promise.all([
    request(store(STORES.records).getAll()), request(store(STORES.published).getAll()), request(store(STORES.redirects).getAll()),
    request(store(STORES.assets).getAll()), request(store(STORES.assetBlobs).getAllKeys()), request(store(STORES.taxonomies).getAll())
  ]);
  return makeContext({ records, published, redirects, assets, blobKeys, taxonomies, validator });
}

export function createContentRepository({ db, validator, events, clock = () => new Date().toISOString(), newId = () => crypto.randomUUID(), faults = null }) {
  const write = (op, work) => runTransaction(db, CONTENT_STORES, 'readwrite', async tx => {
    const ctx = await readContext(tx, validator);
    const result = await work(tx, ctx);
    faults?.check(op);
    return result;
  });

  function requireRecord(ctx, id, expectedVersion) {
    const env = ctx.records.get(id);
    if (!env) throw new RepoError('not-found', 'This record no longer exists in local storage.');
    if (expectedVersion != null && env.record.version !== expectedVersion) {
      throw new RepoError('stale', `This record was changed elsewhere (you loaded version ${expectedVersion}; the stored version is ${env.record.version}). Your change was not saved. Reload the record to continue.`, { currentVersion: env.record.version });
    }
    return env;
  }

  function blockIfPublishedDependents(ctx, env, action) {
    const { published } = dependentsOf(env.id, ctx);
    if (published.length) {
      const names = published.map(d => `${KIND_LABELS[d.kind]} “${d.title}”`).join(', ');
      throw new RepoError('dependency', `Cannot ${action} “${env.record.title}”: it is used by published ${names}. Unpublish ${published.length === 1 ? 'that record' : 'those records'} first.`, { dependents: published });
    }
  }

  const bump = (record, changes) => ({ ...record, ...changes, version: record.version + 1, updatedAt: clock() });
  const emit = (type, env) => events?.emit({ type, id: env.id, kind: env.kind });

  return {
    async list(kind) {
      return runTransaction(db, [STORES.records], 'readonly', tx => request(kind ? tx.objectStore(STORES.records).index('kind').getAll(kind) : tx.objectStore(STORES.records).getAll()));
    },
    async get(id) {
      return runTransaction(db, [STORES.records], 'readonly', async tx => (await request(tx.objectStore(STORES.records).get(id))) || null);
    },
    async getPublished(id) {
      return runTransaction(db, [STORES.published], 'readonly', async tx => (await request(tx.objectStore(STORES.published).get(id))) || null);
    },
    async listRedirects() {
      return runTransaction(db, [STORES.redirects], 'readonly', tx => request(tx.objectStore(STORES.redirects).getAll()));
    },
    async loadContext() {
      return runTransaction(db, CONTENT_STORES, 'readonly', tx => readContext(tx, validator));
    },

    // Creates (expectedVersion null) or updates a working draft. Never touches the published snapshot.
    async saveDraft(record, { expectedVersion = null, conversionIssues = [] } = {}) {
      const env = await write('saveDraft', async (tx, ctx) => {
        const existing = ctx.records.get(record.id);
        if (expectedVersion == null && existing) throw new RepoError('conflict', 'A record with this ID already exists. Reload before saving.');
        if (expectedVersion != null) requireRecord(ctx, record.id, expectedVersion);
        if (existing && existing.kind !== record.kind) throw new RepoError('conflict', 'The record type cannot be changed.');
        if (existing?.record.status === 'archived') throw new RepoError('invalid-state', 'Archived records are read-only. Restore the record to draft before editing.');
        const now = clock();
        const next = existing
          ? { ...record, status: existing.record.status, createdAt: existing.record.createdAt, updatedAt: now, version: existing.record.version + 1, schemaVersion: 1 }
          : { ...record, status: 'draft', createdAt: now, updatedAt: now, version: 1, schemaVersion: 1 };
        const errors = errorsOnly(validateDraft(next, ctx, { conversionIssues }));
        if (errors.length) throw new RepoError('validation', 'The draft has invalid values. Fix the highlighted fields and save again.', { issues: errors });
        const envelope = existing ? { ...existing, record: next } : { id: next.id, kind: next.kind, record: next, workflow: newWorkflow() };
        await request(tx.objectStore(STORES.records).put(envelope));
        return envelope;
      });
      emit('saved', env);
      return env;
    },

    // Publishes the saved working draft as an immutable snapshot. Unsaved form changes are never published.
    async publish(id, { expectedVersion } = {}) {
      const env = await write('publish', async (tx, ctx) => {
        const current = requireRecord(ctx, id, expectedVersion);
        if (current.record.status === 'archived') throw new RepoError('invalid-state', 'Archived records cannot be published. Restore the record to draft first.');
        const errors = errorsOnly(validatePublish(current.record, ctx));
        if (errors.length) throw new RepoError('validation', 'This record is not ready to publish. Fix the listed problems first.', { issues: errors });
        const now = clock();
        const route = routeFor(current.kind, current.record.slug);
        const plan = planRedirects({ recordId: id, kind: current.kind, prevRoute: current.workflow.lastPublishedRoute, nextRoute: route, redirects: ctx.redirects, now, newId });
        const redirectStore = tx.objectStore(STORES.redirects);
        for (const rid of plan.remove) await request(redirectStore.delete(rid));
        for (const r of plan.update.concat(plan.add)) await request(redirectStore.put(r));
        const record = bump(current.record, { status: 'published' });
        const history = current.workflow.routeHistory.some(h => h.route === route) ? current.workflow.routeHistory : current.workflow.routeHistory.concat({ route, firstPublishedAt: now });
        const workflow = { ...current.workflow, priorStatus: null, lastPublishedRoute: route, routeHistory: history, publishedRevision: current.workflow.publishedRevision + 1, lastPublishedAt: now, publishedSourceVersion: record.version };
        const next = { ...current, record, workflow };
        await request(tx.objectStore(STORES.records).put(next));
        await request(tx.objectStore(STORES.published).put({ id, kind: current.kind, revision: workflow.publishedRevision, publishedAt: now, sourceVersion: record.version, route, snapshot: structuredClone(record) }));
        return { ...next, redirectPlan: plan };
      });
      emit('published', env);
      return env;
    },

    async unpublish(id, { expectedVersion } = {}) {
      const env = await write('unpublish', async (tx, ctx) => {
        const current = requireRecord(ctx, id, expectedVersion);
        if (!ctx.published.has(id)) throw new RepoError('invalid-state', 'This record is not published.');
        blockIfPublishedDependents(ctx, current, 'unpublish');
        const next = { ...current, record: bump(current.record, { status: 'draft' }), workflow: { ...current.workflow, publishedSourceVersion: null } };
        await request(tx.objectStore(STORES.published).delete(id));
        await request(tx.objectStore(STORES.records).put(next));
        return next;
      });
      emit('unpublished', env);
      return env;
    },

    // Archive keeps the record and its route history, removes preview visibility and remembers the prior status.
    async archive(id, { expectedVersion } = {}) {
      const env = await write('archive', async (tx, ctx) => {
        const current = requireRecord(ctx, id, expectedVersion);
        if (current.record.status === 'archived') throw new RepoError('invalid-state', 'This record is already archived.');
        if (ctx.published.has(id)) blockIfPublishedDependents(ctx, current, 'archive');
        const next = {
          ...current,
          record: bump(current.record, { status: 'archived' }),
          workflow: { ...current.workflow, priorStatus: current.record.status, publishedSourceVersion: null, archivedAt: clock() }
        };
        await request(tx.objectStore(STORES.published).delete(id));
        await request(tx.objectStore(STORES.records).put(next));
        return next;
      });
      emit('archived', env);
      return env;
    },

    // Restore always returns to draft; republishing is an explicit separate step.
    async restore(id, { expectedVersion } = {}) {
      const env = await write('restore', async (tx, ctx) => {
        const current = requireRecord(ctx, id, expectedVersion);
        if (current.record.status !== 'archived') throw new RepoError('invalid-state', 'Only archived records can be restored.');
        const next = { ...current, record: bump(current.record, { status: 'draft' }), workflow: { ...current.workflow, archivedAt: null } };
        await request(tx.objectStore(STORES.records).put(next));
        return next;
      });
      emit('restored', env);
      return env;
    },

    async duplicate(id) {
      const env = await write('duplicate', async (tx, ctx) => {
        const source = requireRecord(ctx, id);
        const newRecordId = newId();
        const title = `${source.record.title} (copy)`;
        const slug = uniqueSlug(source.record.slug ? `${source.record.slug}-copy` : title, source.kind, newRecordId, ctx);
        const record = duplicateRecord(source.record, { id: newRecordId, now: clock(), slug, title });
        const errors = errorsOnly(validateDraft(record, ctx));
        if (errors.length) throw new RepoError('validation', 'The copy could not be created because the original has invalid values. Open and fix the original first.', { issues: errors });
        const next = { id: record.id, kind: record.kind, record, workflow: newWorkflow() };
        await request(tx.objectStore(STORES.records).put(next));
        return next;
      });
      emit('duplicated', env);
      return env;
    },

    async dependents(id) {
      const ctx = await this.loadContext();
      return dependentsOf(id, ctx);
    }
  };
}

