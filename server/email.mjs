import {Resend} from 'resend';import {randomUUID,createHash} from 'node:crypto';import {admin} from './firebase.mjs';
export const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function resend(){if(!process.env.RESEND_API_KEY)throw Object.assign(Error('Resend is not configured.'),{status:503});return new Resend(process.env.RESEND_API_KEY)}
export function jobId(bookingId,kind){return createHash('sha256').update(bookingId+':'+kind).digest('hex')}
export function notificationJobs(booking){if(!process.env.RESEND_FROM||!process.env.BOOKING_NOTIFICATION_TO)throw Object.assign(Error('Booking notification addresses are not configured.'),{status:503});return [{path:'cms_email_jobs/'+jobId(booking.id,'team'),value:{id:jobId(booking.id,'team'),kind:'team',bookingId:booking.id,status:'queued',attempts:0,createdAt:new Date().toISOString(),to:process.env.BOOKING_NOTIFICATION_TO,from:process.env.RESEND_FROM,subject:'New Vion safari enquiry',html:`<h1>New safari enquiry</h1><p>${escape(booking.fullName)}</p><p>${escape(booking.email)}</p><p>${escape(booking.phone)}</p><p>${escape(booking.arrivalDate)} – ${escape(booking.departureDate)}</p><p>${escape(booking.safariIdeas)}</p><p>${escape(booking.additionalDetails)}</p>`,replyTo:booking.email||undefined}}];}

// Outbox processing.
//  - Due jobs are selected before the limit is applied: queued/retry jobs whose next attempt time has
//    passed and `sending` jobs whose lease expired (a worker that stopped mid-send), oldest due first.
//  - Claiming a job is a transaction that sets a lease; only the lease holder may record a retry.
//  - Resend honours an idempotency key for 24 hours (https://resend.com/docs/dashboard/emails/idempotency-keys),
//    so a job is only re-sent inside IDEMPOTENCY_WINDOW of its first attempt. Older unconfirmed jobs are
//    failed for human review instead of risking a duplicate message.
//  - Provider acceptance is recorded separately from bookkeeping: if Resend accepted the message but the
//    status update fails, the job is left for lease expiry and the retry returns the same provider ID.
export const EMAIL_POLICY=Object.freeze({maxAttempts:5,leaseMs:90_000,scanLimit:500,idempotencyWindowMs:23*3600_000,concurrentRetryMs:30_000});
const PERMANENT=new Set(['invalid_idempotent_request','validation_error','invalid_from_address','invalid_parameter','missing_required_field','invalid_attachment','invalid_idempotency_key']);
export function dueAt(job){if(job.status==='sending')return job.leaseUntil||0;return job.nextAttemptAt||0;}
export function isDue(job,now){if(!job||!['queued','retry','sending'].includes(job.status))return false;return dueAt(job)<=now;}
export const backoff=attempts=>Math.min(3600_000,60_000*2**Math.max(0,attempts-1));

