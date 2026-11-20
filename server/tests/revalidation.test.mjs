// Area 2 (CMS side): committed publication changes queue a signed website cache invalidation in the same
// transaction; drafts never do; delivery retries, fails permanently on rejection and recovers stuck jobs.
// Synthetic configuration only (placeholder URL and secret); fetch is a stub.
import test from 'node:test';import assert from 'node:assert/strict';
import {execute} from '../execute.mjs';import {createPersistence} from '../persistence.mjs';
import {signRevalidation,revalidationJob,processRevalidationJobs,deliverRevalidation} from '../revalidation.mjs';
import {fakeFirestore} from './support/fake-firestore.mjs';import {newRecord} from '../../src/modules/shared/records.js';

const admin={uid:'alice',name:'Alice',email:'',role:'admin'},env={WEBSITE_REVALIDATE_URL:'https://site.example.test/api/cms/revalidate',CMS_REVALIDATE_SECRET:'synthetic-test-secret'};
const now=new Date().toISOString(),img=crypto.randomUUID();
const assets=[{store:'assets',key:img,value:{id:img,fileName:'a.png',type:'image/png',size:1,width:10,height:10,alt:'A',credit:'',caption:'',createdAt:now,updatedAt:now,version:1}},{store:'assetBlobs',key:img,value:{id:img,url:'https://res.cloudinary.com/demo/image/upload/v1/vion-cms/'+img+'.png',publicId:'vion-cms/'+img}}];
function withEnv(values,fn){const saved={};for(const k of Object.keys(env)){saved[k]=process.env[k];if(values[k]===undefined)delete process.env[k];else process.env[k]=values[k];}return fn().finally(()=>{for(const [k,v] of Object.entries(saved))v===undefined?delete process.env[k]:process.env[k]=v;});}
const jobs=db=>Object.entries(db.dump()).filter(([k])=>k.startsWith('cms_revalidate_jobs/')).map(([,v])=>v);

test('Signature matches the shared test vector used by the website',()=>{
 assert.equal(signRevalidation('{"jobId":"job-1","paths":["/tours/northern"],"kinds":["tour"]}','synthetic-test-secret',1763550000),'t=1763550000,v1=5c123a740d600b2d5093ae920fa650c814c4c52a011a128ffdba5750401fbc88');
});

test('Publish, rename and unpublish queue invalidations atomically; draft saves never do',()=>withEnv(env,async()=>{
 const db=fakeFirestore(),p=createPersistence(()=>db),before=await p.snapshot();await p.commit(before,assets,admin,'seed');
 let env1=await execute(admin,'content','saveDraft',[Object.assign(newRecord('destination'),{title:'Arusha',slug:'arusha',overview:'O',bestTime:'June',cover:{assetId:img,alt:'A'}}),{expectedVersion:null}],p);
 assert.equal(jobs(db).length,0,'a new draft changes nothing public');
 env1=await execute(admin,'content','saveDraft',[{...env1.record,overview:'Edited draft'},{expectedVersion:env1.record.version}],p);
 assert.equal(jobs(db).length,0,'a draft edit changes nothing public');
 const published=await execute(admin,'content','publish',[env1.id,{expectedVersion:env1.record.version}],p);
 let [job]=jobs(db);assert.equal(job.status,'queued');
 assert(job.paths.includes('/destinations/arusha'));assert(job.paths.includes('/_media/'+img));assert.deepEqual(job.kinds,['destination','media']);
 const renamed=await execute(admin,'content','saveDraft',[{...published.record,slug:'arusha-town'},{expectedVersion:published.record.version}],p);
 await execute(admin,'content','publish',[env1.id,{expectedVersion:renamed.record.version}],p);
 const rename=jobs(db).find(j=>j.paths.includes('/destinations/arusha-town'));assert(rename.paths.includes('/destinations/arusha'),'the old path (now a 308) is invalidated too');
 const current=await execute(admin,'content','get',[env1.id],p);
 await execute(admin,'content','unpublish',[env1.id,{expectedVersion:current.record.version}],p);
 const withdrawn=jobs(db).at(-1);assert(withdrawn.paths.includes('/destinations/arusha-town'));assert(withdrawn.kinds.includes('destination'));
}));

test('Without a configured website no job is written',()=>withEnv({},async()=>{
 assert.equal(revalidationJob([{publicPath:'/tours/x',kind:'tour'}]),null);
}));

test('Very large changes invalidate by kind instead of listing every path',()=>{
 const changes=Array.from({length:600},(_,i)=>({publicPath:'/tours/t'+i,kind:'tour'}));
 const job=revalidationJob(changes,{env});assert.equal(job.value.paths.length,0);assert.equal(job.value.allPaths,true);assert.deepEqual(job.value.kinds,['tour']);
});

test('Delivery is signed; failures retry with backoff, rejections fail, stuck jobs return to the queue',async()=>{
 const db=fakeFirestore(),seen=[];let t=1_000_000_000_000;
 const ok=async(url,init)=>{seen.push({url,init});return new Response('{}',{status:200});};
 for(const id of ['a','b','c'])await db.doc('cms_revalidate_jobs/'+id).set({id,status:'queued',attempts:0,createdAt:'2026-11-19T00:00:0'+id.charCodeAt(0)%10+'Z',paths:['/tours/'+id],kinds:['tour']});
 const r=await processRevalidationJobs(db,{env,fetcher:ok,now:()=>t});
 assert.equal(r.sent,3);const {init}=seen[0];
 const ts=/^t=(\d+),v1=[0-9a-f]{64}$/.exec(init.headers['X-Vion-Signature'])[1];
 assert.equal(init.headers['X-Vion-Signature'],signRevalidation(init.body,env.CMS_REVALIDATE_SECRET,Number(ts)));
 await db.doc('cms_revalidate_jobs/d').set({id:'d',status:'queued',attempts:0,createdAt:'x',paths:['/tours/d'],kinds:['tour']});
 await processRevalidationJobs(db,{env,fetcher:async()=>new Response('',{status:503}),now:()=>t});
 let d=(await db.doc('cms_revalidate_jobs/d').get()).data();assert.equal(d.status,'retry');assert.equal(d.nextAttemptAt,t+30_000);
 assert.equal((await processRevalidationJobs(db,{env,fetcher:ok,now:()=>t+1000})).sent,0,'not due yet');
 assert.equal((await processRevalidationJobs(db,{env,fetcher:ok,now:()=>t+31_000})).sent,1);
 await db.doc('cms_revalidate_jobs/e').set({id:'e',status:'queued',attempts:0,createdAt:'x',paths:['/tours/e'],kinds:['tour']});
 await processRevalidationJobs(db,{env,fetcher:async()=>new Response('',{status:401}),now:()=>t});
 assert.equal((await db.doc('cms_revalidate_jobs/e').get()).data().status,'failed','a rejected signature is not retried forever');
 await db.doc('cms_revalidate_jobs/f').set({id:'f',status:'sending',attempts:1,leaseUntil:t-1,createdAt:'x',paths:['/tours/f'],kinds:['tour']});
 await processRevalidationJobs(db,{env,fetcher:ok,now:()=>t});
 assert.equal((await db.doc('cms_revalidate_jobs/f').get()).data().status,'retry');
 assert.equal((await processRevalidationJobs(db,{env:{},fetcher:ok})).configured,false);
 const net=await deliverRevalidation({id:'g',paths:[],kinds:['tour']},{env,fetcher:async()=>{throw Object.assign(Error('down'),{name:'TypeError'});}});
 assert.deepEqual(net,{ok:false,error:'TypeError'});
});
