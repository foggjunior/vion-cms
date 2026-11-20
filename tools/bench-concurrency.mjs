// Concurrent-save behaviour on the shared workspace (isolated: in-memory Firestore double, no env files).
//   node tools/bench-concurrency.mjs [pairs=20] [mode=scoped|global]
// mode=global reproduces the previous behaviour exactly: persistence without commitScoped/readValues, so
// every save takes the whole-workspace revision check.
// Two staff (separate server instances, separate caches) save drafts at the same time:
//   - different records: both saves should succeed;
//   - the same record version: exactly one should succeed and the other get a stale conflict.
// Reports success/conflict counts and p50/p95 save latency.
import {performance} from 'node:perf_hooks';
import {execute} from '../server/execute.mjs';import {createPersistence} from '../server/persistence.mjs';
import {fakeFirestore} from '../server/tests/support/fake-firestore.mjs';import {newRecord} from '../src/modules/shared/records.js';
const actor={uid:'a',name:'A',email:'',role:'admin'},pairs=Number(process.argv[2]||20),mode=process.argv[3]||'scoped';
const instance=db=>{const p=createPersistence(()=>db);return mode==='global'?{snapshot:p.snapshot,commit:p.commit}:p;};
const quantile=(v,q)=>{const s=[...v].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.ceil(q*s.length)-1)];};
async function scenario(same){
 const db=fakeFirestore(),setup=createPersistence(()=>db),ids=[];
 for(let i=0;i<2*pairs;i++){const r=Object.assign(newRecord('destination'),{title:'Park '+i,slug:'park-'+i});ids.push((await execute(actor,'content','saveDraft',[r,{expectedVersion:null}],setup)).record);}
 let ok=0,stale=0,other=0;const times=[];
 for(let p=0;p<pairs;p++){
  const a=instance(db),b=instance(db),first=ids[2*p],second=same?first:ids[2*p+1];
  const run=async(persistence,record,title)=>{const t=performance.now();try{await execute(actor,'content','saveDraft',[{...record,title},{expectedVersion:record.version}],persistence);ok++;}catch(e){e.code==='stale'?stale++:other++;}times.push(performance.now()-t);};
  await Promise.all([run(a,first,first.title+' A'),run(b,second,second.title+' B')]);
 }
 return {mode,scenario:same?'same record':'different records',attempts:2*pairs,succeeded:ok,stale,other,p50ms:+quantile(times,0.5).toFixed(1),p95ms:+quantile(times,0.95).toFixed(1)};
}
console.log(JSON.stringify({pairs,results:[await scenario(false),await scenario(true)]},null,2));
