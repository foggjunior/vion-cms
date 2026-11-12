// Destinations module: observed public fields plus proposed structured tips, explicit cover, order and SEO.
import { button, h } from '../components/dom.js';
import { confirmDialog } from '../components/dialog.js';
import { notice } from '../components/feedback.js';
import { createRepeater } from '../components/repeater.js';
import { compareOptionalNumber, convertLegacyTips, newTravelTip } from './shared/records.js';

function basics(ed) {
  return [
    ed.group(null,
      ed.text('title', { label: 'Title', required: true, hint: 'Used in CMS lists, and publicly when no display name is set.', onInput: () => ed.updateSlugFromTitle?.() }),
      ed.text('displayName', { label: 'Display name (public)', hint: 'Optional public name if it should differ from the title.' }),
      ed.text('internalName', { label: 'Internal / stored name', hint: 'Optional staff-facing name, for example a legacy stored name. Not shown publicly.' }),
      ed.text('order', { label: 'Order', inputmode: 'numeric', placeholder: 'e.g. 10', hint: 'Optional whole number for manual list ordering (lower first). Proposed field.' })),
    ed.group('Page address', ed.slugField())
  ];
}

function content(ed) {
  return [
    ed.group(null,
      ed.text('overview', { label: 'Overview', required: 'publish', multiline: true, rows: 8, hint: 'Plain text. Separate paragraphs with a blank line.' }),
      ed.text('bestTime', { label: 'Best time to visit', required: 'publish', multiline: true, rows: 3 }),
      ed.text('wildlife', { label: 'Wildlife (optional)', multiline: true, rows: 4 }))
  ];
}

function tips(ed) {
  const { model } = ed;
  model.travelTips = model.travelTips || [];
  const repeater = createRepeater({
    items: model.travelTips, readOnly: ed.readOnly,
    itemLabel: (tip, i) => `Travel tip ${i + 1}`,
    emptyText: 'No structured travel tips yet.',
    onChange: () => ed.changed(),
    confirmRemove: (tip, i) => (tip.title || tip.body ? confirmDialog({ title: `Remove travel tip ${i + 1}?`, body: 'Its title and text will be removed from this draft.', confirmLabel: 'Remove tip', danger: true }) : true),
    renderItem: (tip, i) => h('div', { class: 'form-grid' },
      ed.text(`travelTips.${i}.title`, { label: 'Tip title', required: 'publish' }),
      ed.text(`travelTips.${i}.body`, { label: 'Tip text', required: 'publish', multiline: true, rows: 3 }))
  });
  const legacy = model.legacyTravelTips;
  return [
    ed.group(null, ed.list('activities', { label: 'Activities', noun: 'activity', placeholder: 'e.g. Game drive', hint: 'Ordered list. Exact duplicates are removed when saving; entries that differ only by capitalisation are kept and flagged.' })),
    h('div', { class: 'form-group' },
      h('h3', { class: 'group-title' }, 'Travel tips'),
      h('p', { class: 'field-hint' }, 'Structured tips (proposed): each has a title and text.'),
      repeater.el,
      ed.readOnly ? null : button('Add travel tip', { iconName: 'plus', onClick: () => repeater.add(newTravelTip()) }),
      h('p', { class: 'field-error', id: 'f-travelTips-error', hidden: true })),
    legacy ? h('div', { class: 'form-group' },
      h('h3', { class: 'group-title' }, 'Legacy travel tips (original text)'),
      notice('info', 'Imported paragraph tips are kept exactly as they were. Converting copies them into structured tips without deleting this original text.'),
      h('textarea', { class: 'input', rows: 6, readOnly: true, 'aria-label': 'Legacy travel tips (read only)', value: legacy }),
      ed.readOnly ? null : button('Convert into structured tips', {
        iconName: 'copy',
        onClick: () => {
          const converted = convertLegacyTips(legacy);
          model.travelTips.push(...converted);
          ed.changed();
          ed.refreshSection('tips');
        }
      })) : null
  ];
}

export const destinationModule = {
  kind: 'destination', path: 'destinations', label: 'Destination', plural: 'Destinations', icon: 'pin',
  navGroup: 'Destinations', listLabel: 'Destinations List', addLabel: 'Add Destination',
  intro: 'Destination guides with overview, wildlife, activities, best time to visit and travel tips.',
  sections: [
    { id: 'basics', label: 'Basics', render: basics },
    { id: 'content', label: 'Content', render: content },
    { id: 'tips', label: 'Travel Tips & Activities', render: tips },
    'media', 'seo', 'preview'
  ],
  columns: [
    { label: 'Images', cell: env => String((env.record.cover ? 1 : 0) + (env.record.gallery?.length || 0)) },
    { label: 'Order', cell: env => (env.record.order ?? '—').toString() }
  ],
  sorts: {
    order: { label: 'Manual order', compare: compareOptionalNumber('order') }
  },
  searchText: env => [env.record.title, env.record.displayName, env.record.internalName, env.record.slug].join(' ')
};
