// Scheduled work for /api/cron. Booking import and email delivery run independently: a failure in one
// is reported but never prevents the other. The response and the stored run record carry counts and
// error codes only (no names, addresses or message bodies); the correlation ID links the log line, the
// response and cms_state/scheduler.
import {randomUUID} from 'node:crypto';

const code=error=>String(error?.code||error?.name||'error').slice(0,60);

export async function runScheduledJobs({jobs,db=null,now=()=>new Date(),log=console}){
 const correlationId=randomUUID(),started=now(),results={};
 for(const [name,run] of Object.entries(jobs)){
  const t=Date.now();
  try{const value=await run();results[name]={...value,ok:true,ms:Date.now()-t};}
  catch(error){results[name]={ok:false,ms:Date.now()-t,error:code(error)};log.error('CMS scheduled job failed',JSON.stringify({correlationId,job:name,error:code(error)}));}
 }
 const ok=Object.values(results).every(r=>r.ok);
 const record={correlationId,at:started.toISOString(),ok,results:Object.fromEntries(Object.entries(results).map(([k,v])=>[k,{ok:v.ok,ms:v.ms,error:v.error||null,added:v.added??null,sent:v.sent??null,failed:v.failed??null,due:v.due??null,more:v.more??null,invalidCount:v.invalidCount??null}]))};
 if(db)await db.doc('cms_state/scheduler').set({...record,...(ok?{lastSuccessAt:record.at}:{})},{merge:true}).catch(error=>log.error('CMS scheduler record failed',JSON.stringify({correlationId,error:code(error)})));
 return {status:ok?200:500,body:{ok,correlationId,...results}};
}
