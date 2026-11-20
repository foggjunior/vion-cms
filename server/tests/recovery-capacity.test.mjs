// P0 recovery gate and P1 capacity evidence: repeat imports are idempotent, a restore into a clean
// workspace reproduces records, IDs and public URLs, persistence limits fail loudly, stale writers are
// rejected, and the revision-checked snapshot cache cuts whole-workspace reads. All in memory.
import test from 'node:test';import assert from 'node:assert/strict';
import {domain} from '../domain.mjs';
import {project} from '../publication.mjs';
import {createPersistence,LIMITS} from '../persistence.mjs';
import {execute} from '../execute.mjs';
import {newRecord} from '../../src/modules/shared/records.js';
import {newDocument} from '../../src/review/model.js';
import {fakeFirestore} from './support/fake-firestore.mjs';

const actor={uid:'alice',name:'Alice',email:'alice@example.com',role:'admin'};
const now=new Date().toISOString();
const image=id=>[{store:'assets',key:id,value:{id,fileName:id+'.png',type:'image/png',size:10,width:1200,height:800,alt:'Alt',credit:'',caption:'',createdAt:now,updatedAt:now,version:1}},{store:'assetBlobs',key:id,value:{id,url:'https://res.cloudinary.com/demo/image/upload/v1/vion-cms/'+id+'.png',publicId:'vion-cms/'+id}}];

async function sourceWorkspace(){
 const img=[crypto.randomUUID(),crypto.randomUUID()],media=img.flatMap(image),d=await domain(media,actor),ws=d.ws;
 const dest=Object.assign(newRecord('destination'),{title:'Arusha',slug:'arusha',overview:'Town',bestTime:'June',cover:{assetId:img[0],alt:'Town'}});
 let saved=await ws.content.saveDraft(dest,{expectedVersion:null});saved=await ws.content.publish(saved.record.id,{expectedVersion:saved.record.version});
 // A rename after publication leaves a 308 alias for the old path.
 saved=await ws.content.saveDraft({...saved.record,slug:'arusha-town'},{expectedVersion:saved.record.version});
 await ws.content.publish(saved.record.id,{expectedVersion:saved.record.version});
 const faq=newDocument('faqs');faq.title='When to go?';faq.body='June to October.';let e=await ws.review.save(faq,0);await ws.review.action(e.id,'publish',e.version);
 const draft=Object.assign(newRecord('tour'),{title:'Draft tour',slug:'draft-tour'});await ws.content.saveDraft(draft,{expectedVersion:null});
 const backup=await ws.backup.exportData(),entries=await d.dump();d.close();
 return {backup,entries,media};
}
const counts=entries=>Object.fromEntries([...new Set(entries.map(e=>e.store))].sort().map(store=>[store,entries.filter(e=>e.store===store).length]));
const ids=(entries,store)=>entries.filter(e=>e.store===store).map(e=>e.key).sort();
const publicView=entries=>JSON.stringify([...project(entries)].sort(([a],[b])=>a.localeCompare(b)));

async function restore(backup,media,times=1){const d=await domain(media,actor);try{for(let i=0;i<times;i++){const check=await d.ws.backup.previewImport(backup);assert(check.ok,JSON.stringify(check.errors));await d.ws.backup.importData(backup);}return await d.dump();}finally{d.close();}}

test('A restore into a clean workspace reproduces records, IDs, drafts, aliases and public URLs',async()=>{
 const {backup,entries,media}=await sourceWorkspace(),restored=await restore(backup,media);
 for(const store of ['records','published','redirects','assets'])assert.deepEqual(ids(restored,store),ids(entries,store),store);
 const review=list=>list.filter(e=>e.store==='meta'&&e.key.startsWith('review-document:')).map(e=>e.key).sort();
 assert.deepEqual(review(restored),review(entries));
 assert.deepEqual([...project(restored).keys()].sort(),[...project(entries).keys()].sort());
 assert(project(restored).get('/destinations/arusha')?.redirect==='/destinations/arusha-town','the old URL still redirects');
});

test('Importing the same backup twice is idempotent: no duplicates and the same public output',async()=>{
 const {backup,media}=await sourceWorkspace(),once=await restore(backup,media,1),twice=await restore(backup,media,2);
 assert.deepEqual(counts(twice),counts(once));
 for(const store of ['records','published','redirects'])assert.deepEqual(ids(twice,store),ids(once,store),store);
 assert.equal(publicView(twice),publicView(once));
});

