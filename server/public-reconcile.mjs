// Rebuilds the stored public projection (cms_public) from the current workspace.
//
// Publishing only rewrites the paths a mutation changes, so documents written by an older projector
// (for example with withheld fields, or a disabled accommodation page) stay stored until they are
// reconciled. planReconciliation() is read-only. applyReconciliation() writes in batches; every batch is
// a transaction that first checks the workspace revision the plan was computed from, so a concurrent
// publish aborts the run (rerun the plan) instead of being overwritten.
import {FieldPath} from 'firebase-admin/firestore';
import {project,publicId} from './publication.mjs';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const keysOf=value=>Object.keys(value?.data||{}).sort();

export async function readStoredProjection(db,{pageSize=500}={}){
 const stored=new Map();let last=null;
 while(true){
  let query=db.collection('cms_public').orderBy(FieldPath.documentId()).limit(pageSize);
  if(last)query=query.startAfter(last);
  const docs=(await query.get()).docs;
  for(const doc of docs)stored.set(doc.id,doc.data());
  if(docs.length<pageSize)return stored;
  last=docs.at(-1).id;
 }
}

// Returns counts plus per-document actions. Reports carry public paths and field names only, never values.
export function planReconciliation(workspace,stored){
 const desired=new Map([...project(workspace.entries)].map(([path,value])=>[publicId(path),value]));
 const plan={revision:workspace.revision,create:[],update:[],remove:[],unchanged:0};
 for(const [id,value] of desired){
  const old=stored.get(id);
  if(!old)plan.create.push({id,path:value.path,value});
  else if(!same(old,value)){const removedFields=keysOf(old).filter(k=>!keysOf(value).includes(k));plan.update.push({id,path:value.path,value,removedFields});}
  else plan.unchanged++;
 }
 for(const [id,old] of stored)if(!desired.has(id))plan.remove.push({id,path:old?.path||null,kind:old?.kind||(old?.redirect?'redirect':null)});
 return plan;
}

export function summarise(plan){
 return {revision:plan.revision,create:plan.create.length,update:plan.update.length,remove:plan.remove.length,unchanged:plan.unchanged,
  withheldFieldsRemoved:[...new Set(plan.update.flatMap(u=>u.removedFields))].sort(),
  removePaths:plan.remove.slice(0,50).map(r=>r.path||r.id),updatePaths:plan.update.slice(0,50).map(u=>u.path)};
}

export async function applyReconciliation(db,plan,{batchSize=400}={}){
 const ops=[...plan.remove.map(r=>({id:r.id,remove:true})),...plan.update.map(u=>({id:u.id,value:u.value})),...plan.create.map(c=>({id:c.id,value:c.value}))];
 let written=0;
 for(let i=0;i<ops.length;i+=batchSize){
  const batch=ops.slice(i,i+batchSize);
  await db.runTransaction(async tx=>{
   const control=await tx.get(db.doc('cms_state/control'));
   if((control.data()?.revision||0)!==plan.revision)throw Object.assign(Error('The workspace changed during reconciliation. Run the plan again.'),{code:'stale',status:409});
   for(const op of batch){const ref=db.collection('cms_public').doc(op.id);op.remove?tx.delete(ref):tx.set(ref,op.value);}
  });
  written+=batch.length;
 }
 return {written};
}
