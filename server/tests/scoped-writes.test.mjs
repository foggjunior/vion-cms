// Area 5: record-scoped reads and saves. Different records saved concurrently both succeed; the same
// record from the same version gives exactly one success and one stale conflict; cross-record operations
// (slug changes, publishing, media removal) keep the whole-workspace guard; failures write nothing; and
// every scoped save still advances the workspace revision so other instances and caches see it.
import test from 'node:test';import assert from 'node:assert/strict';
import {execute} from '../execute.mjs';import {createPersistence} from '../persistence.mjs';import {scopedWrite} from '../scoped-writes.mjs';
import {fakeFirestore} from './support/fake-firestore.mjs';
import {newRecord} from '../../src/modules/shared/records.js';import {newDocument} from '../../src/review/model.js';import {newBooking} from '../../src/storage/bookings-repository.js';

const admin={uid:'alice',name:'Alice',email:'',role:'admin'},now=new Date().toISOString();
const image=id=>[{store:'assets',key:id,value:{id,fileName:id+'.png',type:'image/png',size:10,width:100,height:100,alt:'Alt',credit:'',caption:'',createdAt:now,updatedAt:now,version:1}},{store:'assetBlobs',key:id,value:{id,url:'https://res.cloudinary.com/demo/image/upload/v1/vion-cms/'+id+'.png',publicId:'vion-cms/'+id}}];
async function setup({images=[]}={}){
 const db=fakeFirestore(),p=createPersistence(()=>db);
 if(images.length){const before=await p.snapshot();await p.commit(before,images.flatMap(image),admin,'seed');}
 const save=async(title,slug,extra={})=>(await execute(admin,'content','saveDraft',[Object.assign(newRecord('destination'),{title,slug,overview:'O',bestTime:'June'},extra),{expectedVersion:null}],p));
 return {db,p,save,instance:()=>createPersistence(()=>db),revision:async()=>(await db.doc('cms_state/control').get()).data().revision};
}
const edit=(p,env,changes)=>execute(admin,'content','saveDraft',[{...env.record,...changes},{expectedVersion:env.record.version}],p);

test('Two staff editing different records at the same time both succeed',async()=>{
 const s=await setup(),a=await s.save('Arusha','arusha'),b=await s.save('Serengeti','serengeti'),r0=await s.revision();
 const [x,y]=await Promise.allSettled([edit(s.instance(),a,{overview:'A new'}),edit(s.instance(),b,{overview:'B new'})]);
 assert.equal(x.status,'fulfilled');assert.equal(y.status,'fulfilled');
 const ctx=await execute(admin,'content','loadContext',[],s.instance());
 assert.equal(ctx.records.get(a.id).record.overview,'A new');assert.equal(ctx.records.get(b.id).record.overview,'B new');
 assert.equal(await s.revision(),r0+2,'each scoped save advances the shared revision');
});

