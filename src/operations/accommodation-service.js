// One transaction saves a reusable accommodation and its private room/rate card.
import {CONTEXT_STORES,readContext,RepoError} from '../storage/content-repository.js';
import {STORES,request,runTransaction} from '../storage/idb.js';
import {newRecord,newWorkflow} from '../modules/shared/records.js';
import {uniqueSlug} from '../modules/shared/routes.js';
import {validateDraft,errorsOnly} from '../modules/shared/validation.js';
import {validateOperation} from './costs.js';
const clean=v=>typeof v==='string'?v.trim():'';
export function createAccommodationService(ws){
 if(ws.remote)return ws.remote.accommodationInline;
 return {
  async rooms(id){return runTransaction(ws.db,[STORES.meta],'readonly',async tx=>{const card=(await request(tx.objectStore(STORES.meta).getAll())).find(e=>e.key.startsWith('private-operation:')&&e.value.kind==='rates'&&e.value.entityId===id);return (card?.value.rooms||[]).map(r=>({id:r.id,name:r.name}));});},
  async create(input){
   if(!input||typeof input!=='object')throw new RepoError('validation','Enter accommodation details.');
   if(!/^[0-9a-f-]{36}$/i.test(input.id||''))throw new RepoError('validation','Invalid accommodation reference.');
   const record=newRecord('accommodation',{id:input.id,title:clean(input.name)});
   record.destinationId=input.destinationId||null;record.locationName=clean(input.locationName);
   if(!record.title)throw new RepoError('validation','Accommodation name is required.');
   if(!record.destinationId&&!record.locationName)throw new RepoError('validation','Choose a destination or enter the location.');
   if(!Array.isArray(input.amenities||[])||!Array.isArray(input.activities||[])||!Array.isArray(input.pricing?.rooms||[]))throw new RepoError('validation','Amenities, activities and rooms must be lists.');
   record.description=clean(input.overview);record.amenities=(input.amenities||[]).map(clean).filter(Boolean);record.activities=(input.activities||[]).map(clean).filter(Boolean);
   record.cover=input.cover||null;record.gallery=input.gallery||[];record.publicPageEnabled=false;
   if(!Array.isArray(input.amenities||[])||!Array.isArray(input.activities||[]))throw new RepoError('validation','Amenities and activities must be lists.');
   const p=input.pricing||{},rooms=(p.rooms||[]).map(r=>({id:r.id,name:clean(r.name),amount:clean(r.amount),basis:r.basis||'roomNight'}));
   const rate={id:crypto.randomUUID(),version:1,schemaVersion:1,kind:'rates',entityId:record.id,entityKind:'accommodation',title:record.title,currency:p.currency||'USD',generalAmount:clean(p.generalAmount),generalBasis:p.generalBasis||'roomNight',rooms,updatedAt:new Date().toISOString()};
   if(ws.actor&&!['admin','reservations'].includes(ws.actor.role)&&(rate.generalAmount!==''||rooms.some(r=>r.amount!=='')))throw Object.assign(Error('Your role can add accommodation details and room types, but not supplier prices.'),{status:403});
   for(const room of rooms)if(!/^[0-9a-f-]{36}$/i.test(room.id||''))throw new RepoError('validation','Invalid room reference.');
   validateOperation(rate);
   return runTransaction(ws.db,CONTEXT_STORES,'readwrite',async tx=>{
    const ctx=await readContext(tx,ws.validator,ws.siteValidator);
    if(ctx.records.has(record.id))throw new RepoError('conflict','This accommodation was already saved. Choose it from the saved list.');
    const normal=s=>clean(s).replace(/\s+/g,' ').toLowerCase();
    if([...ctx.records.values()].some(e=>e.kind==='accommodation'&&normal(e.record.title)===normal(record.title)&&(record.destinationId?e.record.destinationId===record.destinationId:!e.record.destinationId&&normal(e.record.locationName)===normal(record.locationName))))throw new RepoError('conflict','An accommodation with this name and location already exists. Choose it from the saved list.');
    if(record.destinationId&&ctx.records.get(record.destinationId)?.kind!=='destination')throw new RepoError('validation','Choose an existing destination.');
    record.slug=uniqueSlug(record.title,'accommodation',record.id,ctx);
    const issues=errorsOnly(validateDraft(record,ctx));if(issues.length)throw new RepoError('validation',issues.map(e=>e.message).join(' '),{issues});
    const envelope={id:record.id,kind:record.kind,record,workflow:newWorkflow()};
    await request(tx.objectStore(STORES.records).put(envelope));
    await request(tx.objectStore(STORES.meta).put({key:'private-operation:'+rate.id,value:rate}));
    ws.faults?.check('accommodation.inline');
    return {accommodation:envelope,rate};
   });
  }
 };
}
