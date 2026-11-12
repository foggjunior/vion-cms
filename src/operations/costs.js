// Private costing: exact cents, integer quantities; no supplier data enters public records.
export const BASIS={adults:'Per adult',kids:'Per child',day:'Per day',roomNight:'Per room/night',vehicle:'Per vehicle',trip:'Once per trip'};
export const validBasis=b=>b==='travellers'||Object.hasOwn(BASIS,b);
export function basisOptions(value){return [...Object.entries(BASIS).map(([value,label])=>({value,label})),...(value==='travellers'?[{value:'travellers',label:'Saved: adults + children'}]:[])];}
export function quantityFor(l,q){return l.basis==='adults'?q.adults:l.basis==='kids'?q.kids:l.basis==='travellers'?q.adults+q.kids:['day','trip'].includes(l.basis)?1:l.quantity;}
export function lineTotal(l,q){if(!l.included)return 0n;const quantity=quantityFor(l,q);if(!Number.isInteger(quantity)||quantity<0||quantity>100000)throw Error('Quantity must be a nonnegative whole number.');return quantity===0?0n:money(l.amount)*BigInt(quantity);}
export function profitGroup(l){return l.category==='accommodation'?'accommodation':'cost:'+(l.profitGroup||l.label).trim();}
export function profitTargets(q){const groups=new Map([['accommodation','Accommodation'],['all','All itinerary costs']]);for(const d of q.days||[])for(const l of d.lines||[])if(l.included&&l.label.trim()&&profitGroup(l)!=='accommodation')groups.set(profitGroup(l),l.profitGroup||l.label);return [...groups].map(([value,label])=>({value,label}));}
export function profitRules(q){return q.profitRules??[{target:'accommodation',percent:q.profitPercent??'0'}];}
export function validateProfit(q){const seen=new Set();if(!Array.isArray(profitRules(q)))throw Error('Profit rules must be a list.');for(const r of profitRules(q)){if(typeof r.target!=='string'||!['all','accommodation'].includes(r.target)&&!r.target.startsWith('cost:')||seen.has(r.target))throw Error('Choose each profit cost group only once.');seen.add(r.target);if(money(r.percent)>100000n)throw Error('Profit percentage must be between 0 and 1000.');}if(seen.has('all')&&seen.size>1)throw Error('All itinerary costs cannot be combined with another profit rule.');}
export const mandatory=['Park fees','Accommodation STO','Transport costs','Car permit','Concession fees','Flying doctor'];
export const optional=['Drinks','Internal flights','Crater fees','Hot air balloon','Lunch box'];
export function money(v){if(!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(String(v)))throw new Error('Enter a nonnegative amount with at most two decimal places.');const [a,b='']=String(v).split('.');const n=BigInt(a)*100n+BigInt(b.padEnd(2,'0'));if(n>999999999999n)throw new Error('Amount is too large.');return n;}
export function decimal(n){return `${n/100n}.${String(n%100n).padStart(2,'0')}`;}
export function line(label,category=label==='Accommodation STO'?'accommodation':'other'){return {id:crypto.randomUUID(),label,category,basis:'trip',quantity:1,amount:'',included:true};}
export function newDay(){return {id:crypto.randomUUID(),destinationId:'',destinationName:'',destinationOverview:'',accommodationId:'',accommodationName:'',accommodationOverview:'',roomId:'',roomName:'',description:'',meals:'',activities:'',lines:mandatory.map(x=>line(x))};}
export function childCostsNeedReview(day, quote) {
 return quote.reviewChildCosts === true && quote.kids > 0 &&
   day.noChildCharges !== true &&
   !day.lines.some(cost => cost.included && cost.basis === 'kids');
}

