// Provisional tour pricing: price on request, or an explicit manual "from" amount.
// The residency/season/group price matrix (B2/B3) is deliberately not modelled or calculated.
export const PRICING_MODES = Object.freeze({ request: 'Price on request', manualFrom: 'Manual “from” price (provisional)' });
export const BASIS_LABELS = Object.freeze({ perPerson: 'per person', perGroup: 'per group', perVehicle: 'per vehicle' });
export const AMOUNT_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
export const MAX_INTEGER_DIGITS = 12;
export const PROVISIONAL_PRICING_WARNING = 'Manual “from” pricing is provisional until the full tour price model (B2/B3) is confirmed. It is shown in local preview only and is not a quote.';

const FALLBACK_CURRENCIES = ['AUD', 'CAD', 'CHF', 'CNY', 'EUR', 'GBP', 'INR', 'JPY', 'KES', 'RWF', 'SEK', 'TZS', 'UGX', 'USD', 'ZAR'];
export const COMMON_CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'TZS', 'KES']);

let currencySet = null;
export function supportedCurrencies() {
  if (!currencySet) {
    try { currencySet = new Set(Intl.supportedValuesOf('currency')); } catch { currencySet = new Set(FALLBACK_CURRENCIES); }
  }
  return currencySet;
}

export function isSupportedCurrency(code) {
  if (typeof code !== 'string' || !/^[A-Z]{3}$/.test(code) || !supportedCurrencies().has(code)) return false;
  try { new Intl.NumberFormat('en-GB', { style: 'currency', currency: code }); return true; } catch { return false; }
}

export function currencyDigits(code) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits;
}

// Returns an actionable message for a supplied amount, or null when valid. Zero is a valid amount.
export function amountMessage(amount, currency) {
  if (!AMOUNT_PATTERN.test(amount)) return 'Enter the amount using digits only, with an optional decimal point (for example 1250 or 1250.50). Do not include commas, spaces or currency symbols.';
  const [whole, fraction = ''] = amount.split('.');
  if (whole.length > MAX_INTEGER_DIGITS) return `Enter an amount with at most ${MAX_INTEGER_DIGITS} digits before the decimal point.`;
  if (currency && isSupportedCurrency(currency)) {
    const digits = currencyDigits(currency);
    if (fraction.length > digits) return digits === 0 ? `${currency} amounts cannot have decimals.` : `${currency} amounts can have at most ${digits} decimal places.`;
  }
  return null;
}

export function pricingIssues(pricing, { publish = false } = {}) {
  const issues = [];
  const error = (path, message) => issues.push({ path, message, severity: 'error' });
  if (!pricing || !pricing.mode) {
    if (publish) error('pricing.mode', 'Choose a pricing mode: “Price on request” or a manual “from” price.');
    return issues;
  }
  if (!(pricing.mode in PRICING_MODES)) { error('pricing.mode', 'Choose a valid pricing mode.'); return issues; }
  if (pricing.mode === 'request') return issues;
  const { currency, amount, basis, applicability } = pricing;
  if (currency !== undefined && !isSupportedCurrency(currency)) error('pricing.currency', `“${currency}” is not a supported ISO 4217 currency code. Use three capital letters such as USD, EUR or TZS.`);
  if (amount !== undefined) { const message = amountMessage(amount, currency); if (message) error('pricing.amount', message); }
  if (basis !== undefined && !(basis in BASIS_LABELS)) error('pricing.basis', 'Choose per person, per group or per vehicle.');
  if (publish) {
    if (currency === undefined) error('pricing.currency', 'Enter the currency for the manual “from” price.');
    if (amount === undefined) error('pricing.amount', 'Enter the “from” amount, or switch to “Price on request”.');
    if (basis === undefined) error('pricing.basis', 'Choose whether the price is per person, per group or per vehicle.');
    if (!applicability || !applicability.trim()) error('pricing.applicability', 'Explain publicly what the “from” price applies to (for example group size, season or accommodation level).');
  }
  issues.push({ path: 'pricing.mode', message: PROVISIONAL_PRICING_WARNING, severity: 'warning' });
  return issues;
}

export function formatAmount(amount, currency) {
  const fraction = amount.split('.')[1] || '';
  const digits = currencyDigits(currency);
  // Amount strings are passed to Intl as decimal strings, never converted through floating point arithmetic.
  return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency, currencyDisplay: 'code',
    minimumFractionDigits: fraction.length ? digits : 0, maximumFractionDigits: digits
  }).format(amount);
}

// kind: request | from | incomplete. "per person" is rendered only for the perPerson basis.
export function describePrice(pricing) {
  if (!pricing || pricing.mode === 'request' || !pricing.mode) return { kind: 'request', text: 'Price on request', basis: null };
  const { amount, currency, basis, applicability } = pricing;
  if (amount === undefined || !isSupportedCurrency(currency) || !(basis in BASIS_LABELS) || amountMessage(amount, currency)) {
    return { kind: 'incomplete', text: 'Manual price incomplete', basis: basis in BASIS_LABELS ? BASIS_LABELS[basis] : null };
  }
  return { kind: 'from', text: `From ${formatAmount(amount, currency)} ${BASIS_LABELS[basis]}`, amount: formatAmount(amount, currency), basis: BASIS_LABELS[basis], applicability: applicability || '' };
}

export function compareDecimalStrings(a, b) {
  const [aw, af = ''] = a.split('.');
  const [bw, bf = ''] = b.split('.');
  if (aw.length !== bw.length) return aw.length - bw.length;
  if (aw !== bw) return aw < bw ? -1 : 1;
  const len = Math.max(af.length, bf.length);
  const ap = af.padEnd(len, '0');
  const bp = bf.padEnd(len, '0');
  return ap === bp ? 0 : ap < bp ? -1 : 1;
}

// Request/incomplete prices sort last; complete prices sort by currency then exact decimal amount.
export function comparePricing(a, b) {
  const da = describePrice(a);
  const db = describePrice(b);
  const aHas = da.kind === 'from';
  const bHas = db.kind === 'from';
  if (aHas !== bHas) return aHas ? -1 : 1;
  if (!aHas) return 0;
  if (a.currency !== b.currency) return a.currency < b.currency ? -1 : 1;
  return compareDecimalStrings(a.amount, b.amount);
}
