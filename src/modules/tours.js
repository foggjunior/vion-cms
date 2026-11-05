import {tourCostSection} from '../operations/editor-sections.js';
// Tours module. Most tour fields are inferred (B1); taxonomies are managed terms awaiting definitions (B4);
// pricing is limited to price-on-request or an explicit manual "from" price until the price model (B2/B3) is
// confirmed.
import { button, h } from '../components/dom.js';
import { confirmDialog } from '../components/dialog.js';
import { notice } from '../components/feedback.js';
import { fieldIdFor } from '../components/fields.js';
import { createRepeater } from '../components/repeater.js';
import { MEAL_OPTIONS, compareOptionalNumber, newItineraryDay } from './shared/records.js';
import { describePrice } from './shared/pricing.js';
import { manageTaxonomiesLink, tagsField, termSelect } from './term-fields.js';
import { pricingSection } from './pricing-section.js';

function basics(ed) {
  return [
    ed.group(null,
      ed.text('title', { label: 'Title', required: true, onInput: () => ed.updateSlugFromTitle?.() }),
      ed.text('summary', { label: 'Summary', multiline: true, rows: 3, hint: 'Short teaser for cards and listings.' }),
      ed.text('durationDays', { label: 'Duration (days)', required: 'publish', inputmode: 'numeric', placeholder: 'e.g. 5', hint: 'Whole number of days. The itinerary must have exactly this many days to publish.', onInput: () => ed.onDurationInput?.() }),
      ed.checkbox('featured', { label: 'Featured tour' }),
      ed.text('recommendedRank', { label: 'Recommended rank', inputmode: 'numeric', hint: 'Optional whole number (0 or more) for ordering recommendations. 0 is a valid rank, not “missing”.' })),
    ed.group('Page address', ed.slugField(),
      notice('info', 'Hub paths /tours/day-trips, /tours/zanzibar-trips and /tours/climbing-trips are reserved and cannot be used as tour slugs.'))
  ];
}

function classification(ed) {
  return [
    ed.group('Destinations',
      ed.relations('destinationIds', { legend: 'Tour destinations', kind: 'destination', noun: 'destination', hint: 'At least one published destination is required to publish. Draft and archived destinations can be linked while drafting but block publishing.' })),
    h('div', { class: 'form-group' },
      h('h3', { class: 'group-title' }, 'Classification (optional)'),
      notice('info', 'Tour types, categories, standards and tags are managed terms with stable IDs. Their definitions await owner confirmation (B4); no existing CMS values are assumed. Only active terms can be newly chosen; publishing needs them in the published taxonomy.', ' ', manageTaxonomiesLink()),
      h('div', { class: 'form-grid' }, termSelect(ed, 'typeId', 'type'), termSelect(ed, 'categoryId', 'category'), termSelect(ed, 'standardId', 'standard'), tagsField(ed, { sectionId: 'classification' })))
  ];
}

function content(ed) {
  return [
    ed.group(null,
      ed.text('overview', { label: 'Overview', required: 'publish', multiline: true, rows: 8, hint: 'Plain text. Separate paragraphs with a blank line.' }),
      ed.list('inclusions', { label: 'Inclusions · required to publish', noun: 'inclusion', placeholder: 'e.g. Park entrance fees' }),
      ed.list('exclusions', { label: 'Exclusions · required to publish', noun: 'exclusion', placeholder: 'e.g. International flights' }))
  ];
}

function mealsField(ed, base, day) {
  const id = fieldIdFor(`${base}.meals`);
  const extra = day.meals.filter(m => !MEAL_OPTIONS.includes(m));
  return h('fieldset', { class: 'field', id },
    h('legend', { class: 'field-label' }, 'Meals included'),
    h('div', { class: 'check-grid' }, MEAL_OPTIONS.map(meal => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: day.meals.includes(meal), disabled: ed.readOnly, on: { change: e => {
        const chosen = new Set(day.meals);
        if (e.target.checked) chosen.add(meal); else chosen.delete(meal);
        day.meals = [...MEAL_OPTIONS.filter(m => chosen.has(m)), ...extra];
        ed.changed();
      } } }), h('span', null, meal)))),
    extra.length ? h('p', { class: 'field-hint' }, `Also recorded: ${extra.join(', ')}`) : null,
    h('p', { class: 'field-error', id: `${id}-error`, hidden: true }));
}

