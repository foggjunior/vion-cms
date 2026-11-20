import {createHash,randomUUID} from 'node:crypto';import {admin} from './firebase.mjs';
export const entryId=(store,key)=>createHash('sha256').update(store+':'+key).digest('hex');
export const LIMITS=Object.freeze({entries:8000,changesPerCommit:440,documentBytes:800000,cacheBytes:64*1024*1024});
export function changes(before,after){const old=new Map(before.map(e=>[entryId(e.store,e.key),e])),next=new Map(after.map(e=>[entryId(e.store,e.key),e])),result=[];for(const [id,e] of next)if(JSON.stringify(old.get(id))!==JSON.stringify(e))result.push({id,entry:e});for(const id of old.keys())if(!next.has(id))result.push({id,entry:null});return result;}
const normalise=entries=>entries.map(e=>({store:e.store,key:e.key,value:JSON.parse(JSON.stringify(e.value))}));

// Every write to cms_entries goes through commit(), which bumps cms_state/control.revision in the same
// transaction. A warm server instance can therefore reuse the entries it last read or wrote while the
// stored revision is unchanged: one document read instead of the whole workspace. The revision check in
// commit() still guards every write, so a stale cache can only cost a reload, never a lost update.
export function createPersistence(getDb,{cache:useCache=true}={}){
 let cache=null;
 const stats={snapshots:0,cacheHits:0,documentReads:0,commits:0};
 const remember=(revision,entries)=>{if(!useCache)return;const json=JSON.stringify(entries);cache=Buffer.byteLength(json)<=LIMITS.cacheBytes?{revision,json}:null;};
 async function snapshot(){
  const db=getDb();stats.snapshots++;
  if(cache){const control=await db.doc('cms_state/control').get();stats.documentReads++;if((control.data()?.revision||0)===cache.revision){stats.cacheHits++;return {revision:cache.revision,entries:JSON.parse(cache.json)};}}
  const result=await db.runTransaction(async tx=>{const control=await tx.get(db.doc('cms_state/control')),docs=await tx.get(db.collection('cms_entries').limit(LIMITS.entries+1));stats.documentReads+=1+docs.size;if(docs.size>LIMITS.entries)throw Object.assign(Error('Workspace exceeded the supported migration-adapter capacity.'),{status:503,code:'capacity'});return {revision:control.data()?.revision||0,entries:docs.docs.map(d=>{const e=d.data();return {store:e.store,key:e.key,value:JSON.parse(e.json)}})};});
  remember(result.revision,result.entries);
  return result;
 }
 // Reads one stored value without loading the whole workspace (image display lookups, booking de-duplication).
 async function readEntry(store,key){const doc=await getDb().collection('cms_entries').doc(entryId(store,key)).get();stats.documentReads++;if(!doc.exists)return null;const e=doc.data();return e.store===store&&e.key===key?JSON.parse(e.json):null;}
 // Which of the given [store,key] pairs already exist, using batched point reads.
 async function existing(pairs){const db=getDb(),found=new Set();for(let i=0;i<pairs.length;i+=300){const slice=pairs.slice(i,i+300),docs=await db.getAll(...slice.map(([store,key])=>db.collection('cms_entries').doc(entryId(store,key))));stats.documentReads+=slice.length;docs.forEach((doc,j)=>{if(doc.exists)found.add(slice[j][0]+':'+slice[j][1]);});}return found;}
 async function commit(before,after,actor,operation,extra=[]){const delta=changes(before.entries,after);if(delta.length+extra.length>LIMITS.changesPerCommit)throw Object.assign(Error('This operation changes too many records. Import a smaller batch.'),{status:413,code:'too-many-changes'});if(!delta.length&&!extra.length)return;const db=getDb();await db.runTransaction(async tx=>{const ref=db.doc('cms_state/control'),state=await tx.get(ref);if((state.data()?.revision||0)!==before.revision)throw Object.assign(Error('The shared workspace changed while this action was running. Reload and try again.'),{code:'stale',status:409});for(const change of delta){const ref=db.collection('cms_entries').doc(change.id);if(change.entry){const json=JSON.stringify(change.entry.value);if(Buffer.byteLength(json)>LIMITS.documentBytes)throw Object.assign(Error('Record exceeds the safe document limit.'),{status:413,code:'document-too-large'});tx.set(ref,{store:change.entry.store,key:change.entry.key,json});}else tx.delete(ref);}for(const e of extra)e.remove?tx.delete(db.doc(e.path)):tx.set(db.doc(e.path),e.value);tx.set(ref,{revision:before.revision+1,updatedAt:new Date().toISOString()});tx.create(db.collection('cms_audit').doc(randomUUID()),{at:new Date().toISOString(),actorUid:actor.uid,role:actor.role,operation,changed:delta.length});});stats.commits++;
  // `after` is the full committed state at the new revision (unchanged entries included).
  remember(before.revision+1,normalise(after));}
 // Record-scoped commit for an edit that only touches its own entries (see scoped-writes.mjs).
 // Instead of requiring the whole workspace to be unchanged, it requires every entry the edit wrote or
 // relied on (`readSet`) to be exactly as it was in `before`. Two staff editing different records both
 // succeed; the same record edited from the same version gives one success and one stale conflict. The
 // workspace revision still advances, so revision-checked whole-workspace writers and every snapshot
 // cache see the change.
 async function commitScoped(before,after,actor,operation,{readSet=[]}={}){
  const delta=changes(before.entries,after);if(!delta.length)return;
  if(delta.length>LIMITS.changesPerCommit)throw Object.assign(Error('This operation changes too many records. Import a smaller batch.'),{status:413,code:'too-many-changes'});
  const db=getDb(),expected=new Map(before.entries.map(e=>[entryId(e.store,e.key),e])),ids=[...new Set([...readSet.map(([store,key])=>entryId(store,key)),...delta.map(c=>c.id)])];
  let revision;
  await db.runTransaction(async tx=>{
   const control=await tx.get(db.doc('cms_state/control'));
   const docs=await Promise.all(ids.map(id=>tx.get(db.collection('cms_entries').doc(id))));
   docs.forEach((doc,i)=>{const prior=expected.get(ids[i]),same=prior?doc.exists&&doc.data().json===JSON.stringify(prior.value):!doc.exists;if(!same)throw Object.assign(Error('This record changed while you were editing. Reload the latest version; your unsaved edits stay in the form.'),{code:'stale',status:409});});
   for(const change of delta){const ref=db.collection('cms_entries').doc(change.id);if(change.entry){const json=JSON.stringify(change.entry.value);if(Buffer.byteLength(json)>LIMITS.documentBytes)throw Object.assign(Error('Record exceeds the safe document limit.'),{status:413,code:'document-too-large'});tx.set(ref,{store:change.entry.store,key:change.entry.key,json});}else tx.delete(ref);}
   revision=(control.data()?.revision||0)+1;
   tx.set(db.doc('cms_state/control'),{revision,updatedAt:new Date().toISOString()});
   tx.create(db.collection('cms_audit').doc(randomUUID()),{at:new Date().toISOString(),actorUid:actor.uid,role:actor.role,operation,changed:delta.length,scope:'record'});
  });
  stats.commits++;stats.scopedCommits=(stats.scopedCommits||0)+1;
  // `after` is exact only if nothing else committed in between; otherwise drop the cache.
  if(revision===before.revision+1)remember(revision,normalise(after));else cache=null;
 }
 // Point reads of stored values by [store,key]; returns a Map keyed by `${store}:${key}` (missing → absent).
 async function readValues(pairs){const db=getDb(),out=new Map();for(let i=0;i<pairs.length;i+=300){const slice=pairs.slice(i,i+300),docs=await db.getAll(...slice.map(([store,key])=>db.collection('cms_entries').doc(entryId(store,key))));stats.documentReads+=slice.length;docs.forEach((doc,j)=>{const [store,key]=slice[j];if(doc.exists){const e=doc.data();if(e.store===store&&e.key===key)out.set(store+':'+key,JSON.parse(e.json));}});}return out;}
 return {snapshot,readEntry,readValues,existing,commit,commitScoped,stats,clearCache(){cache=null;}};
}
const live=createPersistence(()=>admin().db);
export const snapshot=()=>live.snapshot();
export const readEntry=(store,key)=>live.readEntry(store,key);
export const readValues=pairs=>live.readValues(pairs);
export const existingEntries=pairs=>live.existing(pairs);
export const commit=(...args)=>live.commit(...args);
export const commitScoped=(...args)=>live.commitScoped(...args);
export const persistenceStats=()=>({...live.stats});
