import {h,button} from '../components/dom.js';import {fieldWrap,textControl,selectControl,checkboxField} from '../components/fields.js';import {basisOptions,quantityFor,lineTotal,decimal,line,optional,mandatory,childCostsNeedReview} from './costs.js';
export function dailyCosts({day,index,model,change,redraw,openDays,previousDays=[]}){
 const id='daily-costs-'+day.id,body=h('div',{id,hidden:!openDays.has(day.id),class:'daily-cost-body'}),toggle=button(openDays.has(day.id)?'Close daily costs':'Open daily costs',{onClick:()=>{const open=body.hidden;body.hidden=!open;toggle.setAttribute('aria-expanded',String(open));toggle.querySelector('span').textContent=open?'Close daily costs':'Open daily costs';open?openDays.add(day.id):openDays.delete(day.id);}});toggle.setAttribute('aria-expanded',String(!body.hidden));toggle.setAttribute('aria-controls',id);
 const header=h('div',{class:'daily-cost-heading'},toggle,h('strong',{'data-day-cost-total':day.id},'Daily total: incomplete'));
 body.append(h('p',{class:'field-hint'},'Per adult uses the adult count; Per child uses the child count. Add a child rate when prices differ. Per day charges once on this itinerary day. Room/night and vehicle quantities are entered separately.'));
 if(previousDays.length){
  const select=selectControl({id:id+'-source',options:previousDays.map((source,i)=>({value:source.id,label:'Day '+(i+1)})),value:previousDays.at(-1).id});
  body.append(h('div',{class:'cost-copy-controls'},
   fieldWrap({id:select.id,label:'Copy costs from',control:select}),
   button('Copy all costs',{onClick:()=>{
    const source=previousDays.find(item=>item.id===select.value);
    if(!source)return;
    const hasEdits=day.lines.length!==mandatory.length||day.lines.some((item,i)=>
      item.label!==mandatory[i]||item.amount!==''||!item.included||item.basis!=='trip'||item.quantity!==1
    );
    if(hasEdits&&!confirm('Replace all cost lines for this day?'))return;
    day.lines=source.lines.map(item=>({...item,id:crypto.randomUUID()}));
    day.noChildCharges=false;
    change();redraw();
   }})
  ));
 }
 const addChildCost=(category='other',profitGroup)=>{
  const cost={...line('',category),basis:'kids'};
  if(profitGroup)cost.profitGroup=profitGroup;
  day.lines.push(cost);
  day.noChildCharges=false;
  change();
  redraw();
  document.getElementById('cost-name-'+cost.id)?.focus();
 };
 const noCharges=checkboxField({
  id:id+'-no-child-charges',
  label:'No separate child charges for this day',
  checked:day.noChildCharges,
  onChange:value=>{day.noChildCharges=value;change();}
 });
 noCharges.dataset.noChildCharges='';
 body.append(h('section',{class:'child-cost-controls','data-child-cost-controls':day.id,hidden:!(model.kids>0)},
  h('h4',null,'Child costs'),
  h('p',{'data-child-cost-status':'',class:'field-hint'},'Enter a name and a price per child for each charge.'),
  noCharges,
  button('Add child cost',{onClick:()=>addChildCost()})
 ));
 const rows=day.lines.map(l=>{const field=(label,control)=>fieldWrap({id:control.id,label,control}),key=()=>crypto.randomUUID();const include=h('input',{type:'checkbox',checked:l.included,'aria-label':'Include '+l.label,on:{change:e=>{l.included=e.target.checked;if(l.included&&l.basis==='kids')day.noChildCharges=false;change();}}});
 const name=textControl({id:'cost-name-'+l.id,placeholder:l.basis==='kids'?'Child cost name':undefined,value:l.label,onInput:v=>{l.label=v;change();}}),amount=textControl({id:key(),placeholder:l.basis==='kids'?'Price per child':undefined,value:l.amount,onInput:v=>{l.amount=v;change();}});
 const qty=textControl({id:key(),value:String(quantityFor(l,model)),onInput:v=>{l.quantity=v.trim()===''?null:Number(v);change();}});qty.type='number';qty.min='0';qty.step='1';qty.classList.add('cost-quantity');qty.dataset.day=day.id;qty.dataset.line=l.id;
 const child=button('Add child rate',{'data-add-child-rate':l.id,onClick:()=>addChildCost(l.category,l.profitGroup||l.label)});
 const update=()=>{qty.readOnly=!['roomNight','vehicle'].includes(l.basis);qty.value=String(quantityFor(l,model));child.hidden=l.basis!=='adults'||!(model.kids>0);};
 const basis=selectControl({id:key(),value:l.basis,options:basisOptions(l.basis),onChange:v=>{l.basis=v;if(l.included&&v==='kids')day.noChildCharges=false;update();change();}});update();
 const actions=h('div',{class:'btn-row'},child,button('Remove cost',{onClick:()=>{day.lines.splice(day.lines.indexOf(l),1);change();redraw();}}));
 return h('tr',null,h('td',null,include),h('td',null,field('Cost label',name)),h('td',null,field('Unit cost',amount)),h('td',null,field('Charging basis',basis)),h('td',null,field('Quantity',qty)),h('td',null,actions));});
 body.append(h('div',{class:'table-scroll'},h('table',null,h('thead',null,h('tr',null,['Include','Cost','Rate','Charging basis','Quantity','Actions'].map(t=>h('th',null,t)))),h('tbody',null,rows))),h('div',{class:'ops-actions'},...optional.map(label=>button('+ '+label,{onClick:()=>{day.lines.push(line(label));change();redraw();}})),button('+ Additional cost',{onClick:()=>{day.lines.push(line('Additional cost'));change();redraw();}})));
 return h('section',{class:'daily-cost-panel'},header,body);
}
export function refreshDailyCosts(root, model) {
 for (const day of model.days) {
  let total = 0n;
  let complete = true;
  const needsReview = childCostsNeedReview(day, model);
  const panel = root.querySelector(`[data-child-cost-controls="${day.id}"]`);
  if (panel) {
   panel.hidden = !(model.kids > 0);
   panel.querySelector('[data-child-cost-status]').textContent = needsReview
    ? 'Add child costs or confirm that no child charges apply.'
    : 'Enter a name and a price per child for each charge.';
   const waiver = panel.querySelector('[data-no-child-charges]');
   waiver.hidden = day.lines.some(cost => cost.included && cost.basis === 'kids');
   waiver.querySelector('input').checked = day.noChildCharges === true;
  }
  for (const cost of day.lines) {
   const quantity = root.querySelector(`[data-day="${day.id}"][data-line="${cost.id}"]`);
   if (quantity?.readOnly) quantity.value = String(quantityFor(cost, model));
   const childButton = root.querySelector(`[data-add-child-rate="${cost.id}"]`);
   if (childButton) childButton.hidden = cost.basis !== 'adults' || !(model.kids > 0);
   try {
    total += lineTotal(cost, model);
    if (cost.included && cost.basis === 'kids' && model.kids > 0 && !cost.label.trim()) complete = false;
   } catch {
    complete = false;
   }
  }
  const header = root.querySelector(`[data-day-cost-total="${day.id}"]`);
  if (header) {
   const subtotal = complete ? model.currency+' '+decimal(total) : 'incomplete';
   header.textContent = 'Daily total: '+subtotal+(needsReview?' · child costs to review':'');
  }
 }
}