test('Commits beyond the per-transaction change limit fail loudly instead of partially applying',async()=>{
 const db=fakeFirestore(),p=createPersistence(()=>db),before=await p.snapshot();
 const after=Array.from({length:LIMITS.changesPerCommit+1},(_,i)=>({store:'meta',key:'k'+i,value:{key:'k'+i,value:i}}));
 await assert.rejects(()=>p.commit(before,after,actor,'bulk'),e=>e.status===413&&e.code==='too-many-changes');
 assert.equal(Object.keys(db.dump()).length,0);
 await assert.rejects(()=>p.commit(before,[{store:'meta',key:'big',value:{key:'big',value:'x'.repeat(LIMITS.documentBytes)}}],actor,'big'),e=>e.code==='document-too-large');
 assert.equal(Object.keys(db.dump()).length,0,'a failed transaction writes nothing');
});

test('Stale writers from another instance are rejected without overwriting',async()=>{
 const db=fakeFirestore(),a=createPersistence(()=>db),b=createPersistence(()=>db);
 const sa=await a.snapshot(),sb=await b.snapshot();
 await a.commit(sa,[{store:'meta',key:'x',value:{key:'x',value:'A'}}],actor,'a');
 await assert.rejects(()=>b.commit(sb,[{store:'meta',key:'x',value:{key:'x',value:'B'}}],actor,'b'),e=>e.code==='stale');
 assert.equal((await a.snapshot()).entries[0].value.value,'A');
});

test('The snapshot cache reads one document while the revision is unchanged and reloads after any commit',async()=>{
 const db=fakeFirestore(),a=createPersistence(()=>db),b=createPersistence(()=>db);
 const seed=await a.snapshot();
 await a.commit(seed,Array.from({length:300},(_,i)=>({store:'meta',key:'k'+i,value:{key:'k'+i,value:i}})),actor,'seed');
 let reads=a.stats.documentReads;const cached=await a.snapshot();
 assert.equal(a.stats.documentReads-reads,1,'own commit primes the cache');assert.equal(cached.entries.length,300);
 cached.entries[0].value.value='mutated by a caller';
 assert.equal((await a.snapshot()).entries[0].value.value,0,'callers receive copies');
 const other=await b.snapshot();await b.commit(other,[...other.entries,{store:'meta',key:'new',value:{key:'new',value:1}}],actor,'other');
 reads=a.stats.documentReads;const fresh=await a.snapshot();
 assert.equal(fresh.entries.length,301,'another instance\'s commit is seen');
 assert(a.stats.documentReads-reads>300,'full reload after a revision change');
 const off=createPersistence(()=>db,{cache:false});await off.snapshot();reads=off.stats.documentReads;await off.snapshot();
 assert(off.stats.documentReads-reads>300,'cache can be disabled');
});

test('Read RPCs through the real pipeline reuse the cache; writes keep revision checks',async()=>{
 const db=fakeFirestore(),p=createPersistence(()=>db);
 const r=newRecord('destination');r.title='Park';r.slug='park';
 await execute(actor,'content','saveDraft',[r,{expectedVersion:null}],p);
 const reads=p.stats.documentReads;
 for(let i=0;i<5;i++)await execute({...actor,role:'viewer'},'content','list',[],p);
 assert.equal(p.stats.documentReads-reads,5,'five list calls cost five control reads');
 assert.equal((await db.doc('cms_state/control').get()).data().revision,1);
});

import {databaseId} from '../firebase.mjs';
test('A restored Firestore database can be selected by ID without code changes',()=>{
 assert.equal(databaseId({}),null);assert.equal(databaseId({FIRESTORE_DATABASE_ID:'(default)'}),null);
 assert.equal(databaseId({FIRESTORE_DATABASE_ID:'restore-20261119'}),'restore-20261119');
 assert.throws(()=>databaseId({FIRESTORE_DATABASE_ID:'Prod DB'}),e=>e.status===503);
});

import {rpcResponse} from '../diagnostics.mjs';
test('Large RPC responses stream instead of failing, oversize ones fail clearly, and logs hold no content',async()=>{
 const logs=[],log={warn:(...a)=>logs.push(a.join(' '))},secret='guest-private@example.com';
 const small=rpcResponse({value:'ok'},{operation:'content.list',log});
 assert.equal(small.status,200);assert.equal(small.headers.get('X-Vion-Streamed'),null);
 const payload={value:Array.from({length:3000},(_,i)=>({id:i,text:secret+'x'.repeat(1500)}))};
 const big=rpcResponse(payload,{operation:'content.loadContext',limit:1_000_000,log});
 assert.equal(big.headers.get('X-Vion-Streamed'),'1');
 assert.deepEqual(await big.json(),payload,'streamed body is complete');
 const huge=rpcResponse(payload,{operation:'backup.exportData',limit:1_000,streamLimit:2_000_000,log});
 assert.equal(huge.status,413);assert.equal((await huge.json()).code,'response-too-large');
 assert(logs.length>=2);assert(!logs.join().includes(secret),'diagnostics must not log record content');
});
