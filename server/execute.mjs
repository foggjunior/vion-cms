import {preconditions} from './preconditions.mjs';import {domain} from './domain.mjs';import {snapshot,commit,commitScoped,readValues} from './persistence.mjs';import {requireAccess,READ_METHODS} from './policy.mjs';import {publicProjection} from './publication.mjs';import {scopedWrite,POINT_READS} from './scoped-writes.mjs';import {revalidationJob} from './revalidation.mjs';
const forbiddenStaff=()=>Object.assign(Error('Staff directory is administrator-only.'),{status:403});
export async function execute(actor,service,method,args=[],persistence={snapshot,commit,commitScoped,readValues}){
 requireAccess(actor,service,method,args);preconditions(service,method,args);
 // Record-scoped reads: one stored entry, no workspace snapshot (persistence without readValues keeps the old path).
 const point=POINT_READS[service+'.'+method];
 if(point&&persistence.readValues&&typeof args[0]==='string'&&args[0].length<=200){
  const [store,key]=point.entry(args[0]),raw=(await persistence.readValues([[store,key]])).get(store+':'+key),value=raw===undefined?null:point.value(raw);
  if(service==='review'&&actor.role!=='admin'&&value?.kind==='staff')throw forbiddenStaff();
  return value??null;
 }
 const before=await persistence.snapshot(),context=await domain(before.entries,actor);
 try{
  if(service==='review'&&['get','action','duplicate'].includes(method)&&actor.role!=='admin'){const row=await context.ws.review.get(args[0]);if(row?.kind==='staff')throw forbiddenStaff();}
  if(service==='review'&&method==='list'&&actor.role!=='admin'){return (await context.ws.review.list(...args)).filter(e=>e.kind!=='staff');}
  if(service==='backup'&&['importMedia','validateMediaBackup'].includes(method))throw Object.assign(Error('Use the cloud media migration tool for binary imports.'),{status:422});
  if(service==='backup'&&method==='exportMedia')return {format:'vion-cloudinary-manifest',version:1,assets:before.entries.filter(e=>e.store==='assetBlobs').map(e=>e.value),notice:'Cloudinary originals are remote. Use your Cloudinary account backup policy.'};
  let result;
  try{result=await context.ws[service][method](...args);}catch(error){if(!error.status&&!error.code)error.status=422;throw error;}
  if(!READ_METHODS.has(method)){
   const after=await context.dump(),projections=publicProjection(after,before.entries);
   // Ordinary edits of one existing record commit with record-level checks (see scoped-writes.mjs);
   // everything else keeps the whole-workspace revision check.
   const scope=persistence.commitScoped?scopedWrite(service,method,args,before.entries,after,projections):null;
   if(scope)await persistence.commitScoped(before,after,actor,service+'.'+method,scope);
   else{
    // A publication change also queues a website cache invalidation in the same transaction (outbox).
    const job=revalidationJob(projections);
    await persistence.commit(before,after,actor,service+'.'+method,job?[...projections,job]:projections);
   }
  }
  if(service==='content'&&method==='loadContext'&&actor.role!=='admin')result.reviewRecords=result.reviewRecords.filter(e=>e.kind!=='staff');
  return result;
 }finally{context.close();}
}
