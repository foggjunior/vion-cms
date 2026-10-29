// Tour taxonomy terms (types, categories, standards and tags): normalisation, uniqueness, ordering,
// activation and the published taxonomy snapshot. Taxonomy definitions (B4) are unresolved: no values are
// seeded and no labels claim to match the existing CMS.
//
// Publication policy (proposed): term edits (label, order, activation, new terms) change the working terms
// only. "Publish taxonomy changes" stores ONE snapshot of every term; the local preview site resolves labels,
// order and activation from that snapshot. Publishing the taxonomy never publishes content records, and
// saving or publishing content never publishes the taxonomy.
import { slugify } from './routes.js';

export const TAXONOMY_NAMESPACES = Object.freeze({ type: 'Tour type', category: 'Tour category', standard: 'Tour standard', tag: 'Tour tag' });
export const TAXONOMY_PLURALS = Object.freeze({ type: 'Tour types', category: 'Tour categories', standard: 'Tour standards', tag: 'Tour tags' });
// Neutral descriptions only: what each group is used for in this prototype, never what its values mean.
export const NAMESPACE_NOTES = Object.freeze({
  type: 'Used by the tour editor’s “Tour type” field. Which types exist and what each one means await owner confirmation (B4); nothing is pre-filled.',
  category: 'Used by the tour editor’s “Tour category” field. The category list and its definitions await owner confirmation (B4); nothing is pre-filled.',
  standard: 'Used by the tour editor’s “Tour standard” field. Which standards exist and how they are defined await owner confirmation (B4); nothing is pre-filled.',
  tag: 'Used by tours and day trips, and by the day-trip tag filter. The tag list awaits owner confirmation (B4); nothing is pre-filled.'
});
export const NAMESPACE_ORDER = Object.freeze(Object.keys(TAXONOMY_NAMESPACES));
export const TAXONOMY_PUBLICATION_ID = 'tour-taxonomy';
export const TERM_LABEL_MAX = 80;
export const TERM_KEY_MAX = 64;
export const TERM_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PUBLISHED_TERM_FIELDS = Object.freeze(['id', 'namespace', 'label', 'key', 'order', 'active']);

// Documented normalisation. Labels: Unicode NFC, whitespace collapsed and trimmed; two labels are the same
// when they are equal ignoring case. Keys: trimmed, then lowercase letters, digits and single hyphens only;
// keys are compared exactly. Uniqueness applies within one namespace; other namespaces may reuse both.
export const normalizeTermLabel = value => String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
export const labelIdentity = value => normalizeTermLabel(value).toLowerCase();
export const normalizeTermKey = value => String(value ?? '').trim();

export function suggestTermKey(label) {
  const slug = slugify(label);
  return slug.length <= TERM_KEY_MAX ? slug : slug.slice(0, TERM_KEY_MAX).replace(/-+$/, '');
}

export function termKeyMessage(key) {
  if (!key) return 'Enter a key (lowercase letters, numbers and hyphens).';
  if (key.length > TERM_KEY_MAX) return `Keep the key to ${TERM_KEY_MAX} characters or fewer.`;
  if (!TERM_KEY_PATTERN.test(key)) {
    const suggestion = suggestTermKey(key);
    return `Use lowercase letters, numbers and single hyphens only${suggestion ? ` — for example “${suggestion}”` : ''}.`;
  }
  return null;
}

export const isPublishedTerm = (id, publication) => !!publication?.terms?.some(t => t.id === id);

// Field problems for one term compared with the other stored terms. The same rules guard repository writes
// and backup imports. Issues: [{ path: 'label' | 'key' | 'namespace' | 'order', message, code }].
export function termIssues(term, terms) {
  const issues = [];
  const add = (path, message, code = 'validation') => issues.push({ path, message, code, severity: 'error' });
  if (!(term.namespace in TAXONOMY_NAMESPACES)) { add('namespace', `Unknown taxonomy group “${term.namespace}”.`); return issues; }
  const noun = TAXONOMY_NAMESPACES[term.namespace].toLowerCase();
  const label = normalizeTermLabel(term.label);
  if (!label) add('label', 'Enter a label. Blank labels are not allowed.');
  else if (label.length > TERM_LABEL_MAX) add('label', `Keep labels to ${TERM_LABEL_MAX} characters or fewer.`);
  const keyMessage = termKeyMessage(term.key);
  if (keyMessage) add('key', keyMessage);
  if (!Number.isInteger(term.order) || term.order < 0) add('order', 'Display order must be a whole number of 0 or more.');
  if (typeof term.active !== 'boolean') add('active', 'Active must be true or false.');
  const others = terms.filter(t => t.id !== term.id && t.namespace === term.namespace);
  const sameLabel = label && others.find(t => labelIdentity(t.label) === labelIdentity(label));
  if (sameLabel) add('label', `“${sameLabel.label}” already exists as a ${noun}${sameLabel.active === false ? ' (inactive — activate it instead)' : ''}. Labels must be unique within a group, ignoring case and extra spaces.`, 'conflict');
  const sameKey = !keyMessage && others.find(t => t.key === term.key);
  if (sameKey) add('key', `The key “${term.key}” is already used by the ${noun} “${sameKey.label}”. Keys must be unique within a group.`, 'conflict');
  return issues;
}

