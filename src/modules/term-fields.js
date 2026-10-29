// Editor fields for managed taxonomy terms (tour type/category/standard and tags on tours and day trips).
// Only ACTIVE terms are offered for new selections, in display order. A saved selection that has since become
// inactive stays selected and is labelled; a value that is not a managed term (unresolved legacy value) or
// belongs to another group is shown explicitly instead of being silently replaced or dropped.
import { button, h, linkButton } from '../components/dom.js';
import { fieldIdFor } from '../components/fields.js';
import { TAXONOMY_NAMESPACES, TAXONOMY_PLURALS, namespaceTerms, termReference } from './shared/taxonomy.js';
import { shortId } from './shared/format.js';

const MANAGE_HREF = '#/taxonomies';

function stateNote(ref, group) {
  if (ref.state === 'inactive') return `“${ref.term.label}” is inactive: it stays on this record and is still displayed, but it is not offered for new selections.`;
  if (ref.state === 'unresolved') return `Unresolved value (ID ${shortId(ref.id)}) is not a managed ${group}. It is kept as saved until you clear or replace it; it blocks publishing.`;
  if (ref.state === 'wrong-namespace') return `“${ref.term.label}” is a ${TAXONOMY_NAMESPACES[ref.term.namespace].toLowerCase()}, not a ${group}. Choose a ${group} instead.`;
  return null;
}

function optionLabel(ref, group) {
  if (ref.state === 'inactive') return `${ref.term.label} (inactive — kept on this record)`;
  if (ref.state === 'unresolved') return `Unresolved value: ID ${shortId(ref.id)} (not a managed ${group})`;
  return `“${ref.term.label}” — wrong group (${TAXONOMY_NAMESPACES[ref.term.namespace].toLowerCase()})`;
}

export function termSelect(ed, key, namespace) {
  const group = TAXONOMY_NAMESPACES[namespace].toLowerCase();
  const active = namespaceTerms(ed.ctx.taxonomies.values(), namespace).filter(t => t.active !== false);
  const current = ed.model[key];
  const ref = current ? termReference(current, namespace, ed.ctx) : null;
  const options = [{ value: '', label: `— No ${group} —` }, ...active.map(t => ({ value: t.id, label: t.label }))];
  if (ref && ref.state !== 'active') options.push({ value: current, label: optionLabel(ref, group) });
  const field = ed.select(key, {
    label: TAXONOMY_NAMESPACES[namespace], options, emptyValue: null,
    hint: active.length ? `Active ${TAXONOMY_PLURALS[namespace].toLowerCase()} in display order.` : `No active ${TAXONOMY_PLURALS[namespace].toLowerCase()} yet — add them under Tour Packages › Taxonomies.`
  });
  const note = ref && stateNote(ref, group);
  if (note) field.insertBefore(h('p', { class: ref.state === 'inactive' ? 'msg-warning term-note' : 'msg-error term-note' }, note), field.querySelector('.field-error'));
  return field;
}

// sectionId: the editor section to re-render after removing unresolved values.
export function tagsField(ed, { sectionId, hint } = {}) {
  const id = fieldIdFor('tagIds');
  const selected = ed.model.tagIds;
  const active = namespaceTerms(ed.ctx.taxonomies.values(), 'tag').filter(t => t.active !== false);
  const refs = selected.map(tid => termReference(tid, 'tag', ed.ctx));
  const inactive = refs.filter(r => r.state === 'inactive');
  const problems = refs.filter(r => r.state === 'unresolved' || r.state === 'wrong-namespace');
  const box = (term, label) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: selected.includes(term.id), disabled: ed.readOnly, 'data-term': term.id, on: { change: e => {
      const i = selected.indexOf(term.id);
      if (e.target.checked && i === -1) selected.push(term.id);
      if (!e.target.checked && i !== -1) selected.splice(i, 1);
      ed.changed();
    } } }), h('span', null, label));
  return h('fieldset', { class: 'field field-wide', id },
    h('legend', { class: 'field-label' }, 'Tags'),
    hint ? h('p', { class: 'field-hint' }, hint) : null,
    active.length || inactive.length
      ? h('div', { class: 'check-grid' }, active.map(t => box(t, t.label)), inactive.map(r => box(r.term, `${r.term.label} (inactive — kept)`)))
      : h('p', { class: 'muted' }, 'No active tags yet. ', linkButton('Add tags under Taxonomies', MANAGE_HREF, { variant: 'ghost' })),
    inactive.length ? h('p', { class: 'msg-warning term-note' }, `${inactive.map(r => `“${r.term.label}”`).join(', ')} ${inactive.length === 1 ? 'is' : 'are'} inactive: kept on this record and still displayed, but not offered for new selections. Untick to remove.`) : null,
    problems.length ? h('div', { class: 'term-problems' },
      h('p', { class: 'msg-error' }, 'These saved tag values are not usable tags and block publishing:'),
      h('ul', { class: 'error-list' }, problems.map(r => h('li', null, stateNote(r, 'tag'), ' ',
        ed.readOnly ? null : button('Remove', { variant: 'ghost', 'aria-label': `Remove tag value ${r.term ? r.term.label : shortId(r.id)}`, onClick: () => {
          ed.model.tagIds = ed.model.tagIds.filter(t => t !== r.id);
          ed.changed();
          if (sectionId) ed.refreshSection(sectionId);
        } }))))) : null,
    h('p', { class: 'field-error', id: `${id}-error`, hidden: true }));
}

export const manageTaxonomiesLink = () => linkButton('Manage taxonomies', MANAGE_HREF, { variant: 'ghost', iconName: 'tag' });
