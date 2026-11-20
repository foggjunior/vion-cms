// P0 booking and email continuity: bounded backlog import, late arrivals, duplicates, concurrent runs,
// outbox due-selection, leases, provider/local failure split, idempotency window, out-of-order webhooks
// and independent scheduled jobs. In-memory only: fake Firestore, fake provider, no environment files.
import test from 'node:test';import assert from 'node:assert/strict';
import {Timestamp} from 'firebase-admin/firestore';
import {fakeFirestore} from './support/fake-firestore.mjs';
import {createPersistence} from '../persistence.mjs';
import {syncBookings} from '../booking-sync.mjs';
import {processJobs,recordEmailEvent,advancesDelivery,latestDelivery,EMAIL_POLICY} from '../email.mjs';
import {runScheduledJobs} from '../scheduler.mjs';
import {domain} from '../domain.mjs';

const actor={uid:'scheduler',role:'admin',name:'Scheduler',email:''};
const DAY=86400_000,NOW=Date.parse('2026-11-19T10:00:00Z');
const booking=(n,createdAt)=>({fullName:'Guest '+n,email:'guest'+n+'@example.com',phone:'+255700'+String(n).padStart(6,'0'),adultsNumber:2,kidsNumber:0,arrivalDate:'2027-01-10',depatureDate:'2027-01-15',safariIdeas:['Serengeti'],additionalDetails:'',bookingCategory:'Safari',bookingStatus:'requested',createdAt});
const ts=ms=>Timestamp.fromMillis(ms);
function setup(){const db=fakeFirestore(),persistence=createPersistence(()=>db);return {db,persistence,run:(policy={},now=NOW)=>syncBookings(actor,{db,persistence,projectId:'website-project',now:()=>now,policy})};}
async function imported(db,persistence){const {entries}=await persistence.snapshot();return entries.filter(e=>e.store==='meta'&&e.key.startsWith('private-booking:')).map(e=>e.value.value);}

test('One run imports a backlog larger than a single batch, and a repeat run changes nothing',async()=>{
 const {db,persistence,run}=setup();
 for(let i=0;i<450;i++)await db.doc('bookings/'+String(i).padStart(4,'0')+'x').set(booking(i,ts(NOW-i*60_000)));
 const first=await run();
 assert.equal(first.added,450);assert.equal(first.invalidCount,0);assert.equal(first.more,false);
 assert.equal((await imported(db,persistence)).length,450);
 const revision=(await db.doc('cms_state/control').get()).data().revision;
 assert(revision>=5,'imports are chunked into bounded commits');
 const second=await run();
 assert.equal(second.added,0);assert.equal(second.skipped,450);
 assert.equal((await db.doc('cms_state/control').get()).data().revision,revision,'a run with nothing new must not bump the workspace revision');
});

test('Late and clock-skewed arrivals inside the recent window are found regardless of document ID',async()=>{
 const {db,persistence,run}=setup();
 for(let i=0;i<5;i++)await db.doc('bookings/m'+i).set(booking(i,ts(NOW-DAY)));
 await run();
 // Lands after the sweep finished, with a low ID and a client clock three days behind.
 await db.doc('bookings/a-late').set(booking(99,ts(NOW-3*DAY)));
 const next=await run({},NOW+60_000);
 assert.equal(next.added,1);
 assert((await imported(db,persistence)).some(b=>b.sourceId==='a-late'));
});

test('The reconciliation sweep finds requests outside the window or without a timestamp',async()=>{
 const {db,persistence,run}=setup();
 await db.doc('bookings/old-1').set(booking(1,ts(NOW-400*DAY)));
 await db.doc('bookings/old-2').set({...booking(2),createdAt:'2025-05-01T08:00:00.000Z'});
 const result=await run({sweepBatch:1,maxSweepBatches:5});
 assert.equal(result.added,2);
 const rows=await imported(db,persistence);
 assert.equal(rows.find(b=>b.sourceId==='old-2').receivedAt,'2025-05-01T08:00:00.000Z','original received time is kept');
});

