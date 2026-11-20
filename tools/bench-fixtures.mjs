// Synthetic workspace fixtures for benchmarks (no Firebase, no environment files). The record shape and
// text lengths match the capacity measurements in docs/PRODUCTION_READINESS.md §10: records are split evenly
// into published destinations, stays, 7-day tours and three-section blog posts. Bookings (one per record,
// spread over six months, some arriving in the next 14 days) and quotations (one per ten records) feed
// the dashboard. Deterministic apart from generated IDs.
import {domain} from '../server/domain.mjs';
import {newRecord} from '../src/modules/shared/records.js';
import {newDocument} from '../src/review/model.js';
import {newBooking} from '../src/storage/bookings-repository.js';
import {newQuote} from '../src/operations/costs.js';

export const benchActor={uid:'bench',name:'Bench',email:'',role:'admin'};
const words=n=>Array.from({length:n},(_,i)=>['safari','plains','migration','lodge','crater','guide','sunrise','acacia','river','camp'][i%10]).join(' ');
const day=86400_000;

export async function buildWorkspace(size,{now=Date.now(),bookings=true}={}){
 const per=Math.max(1,Math.round(size/4)),created=new Date(now).toISOString(),img=Array.from({length:per*2},()=>crypto.randomUUID());
 const media=img.flatMap((id,i)=>[{store:'assets',key:id,value:{id,fileName:'photo-'+i+'.jpg',type:'image/jpeg',size:900000,width:2560,height:1707,alt:'Photo '+i,credit:'',caption:'',createdAt:created,updatedAt:created,version:1}},{store:'assetBlobs',key:id,value:{id,url:'https://res.cloudinary.com/demo/image/upload/v1/vion-cms/'+id+'.jpg',publicId:'vion-cms/'+id}}]);
 const d=await domain(media,benchActor),ws=d.ws,publish=async rec=>{const s=await ws.content.saveDraft(rec,{expectedVersion:null});return ws.content.publish(s.record.id,{expectedVersion:s.record.version});};
 const dests=[],stays=[];
 for(let i=0;i<per;i++){const r=Object.assign(newRecord('destination'),{title:'Destination '+String(i).padStart(4,'0'),slug:'destination-'+i,overview:words(450),wildlife:words(120),highlights:words(80),bestTime:words(40),order:i%7,cover:{assetId:img[i%img.length],alt:'Cover'},gallery:[1,2,3].map(k=>({assetId:img[(i+k)%img.length],alt:'G'}))});await publish(r);dests.push(r.id);}
 for(let i=0;i<per;i++){const r=Object.assign(newRecord('accommodation'),{title:'Stay '+String(i).padStart(4,'0'),slug:'stay-'+i,type:'Lodge',standard:i%2?'Luxury':'Mid-range',description:words(250),destinationId:dests[i%dests.length],amenities:['Wi-Fi','Pool'],cover:{assetId:img[(i+5)%img.length],alt:'Stay'}});await publish(r);stays.push(r.id);}
 for(let i=0;i<per;i++){const days=7,r=Object.assign(newRecord('tour'),{title:'Tour '+String(i).padStart(4,'0'),slug:'tour-'+i,summary:words(40),overview:words(500),durationDays:days,featured:i%5===0,destinationIds:[dests[i%dests.length]],cover:{assetId:img[(i+7)%img.length],alt:'Tour'},itinerary:Array.from({length:days},(_,k)=>({id:crypto.randomUUID(),dayNumber:k+1,title:'Day '+(k+1),description:words(90),destinationIds:[dests[(i+k)%dests.length]],accommodationIds:[stays[(i+k)%stays.length]],meals:['Breakfast'],activities:['Game drive']})),inclusions:['Guide','Park fees'],exclusions:['Tips'],pricing:{mode:'request'}});await publish(r);}
 for(let i=0;i<per;i++){const b=newDocument('blogs');Object.assign(b,{title:'Post '+String(i).padStart(4,'0'),slug:'post-'+i,body:'@vion-rich:'+['A','B','C'].map(h=>`<h2>${h} ${i}</h2><p>${words(300)}</p>`).join(''),excerpt:words(30),author:'Vion',publishDate:'2026-01-01',categoryId:'default-blog-safari',coverAssetId:img[i%img.length],imageAlt:'Cover',seoTitle:'Post',seoDescription:'Post'});const e=await ws.review.save(b,0);await ws.review.action(e.id,'publish',e.version).catch(()=>{});}
 if(bookings){
  for(let i=0;i<size;i++){const b=newBooking(),received=now-(i%180)*day-(i%24)*3600_000,arrival=new Date(now+((i%30)-5)*day).toISOString().slice(0,10);Object.assign(b,{fullName:'Guest '+i,email:'guest'+i+'@example.com',phone:'+255700'+String(i).padStart(6,'0'),adults:2,kids:i%3,arrivalDate:arrival,departureDate:arrival,safariIdeas:'Serengeti, Ngorongoro',additionalDetails:words(40),status:i%11===0?'Cancelled':'Not Confirmed',receivedAt:new Date(received).toISOString()});await ws.bookings.save(b,0);}
  for(let i=0;i<Math.max(1,Math.round(size/10));i++){const q=Object.assign(newQuote(),{title:'Quotation '+i,fullName:'Guest '+i,currency:i%2?'USD':'TZS'});await ws.operations.save(q,0);}
 }
 const entries=await d.dump();d.close();return entries;
}