function itinerary(ed) {
  const days = ed.model.itinerary;
  const summary = h('p', { class: 'itinerary-summary', 'aria-live': 'polite' });
  const fillRow = h('div', { class: 'btn-row' });
  const renumber = () => days.forEach((day, i) => { day.dayNumber = i + 1; });
  const duration = () => (/^\d+$/.test(String(ed.model.durationDays).trim()) ? Number(ed.model.durationDays) : null);

  function updateSummary() {
    const d = duration();
    summary.className = `itinerary-summary ${d && d !== days.length ? 'is-warning' : ''}`;
    summary.textContent = `${days.length} day${days.length === 1 ? '' : 's'} in the itinerary · duration ${d ? `${d} day${d === 1 ? '' : 's'}` : 'not set'}${d && d !== days.length ? ' — these must match to publish.' : ''}`;
    fillRow.replaceChildren();
    if (!ed.readOnly && d && d > days.length && d - days.length <= 60) {
      fillRow.append(button(`Add ${d - days.length} missing day${d - days.length === 1 ? '' : 's'}`, {
        iconName: 'plus', onClick: () => { while (days.length < d) days.push(newItineraryDay(days.length + 1)); ed.changed(); repeater.render(); updateSummary(); }
      }));
    }
  }

  const repeater = createRepeater({
    items: days, readOnly: ed.readOnly, className: 'day-list',
    itemLabel: (day, i) => `Day ${i + 1}`,
    emptyText: 'No days yet. Add the first day below.',
    onChange: () => { renumber(); ed.changed(); updateSummary(); },
    confirmRemove: (day, i) => (day.title || day.description ? confirmDialog({ title: `Remove day ${i + 1}?`, body: `“${day.title || 'Untitled day'}” and its details will be removed. Later days move up so numbering stays contiguous.`, confirmLabel: 'Remove day', danger: true }) : true),
    renderItem: (day, i) => {
      const base = `itinerary.${i}`;
      return h('div', { class: 'form-grid' },
        ed.text(`${base}.title`, { label: 'Day title', required: 'publish' }),
        ed.text(`${base}.description`, { label: 'Description', required: 'publish', multiline: true, rows: 4 }),
        ed.relations(`${base}.destinationIds`, { legend: 'Destinations this day (optional)', kind: 'destination', noun: 'destination' }),
        ed.relations(`${base}.accommodationIds`, { legend: 'Accommodation (optional alternatives)', kind: 'accommodation', noun: 'accommodation', hint: 'Several entries are shown as alternatives (“A or B”). Leave empty for camping or nights without a property record.' }),
        mealsField(ed, base, day),
        ed.list(`${base}.activities`, { label: 'Activities', noun: 'activity', placeholder: 'e.g. Afternoon game drive' }));
    }
  });
  updateSummary();
  ed.onDurationInput = updateSummary;
  return [
    h('p', { class: 'section-intro' }, 'Days are numbered from their order and always stay contiguous. Use the arrow buttons to reorder; focus stays on the moved day.'),
    summary,
    repeater.el,
    ed.readOnly ? null : h('div', { class: 'btn-row' }, button('Add day', { iconName: 'plus', id: fieldIdFor('itinerary'), onClick: () => repeater.add(newItineraryDay(days.length + 1)) })),
    fillRow,
    h('p', { class: 'field-error', id: `${fieldIdFor('itinerary')}-error`, hidden: true })
  ];
}

export const tourModule = {
  kind: 'tour', path: 'tours', label: 'Tour', plural: 'Tours', icon: 'map',
  navGroup: 'Tour Packages', listLabel: 'Tours List', addLabel: 'Add Tour',
  intro: 'Tour packages with destinations, day-by-day itinerary, inclusions and provisional pricing.',
  sections: [
    { id: 'basics', label: 'Basics', render: basics },
    { id: 'classification', label: 'Destinations & classification', render: classification },
    { id: 'content', label: 'Overview & inclusions', render: content },
    { id: 'itinerary', label: 'Itinerary', render: itinerary },
    { id: 'pricing', label: 'Pricing', render: pricingSection },
    tourCostSection,
    'media', 'seo', 'preview'
  ],
  columns: [
    { label: 'Duration', cell: env => (env.record.durationDays ? `${env.record.durationDays} d` : '—') },
    { label: 'Destinations', cell: (env, ctx) => env.record.destinationIds.map(id => ctx.records.get(id)?.record.title || 'Missing').join(', ') || '—' },
    { label: 'Price', cell: env => describePrice(env.record.pricing).text },
    { label: 'Featured', cell: env => (env.record.featured ? 'Yes' : '') }
  ],
  sorts: {
    price: { label: 'Price (missing last)', compare: null },
    rank: { label: 'Recommended rank', compare: compareOptionalNumber('recommendedRank') }
  },
  searchText: env => [env.record.title, env.record.slug, env.record.summary].join(' ')
};