const compareLabels = (a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id);
export const compareTerms = (a, b) => NAMESPACE_ORDER.indexOf(a.namespace) - NAMESPACE_ORDER.indexOf(b.namespace) || (a.order ?? 0) - (b.order ?? 0) || compareLabels(a, b);
export const sortTerms = terms => [...terms].sort(compareTerms);
export const namespaceTerms = (terms, namespace) => sortTerms([...terms].filter(t => t.namespace === namespace));
export const nextOrder = (terms, namespace) => Math.max(0, ...[...terms].filter(t => t.namespace === namespace && Number.isInteger(t.order)).map(t => t.order)) + 1;

// Terms stored before database version 3 have no key, order or active flag. This adds them once and keeps
// id, namespace, label, timestamps and version unchanged: key from the label (made unique within the
// namespace with -2, -3…), order following the old alphabetical display, active true.
export const isLegacyTerm = term => !('key' in term) || !('order' in term) || !('active' in term);
export function upgradeLegacyTerms(terms) {
  const out = terms.map(t => ({ ...t }));
  for (const namespace of NAMESPACE_ORDER) {
    const group = out.filter(t => t.namespace === namespace);
    const legacy = group.filter(isLegacyTerm).sort(compareLabels);
    if (!legacy.length) continue;
    const used = new Set(group.filter(t => !isLegacyTerm(t)).map(t => t.key));
    let order = Math.max(0, ...group.filter(t => Number.isInteger(t.order)).map(t => t.order));
    for (const term of legacy) {
      if (!('key' in term)) {
        const base = (suggestTermKey(term.label) || `${namespace}-term`).slice(0, TERM_KEY_MAX - 4).replace(/-+$/, '');
        let key = base;
        for (let n = 2; used.has(key); n += 1) key = `${base}-${n}`;
        term.key = key;
      }
      used.add(term.key);
      if (!('order' in term)) term.order = (order += 1);
      if (!('active' in term)) term.active = true;
    }
  }
  return out;
}

export const publishedTermOf = term => Object.fromEntries(PUBLISHED_TERM_FIELDS.map(key => [key, term[key]]));

// origin: 'publish' (explicit action), 'upgrade' (database version 3 kept the labels the local site already
// showed) or 'import' (an older backup's terms, which the local site showed directly).
export function newTaxonomyPublication(terms, { now, revision = 1, origin = 'publish' }) {
  return { id: TAXONOMY_PUBLICATION_ID, revision, publishedAt: now, origin, terms: sortTerms(terms).map(publishedTermOf) };
}

// Working-term changes that are not in the published snapshot yet, in display order.
export function taxonomyChanges(terms, publication) {
  const published = new Map((publication?.terms || []).map(t => [t.id, t]));
  const changes = [];
  for (const term of sortTerms(terms)) {
    const group = TAXONOMY_NAMESPACES[term.namespace];
    const pub = published.get(term.id);
    if (!pub) { changes.push({ id: term.id, namespace: term.namespace, kind: 'new', text: `New ${group.toLowerCase()} “${term.label}”${term.active ? '' : ' (inactive)'}` }); continue; }
    if (pub.label !== term.label) changes.push({ id: term.id, namespace: term.namespace, kind: 'label', text: `${group} “${pub.label}” renamed to “${term.label}”` });
    if (pub.key !== term.key) changes.push({ id: term.id, namespace: term.namespace, kind: 'key', text: `${group} “${term.label}” key ${pub.key} → ${term.key}` });
    if (pub.active !== term.active) changes.push({ id: term.id, namespace: term.namespace, kind: 'active', text: `${group} “${term.label}” ${term.active ? 'activated' : 'deactivated'}` });
    if (pub.order !== term.order) changes.push({ id: term.id, namespace: term.namespace, kind: 'order', text: `${group} “${term.label}” moved (display order ${pub.order} → ${term.order})` });
  }
  return changes;
}

// The versions a person reviewed before publishing; a mismatch means terms changed meanwhile.
export const termsFingerprint = terms => [...terms].map(t => `${t.id}:${t.version}`).sort().join(',');

// State of a term reference held in a field of `namespace`, against the working terms.
export function termReference(id, namespace, ctx) {
  const term = ctx.taxonomies.get(id);
  if (!term) return { state: 'unresolved', id, term: null };
  if (term.namespace !== namespace) return { state: 'wrong-namespace', id, term };
  return { state: term.active === false ? 'inactive' : 'active', id, term };
}