export function recalc(q){
 if(!Number.isInteger(q.adults)||q.adults<0||!Number.isInteger(q.kids)||q.kids<0||q.adults+q.kids<1)throw new Error('Enter at least one traveller with whole-number adults and children.');
 if(!q.days?.length)throw new Error('Add at least one itinerary day.');
 if(!/^[A-Z]{3}$/.test(q.currency))throw new Error('Choose a three-letter currency.');
 try{new Intl.NumberFormat('en',{style:'currency',currency:q.currency});}catch{throw new Error('Invalid currency.');}
 validateProfit(q);let costs=0n,sto=0n;const dayTotals=[],groups=new Map();
 q.days.forEach((day,index)=>{
 if(childCostsNeedReview(day,q))throw new Error('Day '+(index+1)+': add child costs or confirm no child charges.');
 let subtotal=0n;for(const l of day.lines){if(!l.included||(l.basis==='kids'&&q.kids===0))continue;if(!l.label.trim())throw Error('Name every included cost.');if(!validBasis(l.basis))throw Error('Invalid charging basis.');const total=lineTotal(l,q);subtotal+=total;const group=profitGroup(l);groups.set(group,(groups.get(group)||0n)+total);if(group==='accommodation')sto+=total;}costs+=subtotal;dayTotals.push(decimal(subtotal));});
 let profit=0n;const profitBreakdown=profitRules(q).map(rule=>{const base=rule.target==='all'?costs:groups.get(rule.target)||0n,addition=(base*money(rule.percent)+5000n)/10000n;profit+=addition;return {target:rule.target,percent:rule.percent,base:decimal(base),profit:decimal(addition)};});const total=costs+profit,people=BigInt(q.adults+q.kids);return {costs:decimal(costs),sto:decimal(sto),profit:decimal(profit),total:decimal(total),perPerson:decimal((total+people/2n)/people),dayTotals,profitBreakdown};
}
export function newQuote(){return {id:crypto.randomUUID(),version:0,schemaVersion:1,kind:'quotation',title:'Safari quotation',bookingId:'',tourId:'',fullName:'',email:'',phone:'',adults:1,kids:0,arrivalDate:'',departureDate:'',safariIdeas:'',additionalDetails:'',currency:'USD',profitPercent:'30',days:[],inclusions:'',exclusions:'',introduction:'',paymentTerms:'',consultant:'',status:'Draft'};}
export function validateOperation(d){
 if(!['quotation','tourCost','rates'].includes(d.kind))throw new Error('Unknown operational record kind.');
 if(!/^[0-9a-f-]{36}$/i.test(d.id))throw new Error('Invalid operational record ID.');
 if(!['USD','EUR','GBP','TZS'].includes(d.currency))throw new Error('Supported costing currencies: USD, EUR, GBP, TZS. No currency conversion is automatic.');
 if(d.kind==='rates'){if(!Array.isArray(d.rooms))throw new Error('Invalid room-category list.');const names=new Set(),ids=new Set();for(const r of d.rooms){if(typeof r.name!=='string'||names.has(r.name.trim().toLowerCase())||ids.has(r.id))throw new Error('Room categories need unique names and IDs.');names.add(r.name.trim().toLowerCase());ids.add(r.id);} if(!['destination','accommodation'].includes(d.entityKind))throw new Error('Invalid rate-card type.');for(const r of d.rooms||[]){if(!r.name.trim())throw new Error('Name each room category.');if(r.amount!=='')money(r.amount);if(!validBasis(r.basis))throw new Error('Invalid rate basis.');}if(d.generalAmount!=='')money(d.generalAmount);if(!validBasis(d.generalBasis))throw new Error('Invalid general rate basis.');}
 else{if(!Array.isArray(d.days))throw new Error('Itinerary days must be a list.');for(const day of d.days)if(!Array.isArray(day.lines)||!day.id)throw new Error('Invalid itinerary cost day.');if(d.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email))throw new Error('Enter a valid customer email.');for(const key of ['arrivalDate','departureDate'])if(d[key]&&(!/^\d{4}-\d{2}-\d{2}$/.test(d[key])||Number.isNaN(Date.parse(d[key]+'T00:00:00Z'))||new Date(d[key]+'T00:00:00Z').toISOString().slice(0,10)!==d[key]))throw new Error('Invalid '+key);if(!d.title?.trim())throw new Error('Title is required.');if(!Number.isInteger(d.adults)||d.adults<0||!Number.isInteger(d.kids)||d.kids<0||d.adults+d.kids<1)throw new Error('Enter whole-number traveller counts and at least one traveller.');validateProfit(d);for(const day of d.days||[])for(const l of day.lines||[]){if(l.amount!=='')money(l.amount);if(l.profitGroup!==undefined&&typeof l.profitGroup!=='string')throw new Error('Invalid cost group.');if(typeof l.label!=='string'||!['other','accommodation'].includes(l.category))throw new Error('Invalid cost label/category.');if(!validBasis(l.basis))throw new Error('Invalid fee basis.');if(!Number.isInteger(l.quantity)||l.quantity<0)throw new Error('Quantity must be a nonnegative whole number.');}if(d.arrivalDate&&d.departureDate&&d.departureDate<d.arrivalDate)throw new Error('Departure is before arrival.');}
}