export async function processJobs(limit=10,deps={}){
 const db=deps.db??admin().db,clock=deps.now??Date.now,policy={...EMAIL_POLICY,...deps.policy};
 const send=deps.send??((payload,key)=>resend().emails.send(payload,{idempotencyKey:key}));
 const scan=await db.collection('cms_email_jobs').where('status','in',['queued','retry','sending']).limit(policy.scanLimit).get();
 const start=clock();
 const due=scan.docs.map(doc=>({doc,job:doc.data()})).filter(({job})=>isDue(job,start)).sort((a,b)=>dueAt(a.job)-dueAt(b.job)||String(a.job.createdAt).localeCompare(String(b.job.createdAt)));
 const result={sent:0,failed:0,retried:0,unconfirmed:0,skipped:0,due:due.length,scanned:scan.size,scanCapped:scan.size>=policy.scanLimit};
 for(const {doc} of due.slice(0,limit)){
  const lease=randomUUID();let job=null,outcome=null;
  await db.runTransaction(async tx=>{
   const data=(await tx.get(doc.ref)).data(),now=clock();
   if(!isDue(data,now))return;
   if(data.firstAttemptAt&&now-data.firstAttemptAt>policy.idempotencyWindowMs){tx.update(doc.ref,{status:'failed',leaseUntil:0,lastError:'Not confirmed within the provider idempotency window. Check delivery events before requeueing.',errorCode:'idempotency-window'});outcome='failed';return;}
   if((data.attempts||0)>=policy.maxAttempts){tx.update(doc.ref,{status:'failed',leaseUntil:0,lastError:'Retry limit reached. Review delivery before retrying.',errorCode:'retry-limit'});outcome='failed';return;}
   job=data;tx.update(doc.ref,{status:'sending',lease,leaseUntil:now+policy.leaseMs,attempts:(data.attempts||0)+1,firstAttemptAt:data.firstAttemptAt||now});
  });
  if(outcome==='failed'){result.failed++;continue;}
  if(!job){result.skipped++;continue;}
  let response,providerError=null;
  try{response=await send({from:job.from,to:job.to,subject:job.subject,html:job.html,...(job.replyTo?{replyTo:job.replyTo}:{})},'vion-'+doc.id);}catch(error){providerError={name:'network_error',message:String(error?.message||'')};}
  const providerId=response?.data?.id;
  if(!providerId){
   const error=response?.error||providerError||{name:'unknown'},attempts=(job.attempts||0)+1,permanent=PERMANENT.has(error.name),concurrent=error.name==='concurrent_idempotent_requests';
   const status=permanent||attempts>=policy.maxAttempts?'failed':'retry';
   await db.runTransaction(async tx=>{const now=(await tx.get(doc.ref)).data();if(now?.lease!==lease||now.status!=='sending')return;tx.update(doc.ref,{status,leaseUntil:0,errorCode:String(error.name||'unknown').slice(0,60),lastError:permanent?'The email provider rejected this message. Review it before requeueing.':'Email provider could not accept the message.',nextAttemptAt:clock()+(concurrent?policy.concurrentRetryMs:backoff(attempts))});}).catch(()=>{});
   status==='failed'?result.failed++:result.retried++;
   continue;
  }
  try{
   const events=await db.collection('cms_email_events').where('providerId','==',providerId).limit(20).get();
   const delivery=latestDelivery(events.docs.map(e=>e.data()));
   await db.runTransaction(async tx=>{const now=(await tx.get(doc.ref)).data();if(now?.status==='sent')return;tx.update(doc.ref,{status:'sent',resendId:providerId,sentAt:new Date(clock()).toISOString(),leaseUntil:0,errorCode:null,lastError:null,...(delivery?{delivery:delivery.type,deliveryAt:delivery.eventAt}:{})});});
   result.sent++;
  }catch{result.unconfirmed++;}
 }
 return result;
}

// Delivery state from Resend webhook events, which can arrive late, repeated or out of order. Terminal
// outcomes outrank progress events; between equals the later provider event time wins.
const RANK={'email.scheduled':1,'email.sent':2,'email.delivery_delayed':3,'email.opened':4,'email.clicked':4,'email.delivered':5,'email.bounced':6,'email.complained':6,'email.failed':6,'email.suppressed':6};
export function advancesDelivery(current,incoming){
 if(!RANK[incoming?.type])return false;
 if(!current?.type)return true;
 const a=RANK[current.type]||0,b=RANK[incoming.type];
 if(b!==a)return b>a;
 return String(incoming.eventAt||'')>String(current.eventAt||'');
}
export function latestDelivery(events){let best=null;for(const e of events){const candidate={type:e.type,eventAt:e.eventAt||e.at};if(advancesDelivery(best,candidate))best=candidate;}return best;}

// Stores one verified webhook event. Duplicate deliveries (same svix-id) are ignored; the job's delivery
// state only moves forward (see advancesDelivery).
export async function recordEmailEvent(db,event,{eventId,received=null,now=()=>new Date().toISOString()}){
 const eventRef=db.collection('cms_email_events').doc(eventId),providerId=event?.data?.email_id||null,eventAt=typeof event?.created_at==='string'?event.created_at:now();
 let duplicate=false;
 await db.runTransaction(async tx=>{
  if((await tx.get(eventRef)).exists){duplicate=true;return;}
  const matching=providerId?await tx.get(db.collection('cms_email_jobs').where('resendId','==',providerId).limit(1)):null;
  tx.create(eventRef,{type:event.type,providerId,eventAt,at:now()});
  if(received)tx.set(db.collection('cms_received_email').doc(received.id),received);
  for(const doc of matching?.docs||[]){const job=doc.data(),current=job.delivery?{type:job.delivery,eventAt:job.deliveryAt}:null,incoming={type:event.type,eventAt};if(advancesDelivery(current,incoming))tx.update(doc.ref,{delivery:event.type,deliveryAt:eventAt,deliveryUpdatedAt:now()});}
 });
 return {duplicate};
}
