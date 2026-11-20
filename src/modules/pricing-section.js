// Public pricing for tours and day trips.
import { createRepeater } from '../components/repeater.js';
import { button, h } from '../components/dom.js';
import { notice } from '../components/feedback.js';
import { fieldIdFor, radioGroup } from '../components/fields.js';
import { formToRecord } from './shared/records.js';
import { BASIS_LABELS, COMMON_CURRENCIES, GROUP_PRICE_FIELDS, PROVISIONAL_PRICING_WARNING, describePrice, supportedCurrencies } from './shared/pricing.js';

export function pricingSection(ed) {
  const p = ed.model.pricing;
  const display = h('p', { class: 'price-display', 'aria-live': 'polite' });
  const update = () => { display.textContent = `Shown publicly as: ${describePrice(formToRecord(ed.model).record.pricing).text}`; };
  const legacyMode = p.mode === 'request' || p.mode === 'manualFrom';
  const mode = legacyMode ? radioGroup({
    id: fieldIdFor('pricing.mode'), legend: 'Pricing mode', value: p.mode,
    hint: 'Enter an amount in USD per person for each group size. The group-of-6 price appears on cards and all three prices appear on the trip page.',
    options: [
      { value: 'request', label: 'Price on request' },
      { value: 'groupUsd', label: 'USD prices by group size' },
      ...(ed.model.pricing.mode === 'manualFrom' || p.amount ? [{ value: 'manualFrom', label: 'Legacy “from” price' }] : [])
    ],
    onChange: value => {
      p.mode = value;
      ed.changed();
      ed.refreshSection('pricing');
      const target = value === 'groupUsd' ? '#' + fieldIdFor('pricing.group2') :
        `#${fieldIdFor('pricing.mode')} input[value="${value}"]`;
      document.querySelector(target)?.focus();
    }
  }) : h('p', { class: 'field-hint' }, 'Enter all three prices. The group-of-6 price appears on cards and all three prices appear on the trip page.');
  const fields = p.mode === 'manualFrom' ? [
    notice('warning', PROVISIONAL_PRICING_WARNING),
    h('div', { class: 'form-grid' },
      ed.text('pricing.currency', { label: 'Currency', required: 'publish', list: 'currency-codes', placeholder: 'USD', hint: 'Three-letter ISO 4217 code supported by this browser (for example USD, EUR, TZS).', onInput: update }),
      ed.text('pricing.amount', { label: '“From” amount', required: 'publish', inputmode: 'decimal', placeholder: '1250.00', hint: 'Digits with an optional decimal point. Stored exactly as entered (decimal text, not a rounded number). 0 is allowed and shown as 0.', onInput: update }),
      ed.select('pricing.basis', { label: 'Price basis', required: 'publish', emptyValue: undefined, options: [{ value: '', label: '— Choose basis —' }, ...Object.entries(BASIS_LABELS).map(([value, label]) => ({ value, label: label[0].toUpperCase() + label.slice(1) }))], onChange: update }),
      ed.text('pricing.applicability', { label: 'What the price applies to (public)', required: 'publish', multiline: true, rows: 3, placeholder: 'e.g. Per person sharing, based on 4 travellers in low season.', onInput: update })),
    h('datalist', { id: 'currency-codes' }, [...new Set([...COMMON_CURRENCIES, ...supportedCurrencies()])].map(code => h('option', { value: code })))
  ] : p.mode === 'groupUsd' ? [
    h('div', { class: 'form-grid' }, GROUP_PRICE_FIELDS.map(key =>
      ed.text('pricing.' + key, { label: 'Group of ' + key.slice(-1) + ' · USD per person',
        required: 'publish', inputmode: 'decimal', placeholder: '1250.00', onInput: update })))
  ] : [];
  update();
  if (ed.model.kind !== 'tour') return [mode, ...fields, display];
  const rates = createRepeater({
    items: ed.model.publicRates, readOnly: ed.readOnly, onChange: () => ed.changed(),
    itemLabel: (_, index) => `Rate ${index + 1}`,
    emptyText: 'No public seasonal rates.',
    renderItem: (_, index) => h('div', { class: 'form-grid' },
      ...[['residency', 'Residency'], ['traveller', 'Traveller type'], ['season', 'Season'],
        ['currency', 'Currency'], ['amount', 'Amount per person']].map(([key, label]) =>
        ed.text(`publicRates.${index}.${key}`, { label, required: true })))
  });
  return [mode, ...fields, display, h('h3', null, 'Public seasonal rates'), rates.el,
    ed.readOnly ? null : button('Add public rate', {onClick: () => rates.add({
      id: crypto.randomUUID(), residency: '', traveller: '', season: '', currency: 'USD', amount: ''
    })})];
}
