// Repository for the site settings singleton, team profiles and the team lineup (display order + visibility).
// Same conventions as the content repository: envelopes holding a working draft and workflow, immutable
// published snapshots, stale-version checks, validation inside the write transaction, and success reported
// only after the transaction's `complete` event.
//
// Publication boundaries:
// - saveSettings/saveMember never touch a published snapshot.
// - publishMember publishes one profile's content only; it never publishes the lineup.
// - moveMember/setMemberVisibility change the DRAFT lineup only; publishLineup publishes order and
//   visibility only and never any profile content.
import { STORES, request, runTransaction } from './idb.js';
import { CONTEXT_STORES, RepoError, readContext } from './content-repository.js';
import { LINEUP_ID, SETTINGS_ID, moveEntry, newLineup, newSiteWorkflow, placeEntry, removeEntry } from '../modules/shared/site.js';
import { errorsOnly } from '../modules/shared/validation.js';
import { validateLineup, validateMemberDraft, validateMemberPublish, validateSettingsDraft, validateSettingsPublish } from '../modules/shared/site-validation.js';

const WHAT = { siteSettings: 'The site settings were', teamMember: 'This profile was', teamLineup: 'The team order was' };

export function createSiteRepository({ db, validator, siteValidator, events, clock = () => new Date().toISOString(), faults = null }) {
  const write = (op, work) => runTransaction(db, CONTEXT_STORES, 'readwrite', async tx => {
    const ctx = await readContext(tx, validator, siteValidator);
    const result = await work(tx, ctx);
    faults?.check(op);
    return result;
  });
  const read = (store, id) => runTransaction(db, [store], 'readonly', async tx => (await request(tx.objectStore(store).get(id))) || null);
  const putEnv = (tx, env) => request(tx.objectStore(STORES.siteRecords).put(env));
  const emit = (type, env) => events?.emit({ type, id: env.id, kind: env.kind });
  const bump = (record, changes) => ({ ...record, ...changes, version: record.version + 1, updatedAt: clock() });

  function requireEnv(ctx, id, kind, expectedVersion) {
    const env = ctx.siteRecords.get(id);
    if (!env || env.kind !== kind) throw new RepoError('not-found', kind === 'teamMember' ? 'This profile no longer exists in local storage.' : 'This record no longer exists in local storage. Reload the page.');
    if (expectedVersion != null && env.record.version !== expectedVersion) {
      throw new RepoError('stale', `${WHAT[kind]} changed elsewhere (you loaded version ${expectedVersion}; the stored version is ${env.record.version}). Your change was not saved. Reload to continue.`, { currentVersion: env.record.version });
    }
    return env;
  }

  function invalid(issues, message) {
    const errors = errorsOnly(issues);
    if (errors.length) throw new RepoError('validation', message, { issues: errors });
  }

  // Shared draft write for settings and profiles: create (expectedVersion null) or update a working draft.
  function nextDraft(ctx, record, expectedVersion, kind) {
    const existing = ctx.siteRecords.get(record.id);
    if (expectedVersion == null && existing) {
      throw new RepoError('conflict', kind === 'siteSettings'
        ? 'Site settings already exist; there is only ever one settings record. Reload to edit the stored settings.'
        : 'A profile with this ID already exists. Reload before saving.');
    }
    if (expectedVersion != null) requireEnv(ctx, record.id, kind, expectedVersion);
    if (existing?.record.status === 'archived') throw new RepoError('invalid-state', 'Archived profiles are read-only. Restore the profile to draft before editing.');
    const now = clock();
    const next = existing
      ? { ...record, status: existing.record.status, createdAt: existing.record.createdAt, updatedAt: now, version: existing.record.version + 1, schemaVersion: 1 }
      : { ...record, status: 'draft', createdAt: now, updatedAt: now, version: 1, schemaVersion: 1 };
    return { existing, next, envelope: existing ? { ...existing, record: next } : { id: next.id, kind, record: next, workflow: newSiteWorkflow() } };
  }

  // Stores an immutable snapshot of the saved draft and marks the envelope published.
  async function publishEnv(tx, current) {
    const now = clock();
    const record = bump(current.record, { status: 'published' });
    const workflow = { ...current.workflow, priorStatus: null, publishedRevision: current.workflow.publishedRevision + 1, lastPublishedAt: now, publishedSourceVersion: record.version };
    const next = { ...current, record, workflow };
    await putEnv(tx, next);
    await request(tx.objectStore(STORES.sitePublished).put({ id: current.id, kind: current.kind, revision: workflow.publishedRevision, publishedAt: now, sourceVersion: record.version, snapshot: structuredClone(record) }));
    return next;
  }

  async function unpublishEnv(tx, current) {
    const next = { ...current, record: bump(current.record, { status: 'draft' }), workflow: { ...current.workflow, publishedSourceVersion: null } };
    await request(tx.objectStore(STORES.sitePublished).delete(current.id));
    await putEnv(tx, next);
    return next;
  }

  const lineupEnv = (ctx, now) => ctx.siteRecords.get(LINEUP_ID) || { id: LINEUP_ID, kind: 'teamLineup', record: newLineup({ now }), workflow: newSiteWorkflow(), isNew: true };
  async function writeLineup(tx, env, entries) {
    const { isNew, ...stored } = env;
    const next = { ...stored, record: isNew ? { ...stored.record, entries } : bump(stored.record, { entries }) };
    await putEnv(tx, next);
    return next;
  }

  async function lineupWrite(op, expectedVersion, change) {
    const env = await write(op, async (tx, ctx) => {
      const current = requireEnv(ctx, LINEUP_ID, 'teamLineup', expectedVersion);
      const entries = change(current.record.entries, ctx);
      return writeLineup(tx, current, entries);
    });
    emit('lineup-saved', env);
    return env;
  }

  return {
    // ---- settings singleton ----
    getSettings: () => read(STORES.siteRecords, SETTINGS_ID),
    getPublishedSettings: () => read(STORES.sitePublished, SETTINGS_ID),

    async saveSettings(record, { expectedVersion = null } = {}) {
      if (record?.id !== SETTINGS_ID || record.kind !== 'siteSettings') throw new RepoError('validation', 'Site settings must use the single fixed settings record.');
      const env = await write('saveSettings', async (tx, ctx) => {
        const { envelope, next } = nextDraft(ctx, record, expectedVersion, 'siteSettings');
        invalid(validateSettingsDraft(next, ctx), 'The settings have invalid values. Fix the highlighted fields and save again.');
        await putEnv(tx, envelope);
        return envelope;
      });
      emit('saved', env);
      return env;
    },

    async publishSettings({ expectedVersion } = {}) {
      const env = await write('publishSettings', async (tx, ctx) => {
        const current = requireEnv(ctx, SETTINGS_ID, 'siteSettings', expectedVersion);
        invalid(validateSettingsPublish(current.record, ctx), 'The settings are not ready to publish. Fix the listed problems first.');
        return publishEnv(tx, current);
      });
      emit('published', env);
      return env;
    },

    async unpublishSettings({ expectedVersion } = {}) {
      const env = await write('unpublishSettings', async (tx, ctx) => {
        const current = requireEnv(ctx, SETTINGS_ID, 'siteSettings', expectedVersion);
        if (!ctx.sitePublished.has(SETTINGS_ID)) throw new RepoError('invalid-state', 'The settings are not published.');
        return unpublishEnv(tx, current);
      });
      emit('unpublished', env);
      return env;
    },

    // ---- team profiles ----
    async listMembers() {
      return runTransaction(db, [STORES.siteRecords], 'readonly', tx => request(tx.objectStore(STORES.siteRecords).index('kind').getAll('teamMember')));
    },
    getMember: id => read(STORES.siteRecords, id),
    getPublishedMember: id => read(STORES.sitePublished, id),
    getLineup: () => read(STORES.siteRecords, LINEUP_ID),
    getPublishedLineup: () => read(STORES.sitePublished, LINEUP_ID),

    // New profiles are always added to the draft lineup (at `placement.position`, default last). For an
    // existing profile, `placement` is passed only when the editor changed it; it is then applied to the
    // draft lineup in the same transaction, guarded by the lineup version the editor loaded.
    async saveMember(record, { expectedVersion = null, placement = null, expectedLineupVersion = null } = {}) {
      if (record?.kind !== 'teamMember') throw new RepoError('validation', 'Only team profiles can be saved here.');
      const env = await write('saveMember', async (tx, ctx) => {
        const { existing, next, envelope } = nextDraft(ctx, record, expectedVersion, 'teamMember');
        invalid(validateMemberDraft(next, ctx), 'The profile has invalid values. Fix the highlighted fields and save again.');
        if (!existing || placement) {
          const lineup = lineupEnv(ctx, next.updatedAt);
          if (existing && !lineup.isNew && expectedLineupVersion != null && lineup.record.version !== expectedLineupVersion) {
            throw new RepoError('stale', 'The team order or visibility was changed elsewhere since you opened this profile. Your change was not saved. Reload to continue.', { currentVersion: lineup.record.version });
          }
          await writeLineup(tx, lineup, placeEntry(lineup.record.entries, next.id, { position: placement?.position ?? null, visible: placement?.visible ?? true }));
        }
        await putEnv(tx, envelope);
        return envelope;
      });
      emit('saved', env);
      return env;
    },

    async publishMember(id, { expectedVersion } = {}) {
      const env = await write('publishMember', async (tx, ctx) => {
        const current = requireEnv(ctx, id, 'teamMember', expectedVersion);
        if (current.record.status === 'archived') throw new RepoError('invalid-state', 'Archived profiles cannot be published. Restore the profile to draft first.');
        invalid(validateMemberPublish(current.record, ctx), 'This profile is not ready to publish. Fix the listed problems first.');
        return publishEnv(tx, current);
      });
      emit('published', env);
      return env;
    },

    async unpublishMember(id, { expectedVersion } = {}) {
      const env = await write('unpublishMember', async (tx, ctx) => {
        const current = requireEnv(ctx, id, 'teamMember', expectedVersion);
        if (!ctx.sitePublished.has(id)) throw new RepoError('invalid-state', 'This profile is not published.');
        return unpublishEnv(tx, current);
      });
      emit('unpublished', env);
      return env;
    },

    // Archive keeps the profile, removes its published snapshot and takes it out of the draft lineup
    // (remembering its visibility). The published lineup is not changed; the profile simply has no snapshot.
    async archiveMember(id, { expectedVersion } = {}) {
      const env = await write('archiveMember', async (tx, ctx) => {
        const current = requireEnv(ctx, id, 'teamMember', expectedVersion);
        if (current.record.status === 'archived') throw new RepoError('invalid-state', 'This profile is already archived.');
        const lineup = ctx.siteRecords.get(LINEUP_ID);
        const entry = lineup?.record.entries.find(e => e.memberId === id);
        if (entry) await writeLineup(tx, lineup, removeEntry(lineup.record.entries, id));
        const next = {
          ...current, record: bump(current.record, { status: 'archived' }),
          workflow: { ...current.workflow, priorStatus: current.record.status, publishedSourceVersion: null, archivedAt: clock(), priorVisible: entry ? entry.visible : null }
        };
        await request(tx.objectStore(STORES.sitePublished).delete(id));
        await putEnv(tx, next);
        return next;
      });
      emit('archived', env);
      return env;
    },

    // Restore returns to draft (republishing is explicit) and puts the profile back at the end of the draft
    // lineup with the visibility it had before archiving.
    async restoreMember(id, { expectedVersion } = {}) {
      const env = await write('restoreMember', async (tx, ctx) => {
        const current = requireEnv(ctx, id, 'teamMember', expectedVersion);
        if (current.record.status !== 'archived') throw new RepoError('invalid-state', 'Only archived profiles can be restored.');
        const lineup = lineupEnv(ctx, clock());
        await writeLineup(tx, lineup, placeEntry(removeEntry(lineup.record.entries, id), id, { visible: current.workflow.priorVisible ?? true }));
        const next = { ...current, record: bump(current.record, { status: 'draft' }), workflow: { ...current.workflow, archivedAt: null, priorVisible: null } };
        await putEnv(tx, next);
        return next;
      });
      emit('restored', env);
      return env;
    },

    // ---- team lineup (draft order + visibility, then explicit publication) ----
    moveMember(id, delta, { expectedVersion } = {}) {
      return lineupWrite('moveMember', expectedVersion, entries => {
        const moved = moveEntry(entries, id, delta);
        if (!moved) throw new RepoError('invalid-state', 'This profile cannot move further in that direction.');
        return moved;
      });
    },

    setMemberVisibility(id, visible, { expectedVersion } = {}) {
      return lineupWrite('setMemberVisibility', expectedVersion, entries => {
        if (!entries.some(e => e.memberId === id)) throw new RepoError('not-found', 'This profile is not in the team order (it may be archived).');
        return entries.map(e => (e.memberId === id ? { ...e, visible: !!visible } : e));
      });
    },

    async publishLineup({ expectedVersion } = {}) {
      const env = await write('publishLineup', async (tx, ctx) => {
        const current = requireEnv(ctx, LINEUP_ID, 'teamLineup', expectedVersion);
        invalid(validateLineup(current.record, ctx), 'The team order cannot be published. Fix the listed problems first.');
        return publishEnv(tx, current);
      });
      emit('lineup-published', env);
      return env;
    }
  };
}
