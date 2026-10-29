// Accommodations module. Type/standard examples come from the audit and stay free text; public visibility
// (A3) and camp separation (A4) are unresolved, so publicPageEnabled is independent of the workflow.
import { h } from '../components/dom.js';
import { notice } from '../components/feedback.js';
import { ACCOMMODATION_SETTINGS, ACCOMMODATION_STANDARD_EXAMPLES, ACCOMMODATION_TYPE_EXAMPLES } from './shared/records.js';

function basics(ed) {
  return [
    ed.group(null,
      ed.text('title', { label: 'Name', required: true, onInput: () => ed.updateSlugFromTitle?.() }),
      ed.text('type', { label: 'Type', required: 'publish', list: 'accommodation-type-examples', hint: 'Suggestions (Hotel, Lodge, Campsite) are audit examples, not fixed rules. Any text is allowed.' }),
      ed.text('standard', { label: 'Standard', required: 'publish', list: 'accommodation-standard-examples', hint: 'Suggestions (Luxury, Semi Luxury, Normal) are audit examples, not fixed rules.' }),
      ed.select('setting', { label: 'Setting', options: Object.entries(ACCOMMODATION_SETTINGS).map(([value, label]) => ({ value, label })) }),
      ed.checkbox('publicPageEnabled', { label: 'Public page enabled', hint: 'Prototype assumption: new records default to enabled. Real public visibility rules (A3) are not confirmed; this does not change any live route.' })),
    h('datalist', { id: 'accommodation-type-examples' }, ACCOMMODATION_TYPE_EXAMPLES.map(v => h('option', { value: v }))),
    h('datalist', { id: 'accommodation-standard-examples' }, ACCOMMODATION_STANDARD_EXAMPLES.map(v => h('option', { value: v }))),
    ed.group('Page address', ed.slugField())
  ];
}

function location(ed) {
  const destinations = [...ed.ctx.records.values()].filter(env => env.kind === 'destination')
    .sort((a, b) => a.record.title.localeCompare(b.record.title) || a.id.localeCompare(b.id));
  const statusText = env => (env.record.status === 'archived' ? 'archived' : ed.ctx.published.has(env.id) ? 'published' : 'draft — not published');
  const options = [{ value: '', label: '— No destination —' }, ...destinations.map(env => ({ value: env.id, label: `${env.record.title} (${statusText(env)})` }))];
  const selected = ed.model.destinationId && ed.ctx.records.get(ed.model.destinationId);
  if (ed.model.destinationId && !selected) options.push({ value: ed.model.destinationId, label: 'Missing destination (remove this link)' });
  return [
    ed.group(null,
      ed.select('destinationId', {
        label: 'Destination', emptyValue: null, options,
        hint: 'Must be published before this accommodation can be published. Draft and archived destinations are listed with their status.',
        onChange: () => ed.refreshSection('location')
      }),
      selected && !ed.ctx.published.has(selected.id) ? notice('warning', `“${selected.record.title}” is ${selected.record.status === 'archived' ? 'archived' : 'not published'}. Publish it before publishing this accommodation.`) : null,
      ed.model.destinationId ? null : ed.text('noDestinationReason', {
        label: 'Reason for no destination', multiline: true, rows: 3, required: 'publish',
        hint: 'Required to publish without a destination — for example a mobile camp. Do not split or rewrite imported camp narratives automatically (A4).'
      }))
  ];
}

function content(ed) {
  return [
    ed.group(null,
      ed.text('description', { label: 'Description', required: 'publish', multiline: true, rows: 8, hint: 'Plain text. Separate paragraphs with a blank line.' }),
      ed.list('amenities', { label: 'Amenities', noun: 'amenity', placeholder: 'e.g. Swimming pool' }),
      ed.list('activities', { label: 'Activities', noun: 'activity', placeholder: 'e.g. Guided bush walk' }))
  ];
}

function contact(ed) {
  return [
    notice('info', 'Public details only. Private supplier rates, contracts and contacts do not belong in these records.'),
    ed.group(null,
      ed.text('publicPhone', { label: 'Public phone', inputmode: 'tel', placeholder: '+255 700 000 000', hint: 'Optional. Validated when supplied.' }),
      ed.checkbox('publicPhoneVisible', { label: 'Show phone publicly', hint: 'Hidden by default. When ticked, a valid phone number is required to publish.' }),
      ed.text('website', { label: 'Website', inputmode: 'url', placeholder: 'https://www.example.com', hint: 'Optional. Must be a full http:// or https:// address; other link types are rejected.' }))
  ];
}

export const accommodationModule = {
  kind: 'accommodation', path: 'accommodations', label: 'Accommodation', plural: 'Accommodations', icon: 'home',
  navGroup: 'Accommodations', listLabel: 'Accommodations List', addLabel: 'Add Accommodation',
  intro: 'Hotels, lodges and campsites with destination link, type, standard, amenities and public contact details.',
  sections: [
    { id: 'basics', label: 'Basics', render: basics },
    { id: 'location', label: 'Destination', render: location },
    { id: 'content', label: 'Description & amenities', render: content },
    { id: 'contact', label: 'Contact', render: contact },
    'media', 'seo', 'preview'
  ],
  columns: [
    {
      label: 'Destination',
      cell: (env, ctx) => {
        const id = env.record.destinationId;
        if (!id) return env.record.noDestinationReason ? 'None (reason given)' : 'None';
        const dest = ctx.records.get(id);
        return dest ? `${dest.record.title}${ctx.published.has(id) ? '' : dest.record.status === 'archived' ? ' (archived)' : ' (draft)'}` : 'Missing record';
      }
    },
    { label: 'Type · standard', cell: env => [env.record.type, env.record.standard].filter(Boolean).join(' · ') || '—' },
    { label: 'Public page', cell: env => (env.record.publicPageEnabled === false ? 'Disabled' : 'Enabled') }
  ],
  sorts: {},
  searchText: env => [env.record.title, env.record.slug, env.record.type, env.record.standard].join(' ')
};
