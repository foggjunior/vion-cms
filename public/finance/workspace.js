
const pages=['Dashboard','Expenses','Other Income','Revenue','Invoices','Reports','Loans','Settings'];
const categories=['Administration','Operational','General','Tour'];
const admin=['Staff salary','Licences','Tools / subscriptions','Internet','Stationery','Water','Electricity'];
const tripCosts=['Guide allowance','Fuel','Accommodation','Park fees','Child park fees','Concession fees','Car permit','Crater fees'];
const fmt=n=>new Intl.NumberFormat('en-TZ',{style:'currency',currency:'TZS',maximumFractionDigits:0}).format(n);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const dateMonth=document.querySelector('#month'), view=document.querySelector('#view');
const currentMonth=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Dar_es_Salaam',year:'numeric',month:'2-digit'}).format(new Date());
dateMonth.value=currentMonth;
const trips=[];
const rows=[];
let page='Dashboard';
const sum=items=>items.reduce((total,row)=>total+row.amount,0);
const scoped=month=>rows.filter(row=>row.date.startsWith(month));
const totals=items=>({revenue:sum(items.filter(r=>r.kind==='Revenue')),other:sum(items.filter(r=>r.kind==='Other Income')),out:sum(items.filter(r=>r.kind==='Expenses'))});
const field=(label,name,type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" ${extra}></label>`;
const select=(label,name,options)=>`<label>${label}<select name="${name}">${options.map(o=>{const [value,label]=Array.isArray(o)?o:[o,o];return `<option value="${esc(value)}">${esc(label)}</option>`;}).join('')}</select></label>`;
const tripSelect=()=>select('Tour','trip',trips.map(t=>[t.id,t.name]));
const date=label=>field(label,'date','date',`required value="${dateMonth.value || currentMonth}-01"`);
const money=()=>field('Amount','amount','number','required min="0.01" step="0.01"');
const method=()=>select('Payment method','method',['Bank transfer','Cash','Card','Mobile money']);
const table=(headers,body,empty='No records for this month.')=>body.length?`<div class="scroll"><table><thead><tr>${headers.map(h=>'<th scope="col">'+h+'</th>').join('')}</tr></thead><tbody>${body.map(r=>'<tr>'+r.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('')}</tbody></table></div>`:`<p class="muted">${empty}</p>`;
const entries=items=>table(['Date','Entry','Category / payment','Origin','Amount'],items.map(r=>[r.date,r.name,[r.category,r.type||r.stage].filter(Boolean).join(' / '),r.currency==='USD'?`USD ${r.original} × ${r.rate}`:'TZS',fmt(r.amount)]));
const metric=(label,value)=>`<div class="metric">${label}<strong>${fmt(value)}</strong></div>`;
function dashboard(items){
 const t=totals(items),incoming=t.revenue+t.other,net=incoming-t.out;
 const end=new Date((dateMonth.value||currentMonth)+'-01T12:00:00Z');
 const points=Array.from({length:6},(_,i)=>{const d=new Date(end);d.setUTCMonth(d.getUTCMonth()+i-5);return [d.toISOString().slice(0,7),d.toLocaleString('en',{month:'short',timeZone:'UTC'})];}).map(([key,label])=>{const m=totals(scoped(key));return {label,in:m.revenue+m.other,out:m.out};});
 const max=Math.max(1,...points.flatMap(p=>[p.in,p.out]));
 const share=incoming+t.out?incoming/(incoming+t.out)*100:0;
 return `<div class="cards">${metric('Tour revenue received',t.revenue)}${metric('Other income received',t.other)}${metric('Expenses paid',t.out)}</div>
 <div class="grid"><section class="panel"><h2>Cash flow</h2><p><strong>${fmt(net)}</strong> <span class="muted">net cash this month</span></p><div class="bars">${points.map(p=>`<div class="month"><div class="pair"><div class="bar" style="height:${p.in/max*100}%" title="Received ${fmt(p.in)}"></div><div class="bar out" style="height:${p.out/max*100}%" title="Paid ${fmt(p.out)}"></div></div>${p.label}</div>`).join('')}</div><p class="muted">Dark · received &nbsp; Gold · paid</p></section>
 <section class="panel"><h2>Profit &amp; loss</h2><div class="ring" style="background:conic-gradient(#9eb18b ${share}%,#e7bd61 0)"><span>${fmt(net)}</span></div><p>Cash basis · receipts vs expenses</p><p>Received ${fmt(incoming)}<br>Paid ${fmt(t.out)}</p></section></div><section class="panel"><h2>Recent transactions</h2>${entries([...items].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6))}</section>`;
}
function expenseList(items){
 if(!items.length)return '<p class="muted">No expenses for this month.</p>';
 return `<div class="scroll"><table><thead><tr>${['Date paid','Expense','Type','Amount','Actions'].map(label=>`<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>
 ${items.map(row=>{
  const index=rows.indexOf(row);
  const edit=row.trip?`data-edit-trip="${esc(row.trip)}" data-focus-cost="${esc(row.type)}"`:`data-edit-expense="${index}"`;
  const cells=[row.date,row.name,row.type||row.category,fmt(row.amount)];
  return `<tr>${cells.map(cell=>`<td>${esc(cell)}</td>`).join('')}<td><div class="checks">
  <button type="button" data-preview-expense="${index}" aria-label="Preview ${esc(row.name)}">Preview</button>
  <button type="button" ${edit} aria-label="Edit ${esc(row.name)}">Edit</button></div></td></tr>`;
 }).join('')}</tbody></table></div>`;
}
function expenseDialog(list){
 const dialog=document.querySelector('#expense-preview');
 dialog.querySelector('#expense-preview-list').hidden=!list;
 dialog.querySelector('dl').hidden=list;
 return dialog;
}
function previewExpenseList(category,type){
 const dialog=expenseDialog(true);
 const items=scoped(dateMonth.value).filter(row=>row.kind==='Expenses'&&row.category===category&&(!type||row.type===type));
 dialog.querySelector('h2').textContent=type||category+' expenses';
 dialog.querySelector('#expense-preview-list').innerHTML=`<div class="preview-summary"><span>${esc(dateMonth.value)} · ${items.length} ${items.length===1?'expense':'expenses'}</span><strong>${fmt(sum(items))}</strong></div>${
  category==='Tour'&&type===undefined?tripList():expenseList(items)
 }`;
 if(!dialog.open)dialog.showModal();
}
function previewExpense(row){
 const dialog=expenseDialog(false);
 dialog.querySelector('h2').textContent='Expense details';
 const trip=trips.find(item=>item.id===row.trip);
 const fields=[['Name',row.name],['Category',row.category],['Expense type',row.type],
  ['Tour',trip?.name],['Description',row.description],['Date paid',row.date],
  ['Amount',fmt(row.amount)],['Original amount',row.currency==='USD'?`USD ${row.original}`:null],
  ['Exchange rate',row.currency==='USD'?`${row.rate} TZS per USD`:null],
  ['Payment method',row.method],['Comment',row.comment],['Expiry / due date',row.expiry],
  ['Status',row.expiry?(row.expiry<new Date().toISOString().slice(0,10)?'Expired':'Valid'):null]];
 dialog.querySelector('dl').innerHTML=fields.filter(([,value])=>value!==undefined&&value!==null&&value!=='')
  .map(([label,value])=>`<dt>${label}</dt><dd>${esc(value)}</dd>`).join('');
 if(!dialog.open)dialog.showModal();
}
let expensePage=null, expenseCategory=null, formScreen=null;
function expenses(items){
 const paid=items.filter(r=>r.kind==='Expenses');
 if(expensePage){
  const {category,type}=expensePage;
  const tripPage=category==='Tour';
  const group=paid.filter(r=>r.category===category&&(!type||r.type===type));
  const heading=type||category+' expenses';
  return `<button type="button" data-expense-back>← ${tripPage?'All expenses':'Back to '+esc(category)}</button>
   <section class="expense-summary"><div><h2>${esc(heading)}</h2><p>Total paid in the selected month</p></div><strong>${fmt(sum(group))}</strong></section>
   <section class="panel expense-category"><div class="row category-heading"><h2>${tripPage?'Tour trips':'Expense records'}</h2><div class="checks"><button type="button" data-preview-category="${esc(category)}" ${tripPage?'':`data-preview-type="${esc(type)}"`}>Preview</button>
   <button type="button" ${tripPage?'data-new-trip':`data-new-expense="${category}" data-type="${esc(type)}"`}>${tripPage?'Add tour trip':'Add expense'}</button></div></div>${tripPage?tripList():''}</section>`;
 }
 if(expenseCategory){
  const group=paid.filter(r=>r.category===expenseCategory);
  const types=expenseCategory==='Administration'?admin:[''];
  return `<button type="button" data-expense-back>← All expenses</button>
   <section class="expense-summary"><h2>${esc(expenseCategory)}</h2><strong>${fmt(sum(group))}</strong></section>
   <section class="panel expense-category"><h2>Expense types</h2><div class="expense-links">${types.map(type=>
    `<div class="row expense-type-row"><span>${esc(type|| (expenseCategory==='Tour'?'Tour trips':expenseCategory+' expenses'))}</span>
     <strong>${fmt(sum(group.filter(row=>!type||row.type===type)))}</strong>
     <button type="button" data-open-expense="${esc(expenseCategory)}" data-type="${esc(type)}">Open expense</button></div>`
   ).join('')}</div></section>
   <div class="row"><button type="button" data-preview-category="${esc(expenseCategory)}">Preview expenses</button></div>`;
 }
 return `<section class="expense-summary"><div><h2>Monthly expenses</h2><p>Total paid in the selected month</p></div><strong>${fmt(sum(paid))}</strong></section>
 <div class="expense-overview">${categories.map(category=>`<article class="panel expense-card"><h2>${category}</h2><strong>${fmt(sum(paid.filter(r=>r.category===category)))}</strong>
 <button type="button" data-view-category="${category}" aria-label="View ${category} expenses">View</button></article>`).join('')}</div>`;

}
function tripList(){
 const matching=trips.filter(trip=>trip.end.startsWith(dateMonth.value)||scoped(dateMonth.value).some(row=>row.trip===trip.id));
 if(!matching.length)return '<p>No trips for this month.</p>';
 return `<div class="scroll"><table><thead><tr>${['Trip','Cash received','Expenses paid','Cash surplus','Actions'].map(label=>`<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>
 ${matching.map(trip=>{
  const total=totals(rows.filter(row=>row.trip===trip.id));
  return `<tr><td>${esc(trip.name)}</td><td>${fmt(total.revenue)}</td><td>${fmt(total.out)}</td><td>${fmt(total.revenue-total.out)}</td><td><div class="checks"><button data-preview-trip="${esc(trip.id)}">Preview</button><button data-edit-trip="${esc(trip.id)}">Edit</button></div></td></tr>`;
 }).join('')}</tbody></table></div>`;
}
function previewTrip(trip){
 const dialog=expenseDialog(false);
 dialog.querySelector('h2').textContent=trip.name;
 const fields=[['Trip type',trip.type],['Dates',trip.start+' to '+trip.end],['Guest count',trip.guests],['Guest names',trip.guestNames],['Guide',trip.guide],['Guide contact',trip.contact],['Agreed price',agreedPriceLabel(trip)],...rows.filter(row=>row.trip===trip.id&&row.kind==='Expenses').map(row=>[row.type,fmt(row.amount)+' · '+row.date])];
 dialog.querySelector('dl').innerHTML=fields.map(([label,value])=>`<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('');
 if(!dialog.open)dialog.showModal();
}
function resetExpenseEditor(){
 editingTrip=null;
 editingExpense=expensePage&&expensePage.category!=='Tour'
  ? {...expensePage,date:dateMonth.value+'-01'}:null;
}
function revenue(items){
 return `<section class="panel"><h2>Tour performance</h2>${table(['Tour','Agreed price','Cash received','Balance due','Expenses paid','Cash surplus'],trips.map(t=>{const linked=rows.filter(r=>r.trip===t.id),x=totals(linked);return [t.name,agreedPriceLabel(t),fmt(x.revenue),fmt(Math.max(0,t.price-x.revenue)),fmt(x.out),fmt(x.revenue-x.out)];}))}</section>
 <section class="panel expense-category"><div class="row"><h2>Tour payments received</h2><button data-form="payment">Record tour payment</button></div>${entries(items.filter(r=>r.kind==='Revenue'))}</section>
 <section class="panel expense-category"><div class="row"><h2>Tour trips</h2><button data-new-trip>Add tour trip</button></div>${tripList()}</section>`;
}
function transactionEditor(kind){
 const payment=kind==='payment';
 const label=payment?'Record tour payment':'Record other income';
 const details=payment?tripSelect()+select('Payment stage','stage',['Deposit','Balance']):field('Source','name','text','required');
 return `<section class="panel expense-editor"><h2>${label}</h2><form id="${kind}">
 ${details}${date('Date received')}${money()}${method()}${payment?field('Payment reference','reference'):''}
 <div class="wide form-actions"><button>${label}</button><button type="button" data-cancel>Cancel</button></div></form></section>`;

}
let editingExpense=null, editingTrip=null;
const renewable=['Licences','Tools / subscriptions','Internet'];
const moneyFields=(prefix='', row={})=>`${field('Amount',prefix+'amount','number','min="0" step="0.01" value="'+esc(row.original??row.amount??'')+'"')}${select('Currency',prefix+'currency',row.currency==='USD'?['USD','TZS']:['TZS','USD'])}<div data-fx>${field('TZS per USD',prefix+'rate','number','min="0.01" step="0.01" value="'+esc(row.rate??'')+'"')}<output></output></div>`;
const filled=(label,key,row,type='text',required=false)=>field(label,key,type,`value="${esc(row[key]??'')}" ${required?'required':''}`);
function expenseEditor(){
 const r=editingExpense||{category:'Administration',type:admin[0],date:dateMonth.value+'-01'};
 const types=r.category==='Administration'?admin:[];
 return `<section class="panel expense-editor"><h2>${editingExpense?.index!==undefined?'Edit':'Add'} ${esc(r.type||r.category+' expense')}</h2><form id="expense"><h3 class="wide">Expense details</h3>${expensePage?`<input type="hidden" name="category" value="${esc(r.category)}"><input type="hidden" name="type" value="${esc(r.type)}">`:`${select('Category','category',categories.filter(c=>c!=='Tour'))}${types.length?select('Expense type','type',types):''}`}
 ${filled(r.type==='Staff salary'?'Staff name':r.category==='General'?'Product name':'Name','name',r,'text',true)}
 ${r.type==='Staff salary'?'':filled('Description','description',r)}
 ${filled('Date paid','date',r,'date',true)}<h3 class="wide">Payment details</h3><div class="wide form-grid money-panel" data-money="">${moneyFields('',r)}</div>${method()}${filled('Comment','comment',r)}
 ${renewable.includes(r.type)?filled('Expiry / due date','expiry',r,'date',true):''}
 <div class="wide form-actions"><button>Save expense</button> ${editingExpense?'<button type="button" data-cancel>Cancel</button>':''}</div></form></section>`;
}
const agreedPriceLabel=trip=>trip.priceCurrency==='USD'
 ? `USD ${trip.priceOriginal} (${fmt(trip.price)})`
 : fmt(trip.price);
const agreedPriceTZS=(amount,currency,rate)=>currency==='USD'?Math.round(Number(amount)*Number(rate)):Number(amount);
function tripEditor(){
 const t=editingTrip||{};
 const costs=rows.filter(r=>r.kind==='Expenses'&&r.trip===t.id);
 return `<section class="panel expense-editor"><h2>${t.id?'Edit tour trip':'Add tour trip'}</h2><form id="trip"><h3 class="wide">Trip details</h3>
 ${filled('Tour name','name',t,'text',true)}${select('Trip type','type',['Day trip','Multi-day trip'])}
 <div class="wide agreed-price-fields">${field('Agreed trip price','price','number',`required min="0" step="0.01" value="${esc(t.priceOriginal??t.price??'')}"`)}
 ${select('Agreed price currency','priceCurrency',t.priceCurrency==='USD'?['USD','TZS']:['TZS','USD'])}</div>
 <div data-price-fx hidden>${field('Agreed price · TZS per USD','priceRate','number',`min="0.01" step="0.01" value="${esc(t.priceRate??'')}"`)}<output id="agreed-price-tzs" aria-live="polite"></output></div>
 ${filled('Start date','start',t,'date',true)}${filled('End date','end',t,'date',true)}
 <h3 class="wide">Guests and guide</h3>
 ${field('Guest count','guests','number',`required min="1" step="1" value="${esc(t.guests??'')}"`)}
 ${filled('Guest names','guestNames',t,'text',true)}<div class="wide guide-fields">${filled('Guide name','guide',t,'text',true)}${filled('Guide contact','contact',t,'tel',true)}</div>
 <div class="wide checks"><label><input type="checkbox" name="children" ${t.children?'checked':''}> Children travelling</label><label><input type="checkbox" name="crater" ${t.crater?'checked':''}> Ngorongoro Crater visit</label><label data-day-stay hidden><input type="checkbox" name="dayAccommodation" ${t.dayAccommodation||costs.some(row=>t.type==='Day trip'&&row.type==='Accommodation')?'checked':''}> Guests need accommodation</label></div>
 <h3 class="wide">Trip expenses</h3>
 ${[...new Set([...tripCosts,...costs.map(r=>r.type).filter(type=>typeof type==='string'&&type.trim()&&type.trim().toLowerCase()!=='staff salary')])].flatMap(type=>{
 const matches=costs.filter(r=>r.type===type);
 return (matches.length?matches:[{}]).map(r=>({type,r}));
 }).map(({type,r},i)=>{
 const prefix='cost'+i+'_';
 return `<div class="wide form-grid trip-cost-card" role="group" aria-labelledby="${prefix}title" data-money="${prefix}" data-cost="${esc(type)}"><h4 id="${prefix}title" class="wide">${esc(type)}</h4>${moneyFields(prefix,r)}${filled('Date paid',prefix+'date',{[prefix+'date']:r.date},'date')}${select('Payment method',prefix+'method',[...new Set([r.method||'Bank transfer','Bank transfer','Cash','Card','Mobile money'])])}${filled('Comment',prefix+'comment',{[prefix+'comment']:r.comment})}</div>`;
 }).join('')}
 <div class="wide money-panel" aria-live="polite" id="trip-totals"></div><div class="wide"><button>Save trip and expenses</button> ${editingTrip?'<button type="button" data-cancel>Cancel</button>':''}</div></form></section>`;
}
function updateMoney(form){
 let total=0;
 const dayTrip=form.elements.type?.value==='Day trip';
 const stayControl=form.querySelector('[data-day-stay]');
 if(stayControl)stayControl.hidden=!dayTrip;
 for(const box of form.querySelectorAll('[data-money]')){
  const key=box.dataset.money, type=box.dataset.cost;
  box.hidden=(type==='Accommodation'&&dayTrip&&!form.elements.dayAccommodation?.checked)||(type==='Child park fees'&&!form.elements.children.checked)||(type==='Crater fees'&&!form.elements.crater.checked);
  box.querySelectorAll('input,select').forEach(input=>input.disabled=box.hidden);
  const amount=form.elements[key+'amount'], currency=form.elements[key+'currency'],rate=form.elements[key+'rate'];
  const usd=currency.value==='USD';
  box.querySelector('[data-fx]').hidden=!usd;
  rate.required=!box.hidden&&usd&&amount.value!=='';
  if(type) form.elements[key+'date'].required=!box.hidden&&amount.value!=='';
  const value=usd?Math.round(Number(amount.value)*Number(rate.value)):Number(amount.value);
  box.querySelector('output').value=usd&&rate.value?fmt(value):'';
  if(!box.hidden) total+=value;
 }
 const summary=form.querySelector('#trip-totals');
 if(summary){
  const {price,priceCurrency,priceRate}=form.elements;
  const usd=priceCurrency.value==='USD';
  form.querySelector('[data-price-fx]').hidden=!usd;
  priceRate.disabled=!usd;
  priceRate.required=usd;
  const ready=price.value!==''&&(!usd||Number(priceRate.value)>0);
  const amount=agreedPriceTZS(price.value,priceCurrency.value,priceRate.value);
  form.querySelector('#agreed-price-tzs').value=usd&&ready?fmt(amount):'';
  summary.textContent=`Total expenses ${fmt(total)} · ${ready?'Estimated trip profit '+fmt(amount-total):'Enter the agreed price and any required exchange rate to calculate profit.'}`;
 }
}
function attachForm(){
 const f=view.querySelector('#expense, #trip');
 if(!f)return;
 if(f.id==='expense'){
  f.elements.category.value=editingExpense.category;
  if(f.elements.type)f.elements.type.value=editingExpense.type||'';
  f.elements.amount.required=true;
  if(editingExpense.method)f.elements.method.value=editingExpense.method;
  f.addEventListener('change',event=>{
   if(['category','type'].includes(event.target.name)){
    Object.assign(editingExpense,Object.fromEntries(new FormData(f)));
    if(event.target.name==='category')editingExpense.type=editingExpense.category==='Administration'?admin[0]:'';
    render();
   }
  });
 }else if(editingTrip)f.elements.type.value=editingTrip.type;
 f.addEventListener('input',()=>updateMoney(f));
 if(f.id==='trip')f.elements.type.addEventListener('change',()=>updateMoney(f));
 updateMoney(f);
}
const reportFilters={period:'Month',start:'',end:'',scope:'All expenses',category:'',expenseType:'',expenseName:''};
const periodInputs={'Day':'date','Date range':'date','Month':'month','Month range':'month','Year':'number'};
const lastDay=month=>{
 const [year,value]=month.split('-').map(Number);
 return month+'-'+new Date(Date.UTC(year,value,0)).getUTCDate();
};
function reportData(){
 const {period,start,end,scope,category,expenseType,expenseName}=reportFilters;
 let from=start,to=period.includes('range')?end:start;
 if(period==='Month'||period==='Month range'){from=start+'-01';to=lastDay(to);}
 if(period==='Year'){from=start+'-01-01';to=start+'-12-31';}
 const expected=period==='Year'?/^\d{4}$/:period.includes('Month')?/^\d{4}-\d{2}$/:/^\d{4}-\d{2}-\d{2}$/;
 if(!expected.test(start)||(period.includes('range')&&!expected.test(end))||from>to)return null;
 const kind=scope==='Revenue'?'Revenue':scope==='Other Income'?'Other Income':'Expenses';
 const items=rows.filter(row=>row.date>=from&&row.date<=to&&row.kind===kind&&
  (scope!=='Expense category'||row.category===category)&&
  (scope!=='Expense type'||(row.category===category&&row.type===expenseType))&&
  (kind!=='Expenses'||!expenseName.trim()||row.name.toLowerCase().includes(expenseName.trim().toLowerCase())))
  .sort((a,b)=>a.date.localeCompare(b.date));
 const heading=scope==='Expense type'?expenseType:scope==='Expense category'?category+' expenses':scope;
 const lines=items.map(row=>[row.date,row.name,[row.category,row.type||row.stage].filter(Boolean).join(' / '),row.method||'',row.currency||'TZS',row.original??row.amount,row.currency==='USD'?row.rate:'',row.amount]);
 return {from,to,heading,lines,total:sum(items)};
}
const reportColumns=['Date','Entry','Category / type','Payment method','Currency','Original amount','TZS per USD','Amount (TZS)'];
function reports(){
 const f=reportFilters, input=periodInputs[f.period], ranged=f.period.includes('range');
 const scopeOptions=['All expenses','Expense category','Expense type','Revenue','Other Income'];
 const showCategory=f.scope.startsWith('Expense ');
 const report=reportData();
 return `<section class="panel expense-editor report-controls"><h2>Build a report</h2><form id="report-filters">
 ${select('Report scope','scope',scopeOptions)}${showCategory?select('Expense category','category',f.scope==='Expense type'?['Administration','Tour']:categories):''}
 ${f.scope==='Expense type'?select('Expense type','expenseType',f.category==='Tour'?tripCosts:admin):''}
 ${f.scope!=='Revenue'&&f.scope!=='Other Income'?field('Expense name contains (optional)','expenseName','text',`value="${esc(f.expenseName)}"`):''}
 ${select('Period','period',Object.keys(periodInputs))}
 ${field(ranged?'Start':f.period,'start',input,`required value="${esc(f.start)}" ${input==='number'?'min="1900" max="9999" step="1"':''}`)}
 ${ranged?field('End','end',input,`required value="${esc(f.end)}"`):''}
 <div class="wide form-actions"><button type="button" data-print-report ${report?'':'disabled'}>Print / Save as PDF</button>
 <button type="button" data-export-report ${report?'':'disabled'}>Download Excel (.xlsx)</button></div></form></section>
 ${report?`<section class="panel" id="report-sheet"><p>Vion Africa Travel · Finance</p><h2>${esc(report.heading)}</h2>
 <p>${report.from} to ${report.to} · Cash basis · ${report.lines.length} entries</p><p><strong>Total ${fmt(report.total)}</strong></p>
 ${table(reportColumns,report.lines.map(line=>[...line.slice(0,7),fmt(line[7])]),'No matching transactions.')}</section>`:
 '<p role="status">Choose a valid reporting period. The end must be on or after the start.</p>'}`;
}
function attachReports(){
 const form=view.querySelector('#report-filters');
 for(const key of ['period','scope','category','expenseType']){
  if(form.elements[key])form.elements[key].value=reportFilters[key];
 }
 form.addEventListener('submit',event=>event.preventDefault());
 form.addEventListener('change',event=>{
  const previous={...reportFilters};
  Object.assign(reportFilters,Object.fromEntries(new FormData(form)));
  if(previous.period!==reportFilters.period){
   const month=dateMonth.value;
   reportFilters.start=reportFilters.period==='Year'?month.slice(0,4):reportFilters.period.includes('Month')?month:month+'-01';
   reportFilters.end=reportFilters.start;
  }
  if(reportFilters.scope==='Expense type'&&!['Administration','Tour'].includes(reportFilters.category))reportFilters.category='Administration';
  if(!reportFilters.category)reportFilters.category='Administration';
  const types=reportFilters.category==='Tour'?tripCosts:admin;
  if(!types.includes(reportFilters.expenseType))reportFilters.expenseType=types[0];
  const key=event.target.name;
  render();
  view.querySelector('#report-filters').elements[key]?.focus({preventScroll:true});
 });
}
const xmlEscape=value=>esc(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
function excelReport(report){
 const grid=[['Vion Africa Travel',report.heading],['From',report.from,'To',report.to],['Total (TZS)',report.total],[],reportColumns,...report.lines];
 const worksheet=grid.map((line,index)=>`<row r="${index+1}">${line.map((value,i)=>{
  const address=String.fromCharCode(65+i)+(index+1);
  return typeof value==='number'?'<c r="'+address+'"><v>'+value+'</v></c>':
   `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
 }).join('')}</row>`).join('');
 const files={
  '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Finance report" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/worksheets/sheet1.xml':`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="13" customWidth="1"/><col min="2" max="4" width="26" customWidth="1"/><col min="5" max="8" width="18" customWidth="1"/></cols><sheetData>${worksheet}</sheetData></worksheet>`
 };
 return new Blob(zipStore(files),{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
// XLSX is an Open XML package. Store its small XML files in a ZIP without compression.
function zipStore(files){
 const encoder=new TextEncoder(), local=[],central=[];
 const bytes=(size,values)=>{
  const buffer=new ArrayBuffer(size),view=new DataView(buffer);
  for(const [offset,length,value] of values)length===2?view.setUint16(offset,value,true):view.setUint32(offset,value,true);
  return buffer;
 };
 let offset=0,directorySize=0;
 for(const [path,content] of Object.entries(files)){
  const name=encoder.encode(path),data=encoder.encode(content);
  let crc=-1;
  for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  crc=(~crc)>>>0;
  local.push(bytes(30,[[0,4,0x04034b50],[4,2,20],[12,2,33],[14,4,crc],[18,4,data.length],[22,4,data.length],[26,2,name.length]]),name,data);
  central.push(bytes(46,[[0,4,0x02014b50],[4,2,20],[6,2,20],[14,2,33],[16,4,crc],[20,4,data.length],[24,4,data.length],[28,2,name.length],[42,4,offset]]),name);
  offset+=30+name.length+data.length;directorySize+=46+name.length;
 }
 const count=Object.keys(files).length;
 return [...local,...central,bytes(22,[[0,4,0x06054b50],[8,2,count],[10,2,count],[12,4,directorySize],[16,4,offset]])];
}
function render(){
 document.querySelector('#title').textContent=page;
 document.querySelector('nav').innerHTML=pages.map(p=>`<button ${p===page?'aria-current="page"':''} data-page="${p}">${p}</button>`).join('');
 if(formScreen){
  const editor=formScreen==='expense'?expenseEditor():formScreen==='trip'?tripEditor():transactionEditor(formScreen);
  view.innerHTML='<button type="button" data-cancel class="back-to-list">← Back to list</button>'+editor;
  attachForm();
  return;
 }
 const items=scoped(dateMonth.value), t=totals(items);
 if(page==='Dashboard')view.innerHTML=dashboard(items);
 else if(page==='Expenses'){view.innerHTML=expenses(items);}
 else if(page==='Revenue')view.innerHTML=revenue(items);
 else if(page==='Other Income')view.innerHTML=`<section class="panel expense-category"><div class="row"><h2>Income received</h2><button data-form="income">Add income</button></div>${entries(items.filter(r=>r.kind==='Other Income'))}</section>`;
 else if(page==='Reports'){
  if(!reportFilters.start)reportFilters.start=dateMonth.value;
  view.innerHTML=reports();
  attachReports();
 }
 else if(page==='Invoices')view.innerHTML=`<section class="panel"><h2>Tour balances</h2>${table(['Tour','Agreed price','Received','Outstanding'],trips.map(t=>{const paid=totals(rows.filter(r=>r.trip===t.id)).revenue;return [t.name,agreedPriceLabel(t),fmt(paid),fmt(Math.max(0,t.price-paid))];}))}<p class="muted">Invoice creation and sending are planned for integration.</p></section>`;
 else if(page==='Loans')view.innerHTML='<section class="panel"><h2>Loan register</h2><p class="muted">Planned for integration. Track lender, principal, interest, repayment dates and outstanding balance.</p></section>';
 else view.innerHTML='<section class="panel"><h2>Finance settings</h2><p>Reporting currency · TZS</p><p>USD expenses use the TZS-per-USD rate entered by the accountant.</p><p>Access · Accounting staff and super admin</p><p class="muted">Changes are saved in the shared Finance workspace.</p></section>';

}
document.querySelector('nav').addEventListener('click',e=>{if(!saving&&e.target.dataset.page){page=e.target.dataset.page;formScreen=null;expensePage=null;expenseCategory=null;resetExpenseEditor();render();}});
dateMonth.addEventListener('change',()=>{if(!dateMonth.value)dateMonth.value=currentMonth;if(!formScreen){resetExpenseEditor();render();}});
function handleFinanceClick(event){
 if(saving)return;
 const b=event.target.closest('button');if(!b)return;
 if(b.dataset.previewCategory){previewExpenseList(b.dataset.previewCategory,b.dataset.previewType);return;}
 if(b.hasAttribute('data-print-report')){if(reportData())window.print();return;}
 if(b.hasAttribute('data-export-report')){
  const report=reportData();if(!report)return;
  const url=URL.createObjectURL(excelReport(report));
  const link=document.createElement('a');
  link.href=url;link.download=`vion-finance-${report.from}-${report.to}.xlsx`;
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);return;
 }

 if(b.dataset.previewExpense!==undefined){previewExpense(rows[Number(b.dataset.previewExpense)]);return;}
 if(b.dataset.previewTrip){previewTrip(trips.find(trip=>trip.id===b.dataset.previewTrip));return;}
 if(b.dataset.viewCategory){
  expenseCategory=b.dataset.viewCategory;expensePage=expenseCategory==='Tour'?{category:'Tour',type:''}:null;resetExpenseEditor();render();window.scrollTo(0,0);return;
 }
 if(b.dataset.openExpense||b.hasAttribute('data-expense-back')){
  if(b.hasAttribute('data-expense-back')&&(!expensePage||expensePage.category==='Tour'))expenseCategory=null;
  expensePage=b.dataset.openExpense?{category:b.dataset.openExpense,type:b.dataset.type}:null;
  resetExpenseEditor();render();window.scrollTo(0,0);return;
 }
 if(b.hasAttribute('data-cancel')){formScreen=null;resetExpenseEditor();}
 else if(b.dataset.form){formScreen=b.dataset.form;}
 else if(b.hasAttribute('data-new-expense')){formScreen='expense';editingTrip=null;editingExpense={category:b.dataset.newExpense,type:b.dataset.type,date:dateMonth.value+'-01'};}
 else if(b.hasAttribute('data-new-trip')){formScreen='trip';editingExpense=null;editingTrip={};}
 else if(b.dataset.editExpense!==undefined){formScreen='expense';editingTrip=null;editingExpense={...rows[Number(b.dataset.editExpense)],index:Number(b.dataset.editExpense)};}
 else if(b.dataset.editTrip){formScreen='trip';editingExpense=null;editingTrip={...trips.find(t=>t.id===b.dataset.editTrip)};}
 else return;
 if(expenseCategory&&!expensePage&&(b.dataset.editExpense!==undefined||b.dataset.editTrip)){
  expensePage={category:expenseCategory,type:editingExpense?.type||''};
 }
 const dialog=document.querySelector('#expense-preview');
 if(dialog.open)dialog.close();
 render();window.scrollTo(0,0);
 const cost=[...view.querySelectorAll('[data-cost]')].find(box=>box.dataset.cost===b.dataset.focusCost);
 (cost||view.querySelector('#expense, #trip'))?.scrollIntoView({block:'start'});
 cost?.querySelector('input')?.focus({preventScroll:true});
}
view.addEventListener('click',handleFinanceClick);
document.querySelector('#expense-preview').addEventListener('click',handleFinanceClick);
view.addEventListener('submit',async e=>{
 e.preventDefault();const f=e.target,d=Object.fromEntries(new FormData(f)),notice=document.querySelector('#notice');
 if(saving)return;
 if(f.id==='payment'&&!trips.some(t=>t.id===d.trip)){notice.textContent='Add a tour trip first.';return;}
 const previous=structuredClone({rows,trips,editingTrip,editingExpense,month:dateMonth.value});
 if(f.id==='trip'){
  if(d.end<d.start||(d.type==='Day trip'&&d.start!==d.end)){notice.textContent='Check the trip dates. A day trip starts and ends on the same date.';return;}
  const id=editingTrip.id||crypto.randomUUID();
  const trip={id,name:d.name,type:d.type,start:d.start,end:d.end,guests:Number(d.guests),guestNames:d.guestNames,guide:d.guide,contact:d.contact,price:agreedPriceTZS(d.price,d.priceCurrency,d.priceRate),priceCurrency:d.priceCurrency,priceOriginal:Number(d.price),priceRate:d.priceCurrency==='USD'?Number(d.priceRate):null,children:!!d.children,crater:!!d.crater,dayAccommodation:d.type==='Day trip'&&!!d.dayAccommodation};
  if(trip.price<sum(rows.filter(r=>r.kind==='Revenue'&&r.trip===id))){notice.textContent='Agreed price cannot be below the payments already received.';return;}
  const costs=[...f.querySelectorAll('[data-cost]:not([hidden])')].flatMap(box=>{
   const k=box.dataset.money;if(d[k+'amount']==='')return [];
   const original=Number(d[k+'amount']),currency=d[k+'currency'],rate=Number(d[k+'rate']);
   return [{kind:'Expenses',category:'Tour',trip:id,type:box.dataset.cost,name:trip.name,date:d[k+'date'],currency,original,rate,amount:currency==='USD'?Math.round(original*rate):original,method:d[k+'method'],comment:d[k+'comment']}];
  });
  const index=trips.findIndex(t=>t.id===id);
  if(index<0)trips.push(trip);else trips[index]=trip;
  for(let i=rows.length-1;i>=0;i--)if(rows[i].kind==='Expenses'&&rows[i].trip===id&&typeof rows[i].type==='string'&&rows[i].type.trim()&&rows[i].type.trim().toLowerCase()!=='staff salary')rows.splice(i,1);
  rows.push(...costs);dateMonth.value=trip.end.slice(0,7);editingTrip=null;
 }else{
  const kind=f.id==='expense'?'Expenses':f.id==='income'?'Other Income':'Revenue';
  const trip=trips.find(t=>t.id===d.trip);
  const amount=d.currency==='USD'?Math.round(Number(d.amount)*Number(d.rate)):Number(d.amount);
  if(kind==='Revenue'&&amount>trip.price-totals(rows.filter(r=>r.trip===trip.id)).revenue){notice.textContent='This payment exceeds the outstanding tour balance.';return;}
  const record={...d,kind,name:d.name||trip?.name,original:Number(d.amount),amount};
  if(kind==='Expenses'&&!renewable.includes(d.type))delete record.expiry;
  if(kind==='Expenses'&&editingExpense.index!==undefined)rows[editingExpense.index]=record;else rows.push(record);
  editingExpense=null;dateMonth.value=d.date.slice(0,7);
 }
 saving=true;
 const submit=f.querySelector('button[type=submit],button:not([type])');
 if(submit)submit.disabled=true;
 notice.textContent='Saving…';
 try{
  const result=await ledgerRequest({version,rows,trips});
  version=result.version;
  formScreen=null;
  if(expensePage)resetExpenseEditor();
  notice.textContent='Saved.';
  render();
 }catch(error){
  editingTrip=previous.editingTrip;editingExpense=previous.editingExpense;dateMonth.value=previous.month;
  rows.splice(0,rows.length,...previous.rows);
  trips.splice(0,trips.length,...previous.trips);
  notice.textContent=error.message;
 }finally{
  saving=false;
  if(submit)submit.disabled=false;
 }
});
let version=0,saving=false;
async function ledgerRequest(data){
 const response=await fetch('/api/finance',{cache:'no-store',...(data?{
  method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)
 }:{})});
 const result=await response.json();
 if(!response.ok)throw Error(result.error||'Finance is unavailable.');
 return result;
}
const notice=document.querySelector('#notice');
notice.textContent='Loading finance records…';
ledgerRequest().then(result=>{
 document.querySelector('#workspace-link').hidden=!result.canOpenWorkspace;
 version=result.version;rows.push(...result.rows);trips.push(...result.trips);
 notice.textContent='';render();
}).catch(error=>{notice.textContent=error.message;});

document.querySelector('#finance-signout').addEventListener('click',async event=>{
 const button=event.currentTarget;
 button.disabled=true;
 try{
  const response=await fetch('/api/auth/session',{method:'DELETE'});
  if(!response.ok&&response.status!==401)throw Error('Could not sign out. Please try again.');
  location.assign('/login');
 }catch(error){notice.textContent=error.message;}
 finally{button.disabled=false;}
});
