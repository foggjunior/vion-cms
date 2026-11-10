import {h,button} from '../components/dom.js';
import {fieldWrap,textControl,selectControl} from '../components/fields.js';
import {openDialog,messageDialog} from '../components/dialog.js';
import {openMediaPicker} from '../components/media-picker.js';
import {createAccommodationService} from './accommodation-service.js';
import {BASIS} from './costs.js';
export async function addAccommodation({ws,ctx,initial={},currency='USD',onEditing=()=>{}}){
 const input={id:crypto.randomUUID(),name:initial.name||'',destinationId:initial.destinationId||'',locationName:initial.locationName||'',overview:initial.overview||'',amenities:[],activities:[],cover:null,gallery:[],pricing:{currency,generalAmount:'',generalBasis:'roomNight',rooms:[]}};
 const canPrice=!ws.actor||['admin','reservations'].includes(ws.actor.role);let busy=false;
 const form=h('form',{class:'quick-accommodation-form'}),status=h('p',{role:'status',class:'field-error',tabindex:-1}),roomRoot=h('div'),mediaStatus=h('p',null,'No images selected.');
 const edit=()=>onEditing();
 const text=(key,label,{multi=false,required=false}={})=>{const id='quick-stay-'+key,control=textControl({id,value:input[key],multiline:multi,rows:3,onInput:v=>{input[key]=v;edit();}});control.required=required;return fieldWrap({id,label,control});};
 const location=selectControl({id:'quick-stay-destination',value:input.destinationId,options:[{value:'',label:'Enter another location'},...[...ctx.records.values()].filter(e=>e.kind==='destination'&&e.record.status!=='archived').map(e=>({value:e.id,label:e.record.title}))],onChange:v=>{input.destinationId=v;edit();}});
 form.append(h('p',null,'Save once to your accommodation list and use it here. New entries are drafts; public website publishing is separate.'),text('name','Accommodation name',{required:true}),fieldWrap({id:location.id,label:'Location / destination',control:location}),text('locationName','Other location (if not listed)'),text('overview','Overview',{multi:true}));
 for(const [key,label] of [['amenities','Amenities (one per line)'],['activities','Activities (one per line)']]){const id='quick-stay-'+key,control=textControl({id,multiline:true,rows:3,onInput:v=>{input[key]=v.split('\n').map(s=>s.trim()).filter(Boolean);edit();}});form.append(fieldWrap({id,label,control}));}
 form.append(h('h3',null,'Media'),button('Choose accommodation images',{onClick:async()=>{const assets=await openMediaPicker({workspace:ws,multiple:true,title:'Accommodation images'});if(!assets)return;input.cover=assets[0]?{assetId:assets[0].id,alt:assets[0].alt||''}:null;input.gallery=assets.slice(1).map(a=>({assetId:a.id,alt:a.alt||''}));mediaStatus.textContent=assets.length+' image(s) selected. The first is the cover.';edit();}}),mediaStatus);
 const rateField=(obj,key,label,options=null)=>{const id='quick-rate-'+crypto.randomUUID(),control=options?selectControl({id,value:obj[key],options,onChange:v=>{obj[key]=v;edit();}}):textControl({id,value:obj[key],onInput:v=>{obj[key]=v;edit();}});return fieldWrap({id,label,control});};
 const bases=Object.entries(BASIS).map(([value,label])=>({value,label}));
 form.append(h('h3',null,'Rooms'+(canPrice?' & private STO pricing':'')));
 if(canPrice)form.append(h('p',null,'Supplier prices stay private. Leave a price blank if unknown; enter 0 only when it is actually free.'),rateField(input.pricing,'currency','Rate currency',['USD','EUR','GBP','TZS'].map(value=>({value,label:value}))),rateField(input.pricing,'generalAmount','General STO price (fallback)'),rateField(input.pricing,'generalBasis','General charging basis',bases));
 const drawRooms=()=>roomRoot.replaceChildren(...input.pricing.rooms.map((r,n)=>h('section',{class:'quick-room'},h('h4',null,'Room '+(n+1)),rateField(r,'name','Room type'),...(canPrice?[rateField(r,'amount','Room STO price'),rateField(r,'basis','Room charging basis',bases)]:[]),button('Remove room',{onClick:()=>{input.pricing.rooms.splice(n,1);edit();drawRooms();}}))));
 form.append(roomRoot,button('Add room type',{onClick:()=>{input.pricing.rooms.push({id:crypto.randomUUID(),name:'',amount:'',basis:'roomNight'});edit();drawRooms();}}),status);
 let modal;const save=async()=>{if(busy||!form.reportValidity())return;busy=true;status.textContent='Saving accommodation…';const controls=[...modal.dialog.querySelectorAll('input,select,textarea,button')];controls.forEach(c=>c.disabled=true);try{const saved=await createAccommodationService(ws).create(structuredClone(input));modal.close(saved);}catch(e){status.textContent=e.message;status.focus();}finally{busy=false;controls.forEach(c=>c.disabled=false);}};
 modal=openDialog({title:'Add accommodation',content:form,wide:true,actions:[{label:'Cancel',value:null},{label:'Save accommodation & use',variant:'primary',onClick:save}]});
 modal.dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});form.addEventListener('submit',e=>{e.preventDefault();save();});form.querySelector('input')?.focus();return modal.result;
}
export async function chooseTourRooms(ed,day){
 if(!day.accommodationIds.length){await messageDialog({title:'Select an accommodation first',body:'Choose a saved accommodation or add a new one for this day.'});return;}
 const selections=structuredClone(day.accommodationRooms||[]),root=h('div');
 for(const id of day.accommodationIds){const accommodation=ed.ctx.records.get(id);if(!accommodation)continue;const rooms=await createAccommodationService(ed.ws).rooms(id),chosen=selections.find(r=>r.accommodationId===id);const select=selectControl({id:'tour-room-'+id,value:chosen?.roomId||'',options:[{value:'',label:'General rate / no room type'},...rooms.map(r=>({value:r.id,label:r.name}))],onChange:value=>{const old=selections.findIndex(r=>r.accommodationId===id);if(old>=0)selections.splice(old,1);const room=rooms.find(r=>r.id===value);if(room)selections.push({accommodationId:id,roomId:room.id,roomName:room.name});}});root.append(fieldWrap({id:select.id,label:accommodation.record.title,control:select}));}
 const modal=openDialog({title:'Room types for this day',content:root,actions:[{label:'Cancel',value:false},{label:'Use room types',variant:'primary',value:true}]});if(await modal.result){day.accommodationRooms=selections.filter(s=>day.accommodationIds.includes(s.accommodationId));ed.changed();ed.refreshSection('itinerary');}
}
