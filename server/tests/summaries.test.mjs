// Area 1: one dashboard summary instead of four whole-data reads, and server-side list pages. Results must
// equal what the screens computed from the full data before, stay bounded as the workspace grows, page
// deterministically through ties and concurrent inserts, and respect role boundaries. In memory only.
import test from 'node:test';import assert from 'node:assert/strict';
import {execute} from '../execute.mjs';import {createPersistence,LIMITS} from '../persistence.mjs';import {domain} from '../domain.mjs';
import {fakeFirestore} from './support/fake-firestore.mjs';import {buildWorkspace,benchActor} from '../../tools/bench-fixtures.mjs';
import {STATUS_FILTERS,sortsFor,byTitle} from '../../src/modules/shared/list-definitions.js';
import {dashboardSummary,monthKeys} from '../../src/review/summary.js';
import {newRecord} from '../../src/modules/shared/records.js';import {newDocument} from '../../src/review/model.js';
import {recalc} from '../../src/operations/costs.js';

const admin={...benchActor,role:'admin'};
async function workspace(size){
 const entries=await buildWorkspace(size),db=fakeFirestore(),seed=createPersistence(()=>db,{cache:false});
 for(let i=0;i<entries.length;i+=LIMITS.changesPerCommit-50){const before=await seed.snapshot();await seed.commit(before,[...before.entries,...entries.slice(i,i+LIMITS.changesPerCommit-50)],admin,'seed');}
 return {db,persistence:createPersistence(()=>db),entries};
}
const call=(p,actor,service,method,...args)=>execute(actor,service,method,args,p);
let small,large;
test.before(async()=>{small=await workspace(40);large=await workspace(200);});

test('The dashboard summary equals the previous full-data calculation',async()=>{
 const p=small.persistence,timeZone='Africa/Dar_es_Salaam';
 const [summary,ctx,bookings,ops,docs]=await Promise.all([call(p,admin,'summaries','dashboard',{timeZone}),call(p,admin,'content','loadContext'),call(p,admin,'bookings','list'),call(p,admin,'operations','list'),call(p,admin,'review','list')]);
 const quotes=ops.filter(x=>x.kind==='quotation');
 assert.equal(summary.bookings.total,bookings.length);assert.equal(summary.quotations.total,quotes.length);
 assert.equal(summary.published,ctx.published.size+docs.filter(x=>x.published).length);
 assert.equal(summary.drafts,[...ctx.records.values()].filter(x=>!ctx.published.has(x.id)&&x.record.status!=='archived').length+docs.filter(x=>x.status==='draft').length);
 assert.deepEqual(summary.bookings.recent.map(b=>b.id),bookings.slice(0,6).map(b=>b.id));
 const today=new Intl.DateTimeFormat('en-CA',{timeZone}).format(new Date());
 assert.deepEqual(summary.bookings.arrivals.map(b=>b.id),bookings.filter(b=>b.arrivalDate&&b.arrivalDate>=today&&Date.parse(b.arrivalDate)-Date.parse(today)<=14*86400000&&b.status!=='Cancelled').slice(0,4).map(b=>b.id));
 const keys=monthKeys(new Date(),timeZone),fmt=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit'});
 assert.deepEqual(summary.bookings.months.map(m=>m.count),keys.map(k=>bookings.filter(b=>fmt.format(new Date(b.receivedAt))===k).length));
 assert(summary.bookings.months.reduce((s,m)=>s+m.count,0)>0,'fixture bookings fall in the six-month window');
 let cents=new Map();for(const q of quotes){try{const t=recalc(q);cents.set(q.currency,(cents.get(q.currency)||0n)+BigInt(t.total.replace('.','')));}catch{}}
 assert.deepEqual(new Map(summary.report.quoteTotals),new Map([...cents].map(([c,v])=>[c,`${v/100n}.${String(v%100n).padStart(2,'0')}`])));
});

test('Months follow the viewer\'s time zone at month boundaries',()=>{
 const ctx={published:new Map(),records:new Map(),siteRecords:new Map()};
 const at='2026-06-30T22:30:00.000Z',now=new Date('2026-07-15T12:00:00Z');
 const months=tz=>dashboardSummary({ctx,docs:[],bookings:[{id:'b',receivedAt:at,status:'x'}],quotes:[],timeZone:tz,now}).bookings.months;
 assert.equal(months('Africa/Dar_es_Salaam').find(m=>m.count).key,'2026-07');
 assert.equal(months('Europe/London').find(m=>m.count).key,'2026-06');
 assert.equal(months('Not/AZone').length,6,'an invalid zone falls back to business time');
});

test('The summary stays small as the workspace grows; the old screen data did not',async()=>{
 const size=async(w,fn)=>Buffer.byteLength(JSON.stringify(await fn(w.persistence)));
 const summary=p=>call(p,admin,'summaries','dashboard',{});
 const [s1,s2]=[await size(small,summary),await size(large,summary)];
 assert(s1<10_000&&s2<10_000,`summary bytes ${s1} / ${s2}`);
 assert(Math.abs(s2-s1)<2_000,'summary size independent of record count');
 const before=await size(large,p=>Promise.all([call(p,admin,'content','loadContext'),call(p,admin,'bookings','list'),call(p,admin,'operations','list'),call(p,admin,'review','list')]));
 assert(before>100*s2,`old dashboard data ${before} bytes vs summary ${s2}`);
});

