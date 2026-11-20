// Imports website booking requests (the public site's `bookings` collection) into the CMS inbox.
//
// Each run processes the whole backlog it can reach within a time budget instead of one fixed batch:
//   1. Recent window: every request whose `createdAt` falls in the last RECENT_DAYS, ordered by
//      (createdAt, id). New requests, writes that reach Firestore late (the website's offline write
//      queue) and moderately skewed client clocks are all inside this window, so they are picked up on
//      the next run regardless of their document ID.
//   2. Reconciliation sweep: a document-ID scan resumed across runs (cursor in cms_state/booking-sync),
//      restarted every SWEEP_INTERVAL. It covers older requests and any whose createdAt is missing or not
//      a timestamp.
// Requests are de-duplicated by their deterministic CMS ID with point reads of cms_entries; the workspace
// is loaded only when there is something new to import. New requests are imported through the same
// domain validation in bounded, revision-checked commits (retried on a concurrent edit). The cursor is
// stored after the imports succeed and outside the workspace revision, so a run that imports nothing
// does not invalidate staff edits in progress. Imports never modify the website or send email.
import {FieldPath} from 'firebase-admin/firestore';import {admin} from './firebase.mjs';import {snapshot,commit,existingEntries} from './persistence.mjs';import {domain} from './domain.mjs';import {mapWebsiteBooking} from '../src/operations/website-bookings.js';
export const SYNC_POLICY=Object.freeze({recentDays:14,recentPage:200,maxRecentPages:50,sweepBatch:200,maxSweepBatches:10,sweepIntervalMs:6*3600_000,budgetMs:40_000,importChunk:100,staleRetries:3,maxInvalidReported:100});
function value(v){if(v===null)return {nullValue:null};if(v?.toDate)return {timestampValue:v.toDate().toISOString()};if(v instanceof Date)return {timestampValue:v.toISOString()};if(typeof v==='string')return {stringValue:v};if(typeof v==='number')return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};if(typeof v==='boolean')return {booleanValue:v};if(Array.isArray(v))return {arrayValue:{values:v.map(value)}};return {mapValue:{fields:Object.fromEntries(Object.entries(v||{}).map(([k,x])=>[k,value(x)]))}};}

async function collect(db,collection,state,policy,clock){
 const docs=new Map(),started=clock();let scanned=0;
 const since=new Date(started-policy.recentDays*86400_000);
 let last=null;
 for(let pages=1;;pages++){
  let query=db.collection(collection).where('createdAt','>=',since).orderBy('createdAt').orderBy(FieldPath.documentId()).limit(policy.recentPage);
  if(last)query=query.startAfter(last.createdAt,last.id);
  const page=(await query.get()).docs;scanned+=page.length;
  const before=docs.size;for(const doc of page)docs.set(doc.id,doc);
  if(page.length<policy.recentPage)break;
  // Stop on the time budget, a page cap, or a page that adds nothing new (cursor not advancing).
  if(clock()-started>policy.budgetMs||pages>=policy.maxRecentPages||docs.size===before)return {docs,scanned,sweep:{cursor:state.sweepCursor??null,lastSweepAt:state.lastSweepAt??0,complete:false},budgetExceeded:true};
  last={createdAt:page.at(-1).get('createdAt'),id:page.at(-1).id};
 }
 let cursor=state.sweepCursor??null,lastSweepAt=state.lastSweepAt??0,complete=false;
 const due=cursor!==null||started-lastSweepAt>=policy.sweepIntervalMs;
 for(let batch=0;due&&batch<policy.maxSweepBatches&&clock()-started<=policy.budgetMs;batch++){
  let query=db.collection(collection).orderBy(FieldPath.documentId()).limit(policy.sweepBatch);
  if(cursor)query=query.startAfter(cursor);
  const page=(await query.get()).docs;scanned+=page.length;
  for(const doc of page)docs.set(doc.id,doc);
  if(page.length<policy.sweepBatch){cursor=null;lastSweepAt=started;complete=true;break;}
  cursor=page.at(-1).id;
 }
 return {docs,scanned,sweep:{cursor,lastSweepAt,complete},budgetExceeded:false};
}

async function importChunk(rows,actor,persistence,policy){
 for(let attempt=0;;attempt++){
  const before=await persistence.snapshot(),context=await domain(before.entries,actor);
  try{
   let added=0,skipped=0;const received=new Map();
   for(const row of rows){if(await context.ws.bookings.get(row.id)){skipped++;continue;}await context.ws.bookings.save(row,0);received.set(row.id,row.receivedAt);added++;}
   if(added)await persistence.commit(before,(await context.dump()).map(e=>e.store==='meta'&&e.value.key.startsWith('private-booking:')&&received.has(e.value.value.id)?{...e,value:{...e.value,value:{...e.value.value,receivedAt:received.get(e.value.value.id)}}}:e),actor,'bookings.sync');
   return {added,skipped};
  }catch(error){if(error.code==='stale'&&attempt<policy.staleRetries)continue;throw error;}
  finally{context.close();}
 }
}

export async function syncBookings(actor,deps={}){
 const db=deps.db??admin().db,persistence=deps.persistence??{snapshot,commit,existing:existingEntries},policy={...SYNC_POLICY,...deps.policy},clock=deps.now??Date.now;
 const projectId=deps.projectId??process.env.FIREBASE_PROJECT_ID,collection=deps.collection??(process.env.WEBSITE_BOOKINGS_COLLECTION||'bookings');
 if(!/^[a-zA-Z0-9_-]+$/.test(collection))throw Error('Invalid booking collection setting.');
 if(!projectId)throw Object.assign(Error('Firebase server configuration is missing.'),{status:503});
 const cursorRef=db.doc('cms_state/booking-sync'),state=(await cursorRef.get()).data()||{};
 const {docs,scanned,sweep,budgetExceeded}=await collect(db,collection,state,policy,clock);
 const rows=[],invalid=[];
 for(const doc of docs.values()){
  try{const fields=Object.fromEntries(Object.entries(doc.data()).map(([k,v])=>[k,value(v)]));rows.push(await mapWebsiteBooking({name:`projects/${projectId}/databases/(default)/documents/bookings/${doc.id}`,fields},projectId));}
  catch{invalid.push(doc.id);}
 }
 const known=await persistence.existing(rows.map(row=>['meta','private-booking:'+row.id]));
 const fresh=rows.filter(row=>!known.has('meta:private-booking:'+row.id));
 let added=0,skipped=rows.length-fresh.length;
 for(let i=0;i<fresh.length;i+=policy.importChunk){const result=await importChunk(fresh.slice(i,i+policy.importChunk),actor,persistence,policy);added+=result.added;skipped+=result.skipped;}
 const at=new Date(clock()).toISOString();
 await cursorRef.set({sweepCursor:sweep.cursor,lastSweepAt:sweep.lastSweepAt,at,invalid:invalid.slice(0,policy.maxInvalidReported),invalidCount:invalid.length,lastRun:{added,skipped,scanned,sweepComplete:sweep.complete,budgetExceeded}});
 return {added,skipped,invalid:invalid.slice(0,policy.maxInvalidReported),invalidCount:invalid.length,scanned,more:sweep.cursor!==null||budgetExceeded};
}
