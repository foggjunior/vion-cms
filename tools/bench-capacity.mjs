// Repeatable synthetic capacity measurement (no Firebase, no environment files).
//   npm run bench:capacity -- [sizes=60,240,600]
// For each size it builds a workspace of published destinations, stays, tours and blog posts with
// realistic text lengths, then measures through the real execute() pipeline on an in-memory Firestore
// double: workspace entries and bytes, Firestore document reads per RPC (with and without the snapshot
// cache), read/write latency, the largest RPC responses against Vercel's 4.5 MB limit, public catalogue
// page sizes, and concurrent writers on the single workspace revision. Timings are for this machine and
// the in-memory double: use them for relative scaling, not as production latency.
import {performance} from 'node:perf_hooks';
import {domain} from '../server/domain.mjs';
import {execute} from '../server/execute.mjs';
import {createPersistence,LIMITS} from '../server/persistence.mjs';
import {publicProjection} from '../server/publication.mjs';
import {cataloguePage} from '../server/public-feed.mjs';
import {encode} from '../server/wire.mjs';
import {validateLedger} from '../server/finance.mjs';
import {RESPONSE_LIMIT_BYTES} from '../server/diagnostics.mjs';
import {newRecord} from '../src/modules/shared/records.js';
import {newDocument} from '../src/review/model.js';
import {fakeFirestore} from '../server/tests/support/fake-firestore.mjs';

const actor={uid:'bench',name:'Bench',email:'',role:'admin'},now=new Date().toISOString();
const words=n=>Array.from({length:n},(_,i)=>['safari','plains','migration','lodge','crater','guide','sunrise','acacia','river','camp'][i%10]).join(' ');
const bytes=value=>Buffer.byteLength(JSON.stringify(value));
const mb=n=>(n/1e6).toFixed(2)+' MB';
async function timed(fn){const t=performance.now();const value=await fn();return {value,ms:performance.now()-t};}

async function build(size){
 const per=Math.max(1,Math.round(size/4)),img=Array.from({length:per*2},()=>crypto.randomUUID());
 const media=img.flatMap(id=>[{store:'assets',key:id,value:{id,fileName:id+'.jpg',type:'image/jpeg',size:900000,width:2560,height:1707,alt:'Photo',credit:'',caption:'',createdAt:now,updatedAt:now,version:1}},{store:'assetBlobs',key:id,value:{id,url:'https://res.cloudinary.com/demo/image/upload/v1/vion-cms/'+id+'.jpg',publicId:'vion-cms/'+id}}]);
 const d=await domain(media,actor),ws=d.ws,publish=async rec=>{const s=await ws.content.saveDraft(rec,{expectedVersion:null});return ws.content.publish(s.record.id,{expectedVersion:s.record.version});};
 const dests=[];
 for(let i=0;i<per;i++){const r=Object.assign(newRecord('destination'),{title:'Destination '+i,slug:'destination-'+i,overview:words(450),wildlife:words(120),highlights:words(80),bestTime:words(40),cover:{assetId:img[i%img.length],alt:'Cover'},gallery:[1,2,3].map(k=>({assetId:img[(i+k)%img.length],alt:'G'}))});await publish(r);dests.push(r.id);}
 const stays=[];
 for(let i=0;i<per;i++){const r=Object.assign(newRecord('accommodation'),{title:'Stay '+i,slug:'stay-'+i,type:'Lodge',standard:'Luxury',description:words(250),destinationId:dests[i%dests.length],amenities:['Wi-Fi','Pool'],cover:{assetId:img[(i+5)%img.length],alt:'Stay'}});await publish(r);stays.push(r.id);}
 for(let i=0;i<per;i++){const days=7,r=Object.assign(newRecord('tour'),{title:'Tour '+i,slug:'tour-'+i,summary:words(40),overview:words(500),durationDays:days,destinationIds:[dests[i%dests.length]],cover:{assetId:img[(i+7)%img.length],alt:'Tour'},itinerary:Array.from({length:days},(_,k)=>({id:crypto.randomUUID(),dayNumber:k+1,title:'Day '+(k+1),description:words(90),destinationIds:[dests[(i+k)%dests.length]],accommodationIds:[stays[(i+k)%stays.length]],meals:['Breakfast'],activities:['Game drive']})),inclusions:['Guide','Park fees'],exclusions:['Tips'],pricing:{mode:'request'}});await publish(r);}
 for(let i=0;i<per;i++){const b=newDocument('blogs');Object.assign(b,{title:'Post '+i,slug:'post-'+i,body:'@vion-rich:'+['A','B','C'].map(h=>`<h2>${h} ${i}</h2><p>${words(300)}</p>`).join(''),excerpt:words(30),author:'Vion',publishDate:'2026-01-01',categoryId:'default-blog-safari',coverAssetId:img[i%img.length],imageAlt:'Cover',seoTitle:'Post',seoDescription:'Post'});let e=await ws.review.save(b,0);await ws.review.action(e.id,'publish',e.version).catch(()=>{});}
 const entries=await d.dump();d.close();return entries;
}