test('Two staff saving the same record version: one success and one clear stale conflict',async()=>{
 const s=await setup(),a=await s.save('Arusha','arusha');
 const results=await Promise.allSettled([edit(s.instance(),a,{overview:'First'}),edit(s.instance(),a,{overview:'Second'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const lost=results.find(r=>r.status==='rejected').reason;
 assert.equal(lost.code,'stale');assert.equal(lost.status,409);assert.match(lost.message,/changed while you were editing/);
 const stored=await execute(admin,'content','get',[a.id],s.instance());
 assert(['First','Second'].includes(stored.record.overview));assert.equal(stored.record.version,a.record.version+1,'the losing edit wrote nothing');
});

test('Slug changes keep the whole-workspace guard so two records cannot claim one route',async()=>{
 const s=await setup(),a=await s.save('Arusha','arusha'),b=await s.save('Serengeti','serengeti');
 assert.equal(scopedWrite('content','saveDraft',[{...a.record,slug:'x'},{expectedVersion:1}],[],[]),null);
 const results=await Promise.allSettled([edit(s.instance(),a,{slug:'shared-slug'}),edit(s.instance(),b,{slug:'shared-slug'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'only one rename can win');
 assert.equal(results.find(r=>r.status==='rejected').reason.code,'stale');
});

test('Publishing stays a whole-workspace operation and rejects a concurrent edit of the same record',async()=>{
 const img=crypto.randomUUID(),s=await setup({images:[img]}),cover={assetId:img,alt:'Plains'},a=await s.save('Arusha','arusha',{cover}),b=await s.save('Serengeti','serengeti',{cover});
 const results=await Promise.allSettled([execute(admin,'content','publish',[a.id,{expectedVersion:a.record.version}],s.instance()),edit(s.instance(),a,{overview:'Racing edit'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 // An edit of a different record does not block a later publish.
 await edit(s.instance(),b,{overview:'Unrelated'});
 const fresh=await execute(admin,'content','get',[a.id],s.instance());
 await execute(admin,'content','publish',[a.id,{expectedVersion:fresh.record.version}],s.instance());
});

test('A newly referenced image removed concurrently is rejected instead of leaving a dangling reference',async()=>{
 const id=crypto.randomUUID(),s=await setup({images:[id]}),a=await s.save('Arusha','arusha');
 const editor=s.instance(),before=await editor.snapshot();void before;
 await execute(admin,'media','remove',[id],s.instance());
 await assert.rejects(()=>edit(editor,a,{cover:{assetId:id,alt:'Plains'}}),e=>e.code==='stale'||e.code==='validation');
 const stored=await execute(admin,'content','get',[a.id],s.instance());
 assert.equal(stored.record.cover,null);
});

test('If the image reference wins, the removal is blocked by the usage check',async()=>{
 const id=crypto.randomUUID(),s=await setup({images:[id]}),a=await s.save('Arusha','arusha');
 await edit(s.instance(),a,{cover:{assetId:id,alt:'Plains'}});
 await assert.rejects(()=>execute(admin,'media','remove',[id],s.instance()),e=>e.code==='dependency');
});

test('A failed multi-record save writes nothing',async()=>{
 const s=await setup(),a=await s.save('Arusha','arusha'),stored=JSON.stringify(s.db.dump());
 const p=s.instance(),before=await p.snapshot();
 const after=before.entries.map(e=>e.store==='records'?{...e,value:{...e.value,record:{...e.value.record,title:'Changed'}}}:e);
 after.push({store:'meta',key:'big',value:{key:'big',value:'x'.repeat(900000)}});
 await assert.rejects(()=>p.commitScoped(before,after,admin,'test',{readSet:[['records',a.id]]}),e=>e.code==='document-too-large');
 assert.equal(JSON.stringify(s.db.dump()),stored,'no partial write');
});

test('Editorial documents: different documents save in parallel; route changes keep the global guard',async()=>{
 const s=await setup(),mk=async t=>{const d=newDocument('faqs');d.title=t;d.body='x';return execute(admin,'review','save',[d,0],s.p);};
 const a=await mk('One'),b=await mk('Two');
 const results=await Promise.allSettled([execute(admin,'review','save',[{...a.record,body:'A'},a.version],s.instance()),execute(admin,'review','save',[{...b.record,body:'B'},b.version],s.instance())]);
 assert(results.every(r=>r.status==='fulfilled'),JSON.stringify(results.map(r=>r.reason?.message)));
 const page=newDocument('pages');page.title='About';page.path='/about';const saved=await execute(admin,'review','save',[page,0],s.p);
 const delta=[{store:'meta',key:'review-document:'+saved.id,value:{key:'review-document:'+saved.id,value:{...saved,record:{...saved.record,path:'/team'}}}}];
 const before=[{store:'meta',key:'review-document:'+saved.id,value:{key:'review-document:'+saved.id,value:saved}}];
 assert.equal(scopedWrite('review','save',[{},saved.version],before,delta,[]),null,'a path change is a route claim');
});

test('Record reads use one stored entry, keep role checks, and see other instances\' saves',async()=>{
 const s=await setup(),a=await s.save('Arusha','arusha'),reader=s.instance();
 const reads=reader.stats.documentReads,got=await execute({...admin,role:'viewer'},'content','get',[a.id],reader);
 assert.equal(got.record.title,'Arusha');assert.equal(reader.stats.documentReads-reads,1,'one point read, no workspace snapshot');
 assert.equal(await execute(admin,'content','get',['missing-id'],reader),null);
 const staff=newDocument('users');staff.title='Private';const doc=await execute(admin,'review','save',[staff,0],s.p);
 await assert.rejects(()=>execute({...admin,role:'editor'},'review','get',[doc.id],reader),e=>e.status===403);
 const booking=Object.assign(newBooking(),{fullName:'Guest',email:'g@example.com'});const saved=await execute(admin,'bookings','save',[booking,0],s.p);
 await assert.rejects(()=>execute({...admin,role:'editor'},'bookings','get',[saved.id],reader),e=>e.status===403);
 assert.equal((await execute({...admin,role:'reservations'},'bookings','get',[saved.id],reader)).fullName,'Guest');
 // Dashboard freshness: a cached instance sees a scoped save made by another instance.
 const dash=s.instance();const before=await execute(admin,'summaries','dashboard',[{}],dash);
 const latest=await execute(admin,'content','get',[a.id],s.p);
 await edit(s.instance(),latest,{title:'Arusha renamed'});
 const list=await execute(admin,'summaries','cataloguePage',['destination',{}],dash);
 assert(list.rows.some(r=>r.title==='Arusha renamed'),'cached instance reloaded after the revision changed');
 assert.equal((await execute(admin,'summaries','dashboard',[{}],dash)).drafts,before.drafts);
});