test('The sweep resumes across runs and is rate-limited once a cycle completes',async()=>{
 const {db,run}=setup();
 for(let i=0;i<6;i++)await db.doc('bookings/s'+i).set(booking(i,ts(NOW-200*DAY)));
 const a=await run({sweepBatch:2,maxSweepBatches:1});
 assert.equal(a.added,2);assert.equal(a.more,true);
 const b=await run({sweepBatch:2,maxSweepBatches:1});const c=await run({sweepBatch:2,maxSweepBatches:1});const d=await run({sweepBatch:2,maxSweepBatches:1});
 assert.equal(a.added+b.added+c.added+d.added,6);assert.equal(d.more,false);
 const before=db.stats.queries;await run({sweepBatch:2,maxSweepBatches:1},NOW+60_000);
 assert.equal(db.stats.queries-before,1,'only the recent-window query runs until the sweep interval passes');
});

test('Invalid requests are reported by source ID without blocking valid ones',async()=>{
 const {db,run}=setup();
 await db.doc('bookings/good').set(booking(1,ts(NOW)));
 await db.doc('bookings/bad').set({...booking(2,ts(NOW)),fullName:''});
 const result=await run();
 assert.equal(result.added,1);assert.deepEqual(result.invalid,['bad']);
 assert.equal((await db.doc('cms_state/booking-sync').get()).data().invalidCount,1);
});

test('Staff edits to an imported request are never overwritten by later syncs',async()=>{
 const {db,persistence,run}=setup();
 await db.doc('bookings/edit-me').set(booking(1,ts(NOW)));
 await run();
 const before=await persistence.snapshot(),ctx=await domain(before.entries,actor);
 const row=(await ctx.ws.bookings.list())[0];await ctx.ws.bookings.save({...row,status:'Confirmed',additionalDetails:'Staff note'},row.version);
 await persistence.commit(before,await ctx.dump(),actor,'bookings.save');ctx.close();
 await db.doc('bookings/edit-me').set({...booking(1,ts(NOW)),fullName:'Changed on website'});
 await run({},NOW+60_000);
 const [saved]=await imported(db,persistence);
 assert.equal(saved.status,'Confirmed');assert.equal(saved.fullName,'Guest 1');
});

test('A scheduled and a manual sync running together import each request exactly once',async()=>{
 const {db,persistence}=setup();
 for(let i=0;i<30;i++)await db.doc('bookings/c'+i).set(booking(i,ts(NOW-i*1000)));
 // Two server instances share Firestore but not their in-memory caches.
 const other=createPersistence(()=>db);
 const [a,b]=await Promise.all([syncBookings(actor,{db,persistence,projectId:'p',now:()=>NOW}),syncBookings({...actor,uid:'manual'},{db,persistence:other,projectId:'p',now:()=>NOW})]);
 const rows=await imported(db,persistence);
 assert.equal(rows.length,30);assert.equal(new Set(rows.map(r=>r.sourceId)).size,30);
 assert.equal(a.added+b.added,30);
});

// ---- Email outbox ----------------------------------------------------------------------------------
function provider({fail={}}={}){const byKey=new Map(),calls=[];return {calls,delivered:()=>byKey.size,async send(payload,key){calls.push(key);if(fail[key]?.length)return {data:null,error:fail[key].shift()};if(!byKey.has(key))byKey.set(key,'re_'+byKey.size);return {data:{id:byKey.get(key)},error:null};}};}
const job=(id,extra={})=>({id,kind:'team',status:'queued',attempts:0,createdAt:new Date(NOW-1000).toISOString(),to:'team@example.com',from:'cms@example.com',subject:'New enquiry',html:'<p>x</p>',...extra});
async function jobs(db,list){for(const j of list)await db.doc('cms_email_jobs/'+j.id).set(j);}
const status=async(db,id)=>(await db.doc('cms_email_jobs/'+id).get()).data();

