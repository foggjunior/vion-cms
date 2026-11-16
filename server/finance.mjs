function invalid(message) {
  throw Object.assign(new Error(message), {status: 422});
}

const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const clean = value => {
  if (typeof value !== 'string' || value.length > 2000) invalid('Invalid finance text.');
  return value.trim();
};
const positive = (value, allowZero = false) => {
  if (!['number','string'].includes(typeof value) || String(value).trim() === '') invalid('Enter a valid amount.');
  const number = Number(value);
  if (!Number.isFinite(number) || number > 1e12 || number < 0 || (!allowZero && number === 0)) invalid('Enter a valid amount.');
  return number;
};
function money(amount, currency = 'TZS', rate, allowZero = false) {
  if (!['TZS','USD'].includes(currency)) invalid('Choose TZS or USD.');
  const original = positive(amount, allowZero);
  const exchange = currency === 'USD' ? positive(rate) : null;
  const converted = exchange === null ? original : Math.round(original * exchange);
  return {original, currency, rate:exchange, amount:positive(converted, allowZero)};
}
const adminTypes = ['Staff salary','Licences','Tools / subscriptions','Internet','Stationery','Water','Electricity'];
const tourTypes = ['Guide allowance','Fuel','Accommodation','Park fees','Child park fees','Concession fees','Car permit','Crater fees'];

export function validateLedger(input) {
  if (!input || !Number.isSafeInteger(input.version) || input.version < 0 ||
      !Array.isArray(input.rows) || !Array.isArray(input.trips) ||
      input.rows.length > 2000 || input.trips.length > 1000) invalid('Invalid or oversized finance ledger.');
  const byId = new Map();
  const trips = input.trips.map(trip => {
    if (!trip || typeof trip.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(trip.id) || byId.has(trip.id) ||
        !['Day trip','Multi-day trip'].includes(trip.type) || !isDate(trip.start) || !isDate(trip.end) ||
        trip.end < trip.start || (trip.type === 'Day trip' && trip.start !== trip.end) ||
        !Number.isSafeInteger(trip.guests) || trip.guests < 1) invalid('Check trip details and dates.');
    const fields = money(trip.priceOriginal,trip.priceCurrency,trip.priceRate,true);
    const record = {
      id:trip.id,type:trip.type,start:trip.start,end:trip.end,guests:trip.guests,
      name:clean(trip.name),guestNames:clean(trip.guestNames),guide:clean(trip.guide),contact:clean(trip.contact),
      price:fields.amount,priceOriginal:fields.original,priceCurrency:fields.currency,priceRate:fields.rate,
      children:trip.children === true,crater:trip.crater === true,dayAccommodation:trip.dayAccommodation === true
    };
    if (!record.name || !record.guestNames || !record.guide || !record.contact) invalid('Complete the trip, guest and guide details.');
    byId.set(record.id,record);
    return record;
  });
  const received = new Map();
  const rows = input.rows.map(row => {
    if (!row || !['Expenses','Revenue','Other Income'].includes(row.kind) || !isDate(row.date)) invalid('Check the transaction type and date.');
    const record = {kind:row.kind,date:row.date,name:clean(row.name),method:clean(row.method ?? ''),...money(row.original,row.currency,row.rate,row.kind==='Expenses'&&row.category==='Tour')};
    if (!record.name) invalid('Enter a transaction name.');
    if (row.kind === 'Revenue') {
      if (!byId.has(row.trip) || !['Deposit','Balance'].includes(row.stage)) invalid('Select a tour and payment stage.');
      record.trip=row.trip; record.stage=row.stage; record.reference=clean(row.reference ?? '');
      received.set(row.trip,(received.get(row.trip)||0)+record.amount);
    }
    if (row.kind === 'Expenses') {
      if (!['Administration','Operational','General','Tour'].includes(row.category)) invalid('Choose an expense category.');
      record.category=row.category; record.type=clean(row.type ?? '');
      record.description=clean(row.description ?? ''); record.comment=clean(row.comment ?? '');
      if (row.category === 'Administration' && !adminTypes.includes(record.type)) invalid('Choose an administration expense type.');
      if (['Licences','Tools / subscriptions','Internet'].includes(record.type)) {
        if (!isDate(row.expiry)) invalid('Enter the expense expiry date.');
        record.expiry=row.expiry;
      }
      if (row.category === 'Tour') {
        const trip=byId.get(row.trip);
        if (!trip || !tourTypes.includes(record.type) ||
            (record.type==='Accommodation' && trip.type==='Day trip' && !trip.dayAccommodation) ||
            (record.type==='Child park fees' && !trip.children) ||
            (record.type==='Crater fees' && !trip.crater)) invalid('Check the expense against the tour details.');
        record.trip=row.trip;
      }
    }
    return record;
  });
  for (const [id, amount] of received) if (amount > byId.get(id).price) invalid('Payments exceed the agreed trip price.');
  return {version:input.version,rows,trips};
}
