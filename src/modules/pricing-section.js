// Provisional pricing editor shared by tours and day trips: price on request (default) or an explicit manual
// "from" price (currency, decimal-string amount, basis, public applicability note). No price matrix, totals
// or quotes (B2/B3). Lives in the editor section with id "pricing".
import { createRepeater } from '../components/repeater.js';
import { button, h } from '../components/dom.js';
import { notice } from '../components/feedback.js';
import { fieldIdFor, radioGroup } from '../components/fields.js';
import { formToRecord } from './shared/records.js';
import { BASIS_LABELS, COMMON_CURRENCIES, PROVISIONAL_PRICING_WARNING, describePrice, supportedCurrencies } from './shared/pricing.js';

export function pricingSection(ed) {
  const p = ed.model.pricing;
  const display = h('p', { class: 'price-display', 'aria-live': 'polite' });
  const update = () => { display.textContent = `Shown publicly as: ${describePrice(formToRecord(ed.model).record.pricing).text}`; };
  const mode = radioGroup({
    id: fieldIdFor('pricing.mode'), legend: 'Pricing mode', value: p.mode,
    hint: 'Default is price on request. The full residency/season/group price matrix is not modelled yet (B2/B3); no totals or quotes are calculated.',
    options: [{ value: 'request', label: 'Price on request (default)' }, { value: 'manualFrom', label: 'Manual “from” price — provisional' }],
    onChange: value => {
      p.mode = value;
      ed.changed();
      ed.refreshSection('pricing');
      document.querySelector(`#${fieldIdFor('pricing.mode')} input[value="${value}"]`)?.focus();
    }
  });
  const fields = p.mode === 'manualFrom' ? [
    notice('warning', PROVISIONAL_PRICING_WARNING),
    h('div', { class: 'form-grid' },
      ed.text('pricing.currency', { label: 'Currency', required: 'publish', list: 'currency-codes', placeholder: 'USD', hint: 'Three-letter ISO 4217 code supported by this browser (for example USD, EUR, TZS).', onInput: update }),
      ed.text('pricing.amount', { label: '“From” amount', required: 'publish', inputmode: 'decimal', placeholder: '1250.00', hint: 'Digits with an optional decimal point. Stored exactly as entered (decimal text, not a rounded number). 0 is allowed and shown as 0.', onInput: update }),
      ed.select('pricing.basis', { label: 'Price basis', required: 'publish', emptyValue: undefined, options: [{ value: '', label: '— Choose basis —' }, ...Object.entries(BASIS_LABELS).map(([value, label]) => ({ value, label: label[0].toUpperCase() + label.slice(1) }))], onChange: update }),
      ed.text('pricing.applicability', { label: 'What the price applies to (public)', required: 'publish', multiline: true, rows: 3, placeholder: 'e.g. Per person sharing, based on 4 travellers in low season.', onInput: update })),
    h('datalist', { id: 'currency-codes' }, [...new Set([...COMMON_CURRENCIES, ...supportedCurrencies()])].map(code => h('option', { value: code })))
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
