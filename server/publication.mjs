import {createHash} from 'node:crypto';
import {assetRefs} from '../src/modules/shared/records.js';
import {siteAssetRefs} from '../src/modules/shared/site.js';
import {routeFor} from '../src/modules/shared/routes.js';
import {documentAssets,routeOf,keyOf,DEFINITIONS} from '../src/review/model.js';
import {publicRecord,accommodationSummary,publicTaxonomy} from './public-fields.mjs';
export const publicId=path=>createHash('sha256').update(path).digest('hex');

const CATALOGUE=['tour','destination','accommodation','dayTrip'];
const SITE=['siteSettings','teamMember','teamLineup'];
// An accommodation whose public page is disabled has no detail route, list entry or alias target.
const ownPage=pub=>pub.kind!=='accommodation'||pub.snapshot?.publicPageEnabled!==false;
function stayIds(tour){
 const ids=new Set();
 for(const day of tour.itinerary||[]){
  for(const id of day.accommodationIds||[])ids.add(id);
  for(const room of day.accommodationRooms||[])if(room?.accommodationId)ids.add(room.accommodationId);
 }
 return ids;
}

// A publication feed contains allowlisted fields of published snapshots only (see public-fields.mjs).
// No private operational namespace, staff directory, draft or withheld field is copied, even when an
// internal envelope has a publish flag.
export function project(entries){
 const out=new Map();
 const published=new Map(entries.filter(e=>e.store==='published').map(e=>[e.value.id,e.value]));
 for(const {store,value:e} of entries){
  if(store==='published'){
   if(!ownPage(e))continue;
   const path=routeFor(e.kind,e.snapshot?.slug),data=publicRecord(e.kind,e.snapshot);
   if(!path||!data)continue;
   if(e.kind==='tour'){
    // Tours may name a stay whose page is disabled; they receive a minimal summary, never the record.
    const summaries=[...stayIds(e.snapshot)].map(id=>published.get(id)).filter(p=>p?.kind==='accommodation'&&!ownPage(p)).map(p=>accommodationSummary(p.snapshot));
    if(summaries.length)data.accommodationSummaries=summaries;
   }
   out.set(path,{path,kind:e.kind,id:e.id,data});
  }
  if(store==='sitePublished'&&SITE.includes(e.kind)){const path='/_site/'+e.kind+'/'+e.id,data=publicRecord(e.kind,e.snapshot);if(data)out.set(path,{path,kind:e.kind,id:e.id,data});}
  if(store==='taxonomyPublished')out.set('/_taxonomies',{path:'/_taxonomies',kind:'taxonomies',data:publicTaxonomy(e)});
  if(store==='meta'&&e.key.startsWith('review-document:')){const env=e.value;if(!env.published||DEFINITIONS[keyOf(env.kind)]?.private)continue;const data=publicRecord(env.kind,env.published);if(!data)continue;const path=routeOf(env.kind,env.published)||'/_'+env.kind+'/'+env.id;out.set(path,{path,kind:env.kind,id:env.id,data});}
 }
 // Media is derived from the projected (public) data, so withheld fields and disabled pages add no images.
 const ids=new Set();
 for(const {data:r} of out.values()){
  if(!r)continue;
  if(CATALOGUE.includes(r.kind)){for(const ref of assetRefs(r))ids.add(ref.assetId);for(const stay of r.accommodationSummaries||[])if(stay.cover?.assetId)ids.add(stay.cover.assetId);}
  else if(SITE.includes(r.kind))for(const ref of siteAssetRefs(r))ids.add(ref.assetId);
  else if(DEFINITIONS[keyOf(r.kind)])for(const id of documentAssets(r))ids.add(id);
 }
 const assets=new Map(),blobs=new Map();
 for(const e of entries){if(e.store==='assets')assets.set(e.key,e.value);if(e.store==='assetBlobs')blobs.set(e.key,e.value);}
 for(const id of ids){const asset=assets.get(id),remote=blobs.get(id);if(asset&&remote?.url)out.set('/_media/'+id,{path:'/_media/'+id,kind:'media',id,data:{id,url:remote.url,alt:asset.alt,width:asset.width,height:asset.height}});}
 const aliases=new Map();
 for(const {store,value:e} of entries){
  if(store==='redirects'&&e.from&&e.to)aliases.set(e.from,e.to);
  if(store==='meta'&&e.key.startsWith('review-document:')){const env=e.value,target=env.published&&routeOf(env.kind,env.published);if(target)for(const prior of env.routeHistory||[])if(prior!==target)aliases.set(prior,target);}
 }
 // An alias is emitted only when its chain ends at a public path; aliases to withheld pages are dropped.
 for(const [from,target] of aliases){let to=target;const seen=new Set([from]);while(aliases.has(to)&&!out.has(to)&&!seen.has(to)){seen.add(to);to=aliases.get(to);}if(!out.has(from)&&out.has(to))out.set(from,{path:from,redirect:to,status:308});}
 return out;
}
// Changes to write to cms_public. Each change also names the public path and the kind (current or, for a
// removal, previous) so the website can be told exactly which cached responses to invalidate.
export function publicProjection(after,before=[]){const next=project(after),old=project(before),changes=[];for(const [path,value] of next){const prior=old.get(path);if(JSON.stringify(prior)!==JSON.stringify(value))changes.push({path:'cms_public/'+publicId(path),value,publicPath:path,kind:value.kind||prior?.kind||null});}for(const [path,prior] of old)if(!next.has(path))changes.push({path:'cms_public/'+publicId(path),remove:true,publicPath:path,kind:prior.kind||null});return changes;}
