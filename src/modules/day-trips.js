// Day trips (sidebar: Tour Packages › Activities / day trips and Add Activity; screen headings say Day Trips).
// Proposed replacement fields, not confirmed rules of the existing CMS. Day trips deliberately have no
// accommodation, tour type, category or standard fields. Public pattern: /tours/day-trips/{slug}.
import { button, h, icon, linkButton } from '../components/dom.js';
import { confirmDialog, openDialog } from '../components/dialog.js';
import { notice } from '../components/feedback.js';
import { fieldIdFor } from '../components/fields.js';
import { createRepeater } from '../components/repeater.js';
import { DURATION_LIMITS, compareDayTrips, copyDefaults, formatDuration, newScheduleItem } from './shared/day-trips.js';
import { describePrice } from './shared/pricing.js';
import { manageTaxonomiesLink, tagsField } from './term-fields.js';
import { pricingSection } from './pricing-section.js';

function basics(ed) {
  return [
    ed.group(null,
      ed.text('title', { label: 'Title', required: true, onInput: () => ed.updateSlugFromTitle?.() }),
      ed.text('summary', { label: 'Summary (optional)', multiline: true, rows: 3, hint: 'Short teaser for cards and the listing. When empty, the start of the overview is used.' }),
      ed.text('duration.value', { label: 'Duration (optional)', inputmode: 'decimal', placeholder: 'e.g. 6 or 1.5', hint: `A number above 0 with up to two decimals, at most ${DURATION_LIMITS.hours} hours or ${DURATION_LIMITS.days} days. Leave empty if not known. The schedule does not have to match it.` }),
      ed.select('duration.unit', { label: 'Duration unit', options: [{ value: 'hours', label: 'Hours' }, { value: 'days', label: 'Days' }] }),
      ed.checkbox('featured', { label: 'Featured day trip', hint: 'Featured day trips are listed first on the local day-trip listing.' }),
      ed.text('displayOrder', { label: 'Display order (optional)', inputmode: 'numeric', placeholder: 'e.g. 10', hint: 'Whole number, 0 or more. Lower numbers are listed first (after featured trips); 0 is a real value and empty sorts last.' })),
    ed.group('Page address', ed.slugField(),
      notice('info', 'Day trips use /tours/day-trips/{slug}, so a day-trip slug never collides with a tour slug. /tours/day-trips itself is the listing page.'))
  ];
}

function classification(ed) {
  return [
    ed.group('Destinations',
      ed.relations('destinationIds', { legend: 'Day-trip destinations', kind: 'destination', noun: 'destination', hint: 'One or more destinations. At least one published destination is required to publish; drafts and archived destinations can be linked while drafting but block publishing.' })),
    h('div', { class: 'form-group' },
      h('h3', { class: 'group-title' }, 'Tags (optional)'),
      notice('info', 'Tags are the managed tour tags, shared with tours. The tag list awaits owner confirmation (B4). Only active tags can be newly chosen, and publishing needs them in the published taxonomy. The local day-trip listing can be filtered by tag.', ' ', manageTaxonomiesLink()),
      h('div', { class: 'form-grid' }, tagsField(ed, { sectionId: 'classification' })))
  ];
}

function content(ed) {
  const repeater = createRepeater({
    items: ed.model.schedule, readOnly: ed.readOnly, className: 'schedule-list',
    itemLabel: (item, i) => `Schedule item ${i + 1}`,
    emptyText: 'No schedule items. A schedule is optional.',
    onChange: () => ed.changed(),
    confirmRemove: (item, i) => (item.heading || item.description ? confirmDialog({ title: `Remove schedule item ${i + 1}?`, body: `“${item.heading || 'Untitled item'}” will be removed from this draft.`, confirmLabel: 'Remove item', danger: true }) : true),
    renderItem: (item, i) => h('div', { class: 'form-grid' },
      ed.text(`schedule.${i}.heading`, { label: 'Heading', required: 'publish', placeholder: 'e.g. Morning' }),
      ed.text(`schedule.${i}.description`, { label: 'Description (optional)', multiline: true, rows: 3 }))
  });
  return [
    ed.group(null, ed.text('overview', { label: 'Overview', required: 'publish', multiline: true, rows: 8, hint: 'Plain text. Separate paragraphs with a blank line.' })),
    h('div', { class: 'form-group' },
      h('h3', { class: 'group-title' }, 'Schedule (optional)'),
      h('p', { class: 'field-hint' }, 'Ordered items with a heading and an optional description, for example parts of the day. This is not a multi-day itinerary: the number of items does not have to match the duration. Use the arrow buttons to reorder; focus stays on the moved item.'),
      repeater.el,
      ed.readOnly ? null : h('div', { class: 'btn-row' }, button('Add schedule item', { iconName: 'plus', id: fieldIdFor('schedule'), onClick: () => repeater.add(newScheduleItem()) })),
      h('p', { class: 'field-error', id: `${fieldIdFor('schedule')}-error`, hidden: true }))
  ];
}

