// Tells the public website which cached CMS responses a committed publication change made stale.
//
// Contract (website: src/app/api/cms/revalidate/route.js):
//   POST <WEBSITE_REVALIDATE_URL>
//   X-Vion-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with CMS_REVALIDATE_SECRET>
//   {"jobId":"…","paths":["/tours/x","/_media/…"],"kinds":["tour","media"]}
// The website accepts a signature for 5 minutes, maps paths and kinds to its cache tags for the current CMS
// origin and expires them immediately. The secret is server-only on both sides; it is not a deployment
// credential and grants nothing but cache expiry.
//
// Delivery is an outbox: the job is written in the same transaction as the publication change, sent right
// after the response (Next `after()`), and retried by the scheduler with exponential backoff. If delivery
// never succeeds, the website's fallback TTL still bounds staleness. When the URL or secret is not
// configured, no job is written and only the fallback TTL applies.
import {createHmac,randomUUID} from 'node:crypto';

export const REVALIDATION_POLICY=Object.freeze({maxAttempts:8,timeoutMs:3000,scanLimit:200,maxPaths:500});
export const revalidationConfigured=(env=process.env)=>!!(env.WEBSITE_REVALIDATE_URL&&env.CMS_REVALIDATE_SECRET);

export function revalidationTargets(projections){
 const paths=new Set(),kinds=new Set();
 for(const change of projections||[]){if(typeof change.publicPath==='string')paths.add(change.publicPath);if(change.kind)kinds.add(change.kind);}
 return {paths:[...paths].sort(),kinds:[...kinds].sort()};
}

// The outbox write for a commit, or null when there is nothing to invalidate or no website is configured.
export function revalidationJob(projections,{env=process.env,now=()=>new Date()}={}){
 if(!revalidationConfigured(env))return null;
 const {paths,kinds}=revalidationTargets(projections);if(!paths.length&&!kinds.length)return null;
 const id=randomUUID();
 // Very large changes (imports, reconciliation) invalidate by kind rather than listing every path.
 const value={id,status:'queued',attempts:0,createdAt:now().toISOString(),paths:paths.length>REVALIDATION_POLICY.maxPaths?[]:paths,kinds,allPaths:paths.length>REVALIDATION_POLICY.maxPaths};
 return {path:'cms_revalidate_jobs/'+id,value};
}

export function signRevalidation(body,secret,timestamp){
 return `t=${timestamp},v1=${createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export async function deliverRevalidation(job,{env=process.env,fetcher=fetch,now=()=>Date.now()}={}){
 const body=JSON.stringify({jobId:job.id,paths:job.paths,kinds:job.kinds,...(job.allPaths?{allPaths:true}:{})});
 const signature=signRevalidation(body,env.CMS_REVALIDATE_SECRET,Math.floor(now()/1000));
 try{
  const response=await fetcher(env.WEBSITE_REVALIDATE_URL,{method:'POST',headers:{'Content-Type':'application/json','X-Vion-Signature':signature},body,signal:AbortSignal.timeout(REVALIDATION_POLICY.timeoutMs)});
  return response.ok?{ok:true}:{ok:false,error:'http-'+response.status,permanent:[400,401,403,413].includes(response.status)};
 }catch(error){return {ok:false,error:String(error?.name||'network').slice(0,40)};}
}

const backoff=attempts=>Math.min(3600_000,30_000*2**Math.max(0,attempts-1));
// Sends queued or due jobs, oldest first. Returns counts only.
export async function processRevalidationJobs(db,{env=process.env,fetcher=fetch,now=()=>Date.now(),limit=20}={}){
 if(!revalidationConfigured(env))return {configured:false,sent:0,retried:0,failed:0,due:0};
 const scan=await db.collection('cms_revalidate_jobs').where('status','in',['queued','retry']).limit(REVALIDATION_POLICY.scanLimit).get(),t=now();
 const due=scan.docs.map(doc=>({doc,job:doc.data()})).filter(({job})=>!(job.nextAttemptAt>t)).sort((a,b)=>(a.job.nextAttemptAt||0)-(b.job.nextAttemptAt||0)||String(a.job.createdAt).localeCompare(String(b.job.createdAt)));
 const result={configured:true,sent:0,retried:0,failed:0,due:due.length};
 for(const {doc} of due.slice(0,limit)){
  let job=null;
  await db.runTransaction(async tx=>{const data=(await tx.get(doc.ref)).data();if(!data||!['queued','retry'].includes(data.status)||data.nextAttemptAt>now())return;job=data;tx.update(doc.ref,{status:'sending',attempts:(data.attempts||0)+1,leaseUntil:now()+REVALIDATION_POLICY.timeoutMs*4});});
  if(!job)continue;
  const outcome=await deliverRevalidation(job,{env,fetcher,now});
  const attempts=(job.attempts||0)+1;
  if(outcome.ok){await doc.ref.update({status:'sent',sentAt:new Date(now()).toISOString(),leaseUntil:0});result.sent++;}
  else if(outcome.permanent||attempts>=REVALIDATION_POLICY.maxAttempts){await doc.ref.update({status:'failed',errorCode:outcome.error,leaseUntil:0});result.failed++;}
  else{await doc.ref.update({status:'retry',errorCode:outcome.error,nextAttemptAt:now()+backoff(attempts),leaseUntil:0});result.retried++;}
 }
 // A job left in `sending` by a stopped worker returns to the queue once its lease has expired.
 const stuck=await db.collection('cms_revalidate_jobs').where('status','==','sending').limit(REVALIDATION_POLICY.scanLimit).get();
 for(const doc of stuck.docs)if((doc.data().leaseUntil||0)<now())await doc.ref.update({status:'retry',nextAttemptAt:now(),leaseUntil:0});
 return result;
}
