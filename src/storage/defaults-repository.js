// Day-trip defaults: one record holding default inclusions and default what-to-bring items. They are editor
// templates only (never published, never shown on the local site) and are copied into a day-trip draft
// only when someone chooses "Copy defaults into this draft". Saving defaults never changes any day trip.
// The approved default texts are not known, so nothing is seeded.
import { STORES, request, runTransaction } from './idb.js';
import { RepoError } from './content-repository.js';
import { DEFAULTS_ID, newDayTripDefaults } from '../modules/shared/day-trips.js';

const cleanList = list => {
  const out = [];
  for (const item of list || []) {
    const value = String(item ?? '').replace(/\s+/g, ' ').trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
};

export function createDefaultsRepository({ db, validator, events, clock = () => new Date().toISOString(), faults = null }) {
  return {
    async getDayTripDefaults() {
      return runTransaction(db, [STORES.defaults], 'readonly', async tx => (await request(tx.objectStore(STORES.defaults).get(DEFAULTS_ID))) || null);
    },

    // Creates (expectedVersion null) or replaces the defaults. Lists are trimmed and exact duplicates dropped.
    async saveDayTripDefaults({ inclusions, whatToBring }, { expectedVersion = null } = {}) {
      const saved = await runTransaction(db, [STORES.defaults], 'readwrite', async tx => {
        const store = tx.objectStore(STORES.defaults);
        const current = (await request(store.get(DEFAULTS_ID))) || null;
        if (expectedVersion == null && current) throw new RepoError('conflict', 'Day-trip defaults already exist (they were saved in another tab). Reload to edit the stored defaults.');
        if (expectedVersion != null && current?.version !== expectedVersion) {
          throw new RepoError('stale', `The day-trip defaults were changed elsewhere (you loaded version ${expectedVersion}; the stored version is ${current?.version ?? 'none'}). Your change was not saved. Reload to continue.`, { currentVersion: current?.version ?? null });
        }
        const now = clock();
        const base = current || newDayTripDefaults({ now });
        const next = { ...base, inclusions: cleanList(inclusions), whatToBring: cleanList(whatToBring), updatedAt: now, version: current ? current.version + 1 : 1 };
        const errors = validator?.validate(next, '#/$defs/dayTripDefaults') || [];
        if (errors.length) throw new RepoError('validation', 'The defaults have invalid values.', { issues: errors.map(e => ({ path: e.path, message: `${e.path} ${e.message}.`, severity: 'error' })) });
        await request(store.put(next));
        faults?.check('saveDayTripDefaults');
        return next;
      });
      events?.emit({ type: 'defaults-saved', id: DEFAULTS_ID, kind: 'dayTripDefaults' });
      return saved;
    }
  };
}