test('Booking and quotation data stay with booking roles; staff entries stay with administrators',async()=>{
 const p=small.persistence,doc=newDocument('users');doc.title='Private staff';doc.email='staff-private@example.com';await call(p,admin,'review','save',doc,0);
 for(const role of ['editor','publisher','viewer']){
  const s=await call(p,{...admin,role},'summaries','dashboard',{}),json=JSON.stringify(s);
  assert.equal(s.bookings.total,0);assert.equal(s.bookings.recent.length,0);assert.equal(s.quotations.total,0);assert.equal(s.bookings.allowed,false);
  assert(!json.includes('@example.com'),role+' received contact data');
  const page=await call(p,{...admin,role},'summaries','bookingPage',{});assert.equal(page.rows.length,0);assert.equal(page.restricted,true);
  await assert.rejects(()=>call(p,{...admin,role},'summaries','editorialPage','users',{}),e=>e.status===403);
 }
 const r=await call(p,{...admin,role:'reservations'},'summaries','dashboard',{});assert(r.bookings.total>0);
 await assert.rejects(()=>call(p,{...admin,role:'accounting'},'summaries','dashboard',{}),e=>e.status===403);
 assert.equal((await call(p,admin,'summaries','editorialPage','users',{})).filtered,1);
});

test('Catalogue pages reproduce the previous list order for every status and sort without duplicates',async()=>{
 const p=large.persistence,ctx=await call(p,admin,'content','loadContext');
 for(const kind of ['destination','accommodation','tour']){
  for(const status of Object.keys(STATUS_FILTERS))for(const sort of Object.keys(sortsFor(kind))){
   const compare=(a,b)=>sortsFor(kind)[sort].compare(a,b)||byTitle(a,b);
   const expected=[...ctx.records.values()].filter(e=>e.kind===kind).filter(STATUS_FILTERS[status].test).sort(compare).map(e=>e.id);
   const seen=[];let after=null,pages=0;
   do{const page=await call(p,admin,'summaries','cataloguePage',kind,{status,sort,after,limit:13});seen.push(...page.rows.map(r=>r.id));assert.equal(page.filtered,expected.length);after=page.next;pages++;}while(after&&pages<50);
   assert.deepEqual(seen,expected,`${kind} ${status} ${sort}`);
  }
 }
});

test('Cursors stay stable through ties and through records added between pages',async()=>{
 const db=fakeFirestore(),p=createPersistence(()=>db),ids=[];
 for(let i=0;i<9;i++){const r=Object.assign(newRecord('destination'),{title:'Same title',slug:'same-'+i});ids.push((await call(p,admin,'content','saveDraft',r,{expectedVersion:null})).id);}
 const first=await call(p,admin,'summaries','cataloguePage','destination',{sort:'title',limit:4});
 // A record that sorts before the cursor and one after it are added between page requests.
 for(const title of ['Aaa first','Zzz last']){const r=Object.assign(newRecord('destination'),{title,slug:title.toLowerCase().replace(' ','-')});await call(p,admin,'content','saveDraft',r,{expectedVersion:null});}
 const rest=[];let after=first.next;while(after){const page=await call(p,admin,'summaries','cataloguePage','destination',{sort:'title',limit:4,after});rest.push(...page.rows);after=page.next;}
 const all=[...first.rows,...rest].map(r=>r.id);
 assert.equal(new Set(all).size,all.length,'no duplicates');
 assert(ids.every(id=>all.includes(id)),'no tied record skipped');
 assert(rest.some(r=>r.title==='Zzz last'),'later insert after the cursor appears');
 await assert.rejects(()=>call(p,admin,'summaries','cataloguePage','destination',{after:'not-a-cursor!'}),e=>e.status===400);
 await assert.rejects(()=>call(p,admin,'summaries','cataloguePage','destination',{limit:5000}),e=>e.status===400);
});

test('Bookings, gallery and editorial pages cover every row with bounded payloads',async()=>{
 const p=large.persistence,all=await call(p,admin,'bookings','list');
 const walk=async(method,args,key='next')=>{const rows=[];let after=null,n=0;do{const page=await call(p,admin,'summaries',method,...args(after));rows.push(...page.rows);assert(Buffer.byteLength(JSON.stringify(page))<200_000,method+' page too large');after=page[key];n++;}while(after&&n<100);return rows;};
 const bookings=await walk('bookingPage',after=>[{after,limit:50}]);
 assert.deepEqual(bookings.map(b=>b.id),all.map(b=>b.id));
 assert.deepEqual(Object.keys(bookings[0]).sort(),['email','fullName','id','phone','receivedAt'],'only the list columns');
 const found=await call(p,admin,'summaries','bookingPage',{q:'guest7@example.com'});assert.equal(found.filtered,1);
 const ctx=await call(p,admin,'content','loadContext');
 const media=await walk('mediaPage',after=>[{after}]);
 assert.equal(media.length,ctx.assets.size);assert(media.some(m=>m.usage.length>0),'usage is reported');
 const posts=await call(p,admin,'summaries','editorialPage','blogs',{page:1});
 assert.equal(posts.page,1);assert.equal(posts.rows.length,12);assert(posts.pages>=4);
 const search=await call(p,admin,'summaries','editorialPage','blogs',{q:'post 0007'});assert.equal(search.filtered,1);
});

test('The local preview computes the same summaries without a server',async()=>{
 const d=await domain(small.entries,admin);
 try{const local=await d.ws.summaries.dashboard({timeZone:'Africa/Dar_es_Salaam'}),remote=await call(small.persistence,admin,'summaries','dashboard',{timeZone:'Africa/Dar_es_Salaam'});
  assert.equal(local.bookings.total,remote.bookings.total);assert.equal(local.published,remote.published);}
 finally{d.close();}
});