async function measure(size){
 const t0=performance.now(),entries=await build(size),buildMs=performance.now()-t0;
 const db=fakeFirestore(),seedPersistence=createPersistence(()=>db,{cache:false}),start=await seedPersistence.snapshot();
 for(let i=0;i<entries.length;i+=LIMITS.changesPerCommit-50){const before=await seedPersistence.snapshot();await seedPersistence.commit(before,[...before.entries,...entries.slice(i,i+LIMITS.changesPerCommit-50)],actor,'seed');}
 for(const change of publicProjection(entries))await db.doc(change.path).set(change.value);
 void start;
 const cold=createPersistence(()=>db,{cache:false}),warm=createPersistence(()=>db);
 const snap=await timed(()=>cold.snapshot()),workspaceBytes=bytes(snap.value.entries);
 let r=cold.stats.documentReads;const list=await timed(()=>execute(actor,'content','list',[],cold));const readsCold=cold.stats.documentReads-r;
 await warm.snapshot();r=warm.stats.documentReads;const listWarm=await timed(()=>execute(actor,'content','list',[],warm));const readsWarm=warm.stats.documentReads-r;
 const ctx=await timed(()=>execute(actor,'content','loadContext',[],cold)),ctxBytes=bytes({value:encode(ctx.value)});
 const backup=await timed(()=>execute(actor,'backup','exportData',[],cold)),backupBytes=bytes({value:encode(backup.value)});
 const rec=Object.assign(newRecord('destination'),{title:'Bench write',slug:'bench-write-'+size});
 const write=await timed(()=>execute(actor,'content','saveDraft',[rec,{expectedVersion:null}],warm));
 // Concurrent writers: each instance snapshots the same revision, then all commit.
 const writers=Array.from({length:5},()=>createPersistence(()=>db));
 const results=await Promise.allSettled(writers.map((p,i)=>{const doc=newDocument('faqs');doc.title='Concurrent '+i;doc.body='x';return execute(actor,'review','save',[doc,0],p);}));
 const page=await cataloguePage(db,{kind:'tour',limit:200,includeMedia:true});
 return {size,entries:snap.value.entries.length,buildMs:Math.round(buildMs),workspaceBytes,snapshotMs:Math.round(snap.ms),
  listMsCold:Math.round(list.ms),readsPerRpcCold:readsCold,listMsWarm:Math.round(listWarm.ms),readsPerRpcWarm:readsWarm,
  loadContextBytes:ctxBytes,backupExportBytes:backupBytes,writeMs:Math.round(write.ms),
  concurrentWriters:{attempted:5,succeeded:results.filter(x=>x.status==='fulfilled').length,stale:results.filter(x=>x.reason?.code==='stale').length},
  tourPage:{items:page.items.length,bytes:bytes(page),next:!!page.next}};
}

function financeCapacity(){
 const trips=Array.from({length:1000},(_,i)=>({id:crypto.randomUUID(),type:'Multi-day trip',start:'2026-01-01',end:'2026-01-05',guests:4,name:'Northern circuit safari '+i,guestNames:'Guest A, Guest B, Guest C, Guest D',guide:'Guide name',contact:'+255700000000',priceOriginal:'4500',priceCurrency:'USD',priceRate:'2600'}));
 const rows=Array.from({length:2000},(_,i)=>({kind:'Expenses',date:'2026-01-02',name:'Park fees for trip '+i,method:'Bank transfer',original:'120000',currency:'TZS',category:'Tour',type:'Park fees',description:'Conservation fees, 4 adults',comment:'',trip:trips[i%1000].id}));
 const ledger=validateLedger({version:1,rows,trips});
 return {rows:2000,trips:1000,requestBytes:bytes({version:1,rows,trips}),storedBytes:bytes(ledger),putLimitBytes:600000,firestoreDocumentLimitBytes:1048576};
}

const sizes=(process.argv[2]||'60,240,600').split(',').map(Number);
const out=[];
for(const size of sizes){const m=await measure(size);out.push(m);console.error('measured',size);}
console.log(JSON.stringify({generatedAt:new Date().toISOString(),node:process.version,responseLimitBytes:RESPONSE_LIMIT_BYTES,entryLimit:LIMITS.entries,results:out,finance:financeCapacity()},null,2));
for(const m of out)console.error(`size ${m.size}: ${m.entries} entries, workspace ${mb(m.workspaceBytes)}, reads/RPC cold ${m.readsPerRpcCold} warm ${m.readsPerRpcWarm}, loadContext ${mb(m.loadContextBytes)}, backup ${mb(m.backupExportBytes)}, list ${m.listMsCold}ms cold/${m.listMsWarm}ms warm, write ${m.writeMs}ms, concurrent ok ${m.concurrentWriters.succeeded}/5`);