test('Due jobs are selected before the limit, so waiting retries cannot starve queued mail',async()=>{
 const db=fakeFirestore(),p=provider();
 await jobs(db,[...Array.from({length:60},(_,i)=>job('wait'+i,{status:'retry',attempts:1,nextAttemptAt:NOW+DAY,createdAt:new Date(NOW-DAY).toISOString()})),...Array.from({length:4},(_,i)=>job('due'+i))]);
 const result=await processJobs(3,{db,send:p.send,now:()=>NOW});
 assert.equal(result.sent,3);assert.equal(result.due,4);
 assert.deepEqual(p.calls.sort(),['vion-due0','vion-due1','vion-due2']);
});

test('A job abandoned mid-send is recovered after its lease expires, with the same idempotency key',async()=>{
 const db=fakeFirestore(),p=provider();
 await jobs(db,[job('stuck',{status:'sending',attempts:1,lease:'dead-worker',leaseUntil:NOW-1,firstAttemptAt:NOW-120_000})]);
 const result=await processJobs(10,{db,send:p.send,now:()=>NOW});
 assert.equal(result.sent,1);assert.deepEqual(p.calls,['vion-stuck']);
 assert.equal((await status(db,'stuck')).status,'sent');
});

test('Provider acceptance followed by a local failure is confirmed later without a second message',async()=>{
 const db=fakeFirestore(),p=provider();
 await jobs(db,[job('flaky')]);
 const original=db.runTransaction.bind(db);let calls=0;
 db.runTransaction=async fn=>{calls++;if(calls===2)throw Object.assign(Error('deadline exceeded'),{code:4});return original(fn);};
 const first=await processJobs(10,{db,send:p.send,now:()=>NOW});
 assert.equal(first.unconfirmed,1);assert.equal((await status(db,'flaky')).status,'sending');
 db.runTransaction=original;
 const second=await processJobs(10,{db,send:p.send,now:()=>NOW+EMAIL_POLICY.leaseMs+1});
 assert.equal(second.sent,1);assert.equal(p.delivered(),1,'the provider idempotency key prevents a duplicate');
 assert.equal((await status(db,'flaky')).resendId,'re_0');
});

test('Transient errors retry with backoff, permanent errors fail at once, and attempts are capped',async()=>{
 const db=fakeFirestore(),p=provider({fail:{'vion-t':[{name:'rate_limit_exceeded'}],'vion-perm':[{name:'validation_error'}],'vion-cap':[{name:'internal_server_error'}]}});
 await jobs(db,[job('t'),job('perm'),job('cap',{status:'retry',attempts:4})]);
 const r=await processJobs(10,{db,send:p.send,now:()=>NOW});
 assert.equal(r.retried,1);assert.equal(r.failed,2);
 const t=await status(db,'t');assert.equal(t.status,'retry');assert.equal(t.nextAttemptAt,NOW+60_000);assert.equal(t.errorCode,'rate_limit_exceeded');
 assert.equal((await status(db,'perm')).status,'failed');assert.equal((await status(db,'cap')).status,'failed');
 assert.equal((await processJobs(10,{db,send:p.send,now:()=>NOW+30_000})).sent,0,'not due yet');
 assert.equal((await processJobs(10,{db,send:p.send,now:()=>NOW+61_000})).sent,1);
});

test('An unconfirmed job is not re-sent after the provider idempotency window',async()=>{
 const db=fakeFirestore(),p=provider();
 await jobs(db,[job('old',{status:'retry',attempts:2,nextAttemptAt:NOW-1,firstAttemptAt:NOW-EMAIL_POLICY.idempotencyWindowMs-1})]);
 const r=await processJobs(10,{db,send:p.send,now:()=>NOW});
 assert.equal(r.failed,1);assert.equal(p.calls.length,0);assert.equal((await status(db,'old')).errorCode,'idempotency-window');
});

