import {downloadBookingPDF} from '../operations/pdf.js';
import {h,button,linkButton} from '../components/dom.js';
import {fieldWrap,textControl,selectControl} from '../components/fields.js';
import {notice} from '../components/feedback.js';
import {createBookingsRepository,newBooking} from '../storage/bookings-repository.js';

function download(value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=h('a',{href:url,download:'vion-private-bookings-'+new Date().toISOString().slice(0,10)+'.json'});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const date=v=>v?new Date(v).toLocaleString('en-GB',{timeZone:'Africa/Dar_es_Salaam'}):'Not supplied';
const duration=b=>b.arrivalDate&&b.departureDate?Math.round((Date.parse(b.departureDate)-Date.parse(b.arrivalDate))/86400000)+1:null;
function details(b){const rows=[['Full Name',b.fullName],['Email',b.email],['Phone',b.phone],['Adults',b.adults],['Kids',b.kids],['Arrival Date',b.arrivalDate],['Departure Date',b.departureDate],['Duration (Days)',duration(b)],['Type of Tour',b.tourType],['Requested Tour',b.tourName],['Safari Ideas',b.safariIdeas],['Additional Details',b.additionalDetails],['Status',b.status],['Source',b.source],['Website tour reference',b.externalTourId],['Received',date(b.receivedAt)]];return h('div',null,h('dl',{class:'ops-details'},rows.flatMap(([k,v])=>[h('dt',null,k),h('dd',null,v===0?'0':v||'Not supplied')])),b.websiteContext?h('details',null,h('summary',null,'Website planning context'),h('pre',{style:'white-space:pre-wrap;overflow-wrap:anywhere'},JSON.stringify(b.websiteContext,null,2))):null);}
export async function createBookingsView({app,id=null,edit=false}){
 const ws=await app.workspace(),repo=createBookingsRepository(ws);
 let dirty=false,saving=false,alive=true;
 const root=h('section',{class:'panel'}),message=h('p',{role:'status','aria-live':'polite'});
 const view={el:root,title:id?'Booking details':'Bookings',breadcrumb:'Bookings',navGroup:'Bookings',navLabel:'All Bookings',isDirty:()=>dirty,destroy(){alive=false;}};
 const header=(title)=>h('div',{class:'ops-heading'},h('h1',null,title),notice('info','Local operational register only. Use Connect website for staff-authenticated read-only imports, or enter a received request manually. These details are not published to the local site.'));
 if(id||edit){
 let b=id?await repo.get(id):newBooking();
 if(!b){root.append(header('Booking not found'),linkButton('Back to bookings','#/bookings'));return view;}
 const drawDetails=()=>{dirty=false;root.replaceChildren(header('Booking Details'),message,details(b),h('div',{class:'ops-actions'},button('Edit booking',{onClick:drawForm}),button('Generate PDF',{onClick:async()=>{try{await downloadBookingPDF(b);}catch(e){message.textContent=e.message;}}}),linkButton('Quotation',`#/quotations?booking=${b.id}`),linkButton('Back to bookings','#/bookings')),notice('info','Generate PDF downloads the booking details. Quotation creates a separate editable itinerary and costing copy.'));};
 async function drawForm(){
 const model=structuredClone(b),form=h('form',{class:'ops-form'});let revision=0;
 const changed=()=>{dirty=true;revision++;};
 const fields=[['fullName','Full name'],['email','Email'],['phone','Phone'],['adults','Adults'],['kids','Kids'],['arrivalDate','Arrival date'],['departureDate','Departure date'],['tourType','Type of tour'],['safariIdeas','Safari ideas'],['additionalDetails','Additional details']];
 for(const [key,label] of fields){const input=textControl({id:'booking-'+key,value:model[key],multiline:['additionalDetails','safariIdeas'].includes(key),onInput:v=>{model[key]=['adults','kids'].includes(key)?(v.trim()===''?null:Number(v)):v;changed();}});if(['arrivalDate','departureDate'].includes(key))input.type='date';if(['adults','kids'].includes(key)){input.type='number';input.min='0';input.step='1';}if(key==='email')input.type='email';form.append(fieldWrap({id:input.id,label,required:key==='fullName',control:input}));}
 const records=[...((await ws.loadContext()).records.values())].filter(x=>x.kind==='tour');
 const opts=[{value:'',label:'Custom request / no saved tour'},...records.map(x=>({value:x.id,label:x.record.title}))];if(model.tourId&&!records.some(x=>x.id===model.tourId))opts.push({value:model.tourId,label:model.tourName||'Previously selected tour'});
 const tour=selectControl({id:'booking-tour',value:model.tourId,options:opts,onChange:v=>{model.tourId=v;model.tourName=records.find(x=>x.id===v)?.record.title||'';changed();}});form.append(fieldWrap({id:tour.id,label:'Requested saved tour',control:tour}));
 for(const [key,label,values] of [['status','Status',['Not Confirmed','Confirmed','Cancelled']],['source','Source',['Manual entry','Website email (manually entered)','Other platform','Website form data']]]){const input=selectControl({id:'booking-'+key,value:model[key],options:values.map(v=>({value:v,label:v})),onChange:v=>{model[key]=v;changed();}});form.append(fieldWrap({id:input.id,label,control:input}));}
 const save=button('Save booking',{variant:'primary',onClick:async()=>{if(saving)return;if(!form.reportValidity())return;saving=true;save.disabled=true;const at=revision;message.textContent='Saving…';message.className='';try{const saved=await repo.save(model,b.version);b=saved;model.version=saved.version;if(!alive)return;if(at===revision){dirty=false;message.textContent='Booking saved.';if(id)drawDetails();else app.navigate('#/bookings/'+b.id);}else message.textContent='Saved earlier edits. Newer changes still need saving.';}catch(e){message.className='ops-error';message.textContent=e.message;}finally{saving=false;save.disabled=false;}}});
 root.replaceChildren(header(id?'Edit booking':'New booking'),message,form,h('div',{class:'ops-actions'},save,linkButton('Back to bookings','#/bookings')));form.addEventListener('submit',e=>{e.preventDefault();save.click();});
 }
 if(edit)await drawForm();else drawDetails();return view;
 }
 const all=await repo.list(),list=h('div'),search=textControl({id:'booking-search',placeholder:'Search name, email or phone',onInput:renderList});
 function renderList(){const q=search.value.toLowerCase();const filtered=all.filter(b=>[b.fullName,b.email,b.phone].join(' ').toLowerCase().includes(q));list.replaceChildren(filtered.length?h('div',{class:'table-scroll'},h('table',null,h('thead',null,h('tr',null,['S/N','Full name','Email','Phone','Booking date','Actions'].map(v=>h('th',null,v)))),h('tbody',null,filtered.map((b,n)=>h('tr',null,h('td',null,n+1),h('td',null,b.fullName),h('td',null,b.email||'—'),h('td',null,b.phone||'—'),h('td',null,date(b.receivedAt)),h('td',null,h('div',{class:'ops-actions'},linkButton('View booking','#/bookings/'+b.id),linkButton('Quotation','#/quotations?booking='+b.id)))))))):h('p',null,'No bookings found. Website receipt is not connected.'));}
 root.append(header('Bookings'),notice('warning','General CMS backups do not include this operational register yet. Export the separate private booking backup below; it contains customer information.'),h('div',{class:'ops-actions'},linkButton('Add received request','#/bookings/new',{variant:'primary'}),linkButton('Quotation','#/quotations'),linkButton('Connect website','#/bookings/connect'),button('Export private bookings',{onClick:()=>download({format:'vion-private-operations',schemaVersion:1,exportedAt:new Date().toISOString(),entries:all.map(b=>({key:'private-booking:'+b.id,value:b}))})})),fieldWrap({id:search.id,label:'Search bookings',control:search}),list);renderList();return view;
}
