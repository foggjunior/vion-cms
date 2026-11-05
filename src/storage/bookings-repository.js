// Local operational data, never a public content record or publication snapshot.
import { STORES, request, runTransaction } from './idb.js';
const PREFIX='private-booking:';
const text=v=>String(v??'').trim();
export function bookingIssues(b){
 const issues=[];
 if(!text(b.fullName))issues.push('Full name is required.');
 if(b.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email))issues.push('Enter a valid email address.');
 for(const k of ['adults','kids'])if(b[k]!==null&&(!Number.isInteger(b[k])||b[k]<0))issues.push(`${k} must be a nonnegative whole number.`);
 if(b.adults!==null&&b.kids!==null&&(b.adults||0)+(b.kids||0)<1)issues.push('At least one traveller is required.');
 for(const k of ['arrivalDate','departureDate'])if(b[k]&&(!/^\d{4}-\d{2}-\d{2}$/.test(b[k])||Number.isNaN(Date.parse(b[k]+'T00:00:00Z'))||new Date(b[k]+'T00:00:00Z').toISOString().slice(0,10)!==b[k]))issues.push(`${k} is invalid.`);
 if(b.arrivalDate&&b.departureDate&&b.departureDate<b.arrivalDate)issues.push('Departure cannot be before arrival.');
 if(!['Not Confirmed','Confirmed','Cancelled'].includes(b.status))issues.push('Unknown booking status.');
 if(!['Manual entry','Website email (manually entered)','Other platform','Website form data'].includes(b.source))issues.push('Unknown source.');
 return issues;
}
export function newBooking(){return {id:crypto.randomUUID(),schemaVersion:1,version:0,fullName:'',email:'',phone:'',adults:1,kids:0,arrivalDate:'',departureDate:'',tourId:'',tourName:'',tourType:'',safariIdeas:'',additionalDetails:'',status:'Not Confirmed',source:'Manual entry',receivedAt:new Date().toISOString()};}
export function createBookingsRepository(ws){return {
 async list(){return (await runTransaction(ws.db,[STORES.meta],'readonly',tx=>request(tx.objectStore(STORES.meta).getAll()))).filter(x=>x.key.startsWith(PREFIX)).map(x=>x.value).sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)||a.id.localeCompare(b.id));},
 async get(id){return (await runTransaction(ws.db,[STORES.meta],'readonly',tx=>request(tx.objectStore(STORES.meta).get(PREFIX+id))))?.value||null;},
 async save(input,expectedVersion=input.version){
 const b=structuredClone(input);for(const k of ['fullName','email','phone','tourId','tourName','tourType','safariIdeas','additionalDetails'])b[k]=text(b[k]);
 const issues=bookingIssues(b);if(issues.length)throw new Error(issues.join(' '));
 if(!/^[0-9a-f-]{36}$/i.test(b.id))throw new Error('Invalid booking ID.');
 return runTransaction(ws.db,[STORES.meta],'readwrite',async tx=>{
 const store=tx.objectStore(STORES.meta);const old=(await request(store.get(PREFIX+b.id)))?.value;
 if((old?.version||0)!==expectedVersion)throw new Error('This booking changed in another tab. Reload before saving.');
 const saved={...b,receivedAt:old?.receivedAt||new Date().toISOString(),updatedAt:new Date().toISOString(),version:(old?.version||0)+1};
 ws.faults.check('booking.save');await request(store.put({key:PREFIX+b.id,value:saved}));return saved;
 });}
};}