test('A worker that lost its lease cannot overwrite the new holder',async()=>{
 const db=fakeFirestore();let release;
 const slow={send:()=>new Promise(resolve=>{release=()=>resolve({data:null,error:{name:'internal_server_error'}});})};
 await jobs(db,[job('race')]);
 const a=processJobs(10,{db,send:slow.send,now:()=>NOW});
 while(!release)await new Promise(r=>setTimeout(r,1));
 const p=provider();await processJobs(10,{db,send:p.send,now:()=>NOW+EMAIL_POLICY.leaseMs+1});
 release();await a;
 assert.equal((await status(db,'race')).status,'sent');
});

test('Webhook delivery state only moves forward and duplicate deliveries are ignored',async()=>{
 const db=fakeFirestore();
 await jobs(db,[job('w',{status:'sent',resendId:'re_9'})]);
 const ev=(type,at)=>({type,created_at:at,data:{email_id:'re_9'}});
 await recordEmailEvent(db,ev('email.delivered','2026-11-19T10:00:05Z'),{eventId:'e2'});
 await recordEmailEvent(db,ev('email.sent','2026-11-19T10:00:01Z'),{eventId:'e1'});
 assert.equal((await status(db,'w')).delivery,'email.delivered','a late sent event must not regress delivered');
 assert.equal((await recordEmailEvent(db,ev('email.bounced','2026-11-19T10:00:09Z'),{eventId:'e2'})).duplicate,true);
 assert.equal((await status(db,'w')).delivery,'email.delivered');
 await recordEmailEvent(db,ev('email.bounced','2026-11-19T10:00:09Z'),{eventId:'e3'});
 assert.equal((await status(db,'w')).delivery,'email.bounced');
 assert(!advancesDelivery({type:'email.bounced'},{type:'email.opened'}));
 assert.equal(latestDelivery([{type:'email.delivered',eventAt:'b'},{type:'email.sent',eventAt:'c'}]).type,'email.delivered');
});

test('An event that arrives before the job records its provider ID is applied when the job is confirmed',async()=>{
 const db=fakeFirestore(),p=provider();
 await jobs(db,[job('early')]);
 await recordEmailEvent(db,{type:'email.delivered',created_at:'2026-11-19T10:00:03Z',data:{email_id:'re_0'}},{eventId:'x1'});
 await processJobs(10,{db,send:p.send,now:()=>NOW});
 assert.equal((await status(db,'early')).delivery,'email.delivered');
});

// ---- Scheduler -----------------------------------------------------------------------------------
test('Scheduled jobs fail independently with redacted, correlated results',async()=>{
 const db=fakeFirestore(),logs=[];
 const {status:code,body}=await runScheduledJobs({db,log:{error:(...a)=>logs.push(a.join(' '))},jobs:{bookings:async()=>{throw Object.assign(Error('Request for guest@example.com failed'),{code:'unavailable'});},email:async()=>({sent:2,failed:0,due:2})}});
 assert.equal(code,500);assert.equal(body.bookings.ok,false);assert.equal(body.bookings.error,'unavailable');
 assert.equal(body.email.ok,true);assert.equal(body.email.sent,2,'email still ran after the booking failure');
 assert(!JSON.stringify(body).includes('guest@example.com'));assert(!logs.join().includes('guest@example.com'));
 assert(logs[0].includes(body.correlationId));
 const record=(await db.doc('cms_state/scheduler').get()).data();
 assert.equal(record.ok,false);assert.equal(record.lastSuccessAt,undefined);
 await runScheduledJobs({db,jobs:{bookings:async()=>({added:0}),email:async()=>({sent:0})}});
 assert((await db.doc('cms_state/scheduler').get()).data().lastSuccessAt);
});

test('Email failure does not stop booking import',async()=>{
 const {db,persistence}=setup();await db.doc('bookings/z').set(booking(1,ts(NOW)));
 const {body}=await runScheduledJobs({db,log:{error(){}},jobs:{bookings:()=>syncBookings(actor,{db,persistence,projectId:'p',now:()=>NOW}),email:async()=>{throw Object.assign(Error('x'),{name:'ResendError'});}}});
 assert.equal(body.bookings.added,1);assert.equal(body.email.ok,false);
});