const countText = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Explicit, user-triggered copy of the day-trip defaults into THIS form. Nothing is saved until "Save draft";
// the defaults record and every other day trip stay unchanged.
async function copyDefaultsIntoDraft(ed) {
  const statusEl = () => document.getElementById('copy-defaults-status');
  let defaults;
  try { defaults = await ed.ws.defaults.getDayTripDefaults(); } catch (err) { statusEl().textContent = err.message; return; }
  const total = (defaults?.inclusions.length || 0) + (defaults?.whatToBring.length || 0);
  if (!total) {
    statusEl().replaceChildren('No day-trip defaults are saved yet, so nothing was copied. ', linkButton('Edit day-trip defaults', '#/day-trips/defaults', { variant: 'ghost' }));
    return;
  }
  const { inclusions, whatToBring } = ed.model;
  let mode = 'replace';
  if (inclusions.length || whatToBring.length) {
    mode = await openDialog({
      title: 'This draft already has entries',
      content: h('div', null,
        h('p', null, `This draft lists ${countText(inclusions.length, 'inclusion', 'inclusions')} and ${countText(whatToBring.length, 'what-to-bring item', 'what-to-bring items')}. The defaults have ${countText(defaults.inclusions.length, 'inclusion', 'inclusions')} and ${countText(defaults.whatToBring.length, 'item', 'items')}.`),
        h('ul', { class: 'error-list' },
          h('li', null, h('strong', null, 'Replace lists: '), 'both lists become exactly the defaults; the current entries are removed from this draft.'),
          h('li', null, h('strong', null, 'Add missing defaults: '), 'default entries that are not already listed are added at the end.')),
        h('p', null, 'Nothing is saved until you choose “Save draft”. Other day trips and the defaults are not changed.')),
      actions: [{ label: 'Cancel', value: null, autofocus: true }, { label: 'Add missing defaults', value: 'merge' }, { label: 'Replace lists', value: 'replace', variant: 'danger' }]
    }).result;
    if (!mode) return;
  }
  const { lists, added } = copyDefaults({ inclusions, whatToBring }, defaults, mode);
  inclusions.splice(0, inclusions.length, ...lists.inclusions);
  whatToBring.splice(0, whatToBring.length, ...lists.whatToBring);
  ed.changed();
  ed.refreshSection('lists');
  statusEl().textContent = `${mode === 'replace' ? 'Replaced the lists with' : 'Added'} ${countText(added.inclusions, 'default inclusion', 'default inclusions')} and ${countText(added.whatToBring, 'default what-to-bring item', 'default what-to-bring items')}. Review them, then save the draft to keep them.`;
  document.getElementById('copy-defaults')?.focus();
}

function lists(ed) {
  return [
    h('div', { class: 'form-group defaults-panel' },
      h('h3', { class: 'group-title' }, 'Day-trip defaults'),
      h('p', { class: 'field-hint' }, 'Proposed replacement behaviour: default inclusions and what-to-bring items are copied into this draft only when you choose to, and you are asked before populated lists are replaced. Copying never changes other day trips, and editing the defaults later never changes this day trip.'),
      ed.readOnly ? null : h('div', { class: 'btn-row' },
        button('Copy defaults into this draft', { iconName: 'copy', id: 'copy-defaults', onClick: () => copyDefaultsIntoDraft(ed) }),
        linkButton('Edit defaults', '#/day-trips/defaults', { variant: 'ghost' })),
      h('p', { class: 'field-hint', id: 'copy-defaults-status', role: 'status', 'aria-live': 'polite' })),
    ed.group(null,
      ed.list('inclusions', { label: 'Inclusions · at least one required to publish', noun: 'inclusion', placeholder: 'e.g. Park entrance fees' }),
      ed.list('exclusions', { label: 'Exclusions (optional)', noun: 'exclusion', placeholder: 'e.g. Gratuities' }),
      ed.list('whatToBring', { label: 'What to bring (optional)', noun: 'item', placeholder: 'e.g. Sun hat' }))
  ];
}

const termLabels = (ids, ctx) => ids.map(id => ctx.taxonomies.get(id)?.label || 'Unresolved value').join(', ');

export const dayTripModule = {
  kind: 'dayTrip', path: 'day-trips', label: 'Day trip', plural: 'Day Trips', icon: 'map',
  navGroup: 'Tour Packages', listLabel: 'Activities / day trips', addLabel: 'Add day trip', addNavLabel: 'Add Activity',
  intro: 'Day trips and activities: destinations, tags, an optional duration and schedule, inclusions, what to bring and provisional pricing. Fields are proposed replacement behaviour.',
  sections: [
    { id: 'basics', label: 'Basics', render: basics },
    { id: 'classification', label: 'Destinations & tags', render: classification },
    { id: 'content', label: 'Overview & schedule', render: content },
    { id: 'lists', label: 'Inclusions & preparation', render: lists },
    { id: 'pricing', label: 'Pricing', render: pricingSection },
    'media', 'seo', 'preview'
  ],
  columns: [
    { label: 'Duration', cell: env => formatDuration(env.record.duration) || '—' },
    { label: 'Destinations', cell: (env, ctx) => env.record.destinationIds.map(id => ctx.records.get(id)?.record.title || 'Missing').join(', ') || '—' },
    { label: 'Tags', cell: (env, ctx) => termLabels(env.record.tagIds, ctx) || '—' },
    { label: 'Price', cell: env => describePrice(env.record.pricing).text },
    { label: 'Featured / order', cell: env => [env.record.featured ? 'Featured' : '', env.record.displayOrder ?? ''].filter(v => v !== '').join(' · ') || '—' }
  ],
  sorts: {
    order: { label: 'Featured, then display order', compare: (a, b) => compareDayTrips(a.record, b.record) },
    price: { label: 'Price (missing last)', compare: null }
  },
  searchText: env => [env.record.title, env.record.slug, env.record.summary].join(' '),
  listExtras: () => h('div', { class: 'btn-row list-extras' },
    linkButton('Day-trip defaults', '#/day-trips/defaults', { variant: 'ghost', iconName: 'copy' }),
    linkButton('Local day-trip listing', '#/site/tours/day-trips', { variant: 'ghost', iconName: 'globe' }),
    h('span', { class: 'muted small' }, icon('info'), ' Public pattern: /tours/day-trips/{slug}'))
};
