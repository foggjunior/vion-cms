import {createHash} from 'node:crypto';
import {assetRefs} from '../src/modules/shared/records.js';
import {siteAssetRefs} from '../src/modules/shared/site.js';
import {routeFor} from '../src/modules/shared/routes.js';
import {documentAssets,routeOf,keyOf,DEFINITIONS} from '../src/review/model.js';
export const publicId=path=>createHash('sha256').update(path).digest('hex');
// A publication feed contains snapshots only. No private operational namespace
// or staff directory is copied, even when an internal envelope has a publish flag.
export function project(entries){
 const out=new Map();
 for(const {store,value:e} of entries){
  if(store==='published'){const path=routeFor(e.kind,e.snapshot.slug);if(path)out.set(path,{path,kind:e.kind,id:e.id,data:e.snapshot});}
  if(store==='sitePublished'){const path='/_site/'+e.kind+'/'+e.id;out.set(path,{path,kind:e.kind,id:e.id,data:e.snapshot});}
  if(store==='taxonomyPublished')out.set('/_taxonomies',{path:'/_taxonomies',kind:'taxonomies',data:e});
  if(store==='meta'&&e.key.startsWith('review-document:')){const env=e.value;if(!env.published||DEFINITIONS[keyOf(env.kind)]?.private)continue;const path=routeOf(env.kind,env.published)||'/_'+env.kind+'/'+env.id;out.set(path,{path,kind:env.kind,id:env.id,data:env.published});}
 }
 const ids=new Set();
 for(const {data:r} of out.values()){
  if(!r)continue;
  if(['tour','destination','accommodation','dayTrip'].includes(r.kind))for(const ref of assetRefs(r))ids.add(ref.assetId);
  else if(['siteSettings','teamMember','teamLineup'].includes(r.kind))for(const ref of siteAssetRefs(r))ids.add(ref.assetId);
  else if(DEFINITIONS[keyOf(r.kind)])for(const id of documentAssets(r))ids.add(id);
 }
 for(const id of ids){const asset=entries.find(e=>e.store==='assets'&&e.key===id)?.value,remote=entries.find(e=>e.store==='assetBlobs'&&e.key===id)?.value;if(asset&&remote?.url)out.set('/_media/'+id,{path:'/_media/'+id,kind:'media',id,data:{id,url:remote.url,alt:asset.alt,width:asset.width,height:asset.height}});}
 const aliases=new Map();
 for(const {store,value:e} of entries){
  if(store==='redirects'&&e.from&&e.to)aliases.set(e.from,e.to);
  if(store==='meta'&&e.key.startsWith('review-document:')){const env=e.value,target=env.published&&routeOf(env.kind,env.published);if(target)for(const prior of env.routeHistory||[])if(prior!==target)aliases.set(prior,target);}
 }
 for(const [from,target] of aliases){let to=target;const seen=new Set([from]);while(aliases.has(to)&&!out.has(to)&&!seen.has(to)){seen.add(to);to=aliases.get(to);}if(!out.has(from)&&out.has(to))out.set(from,{path:from,redirect:to,status:308});}
 return out;
}
export function publicProjection(after,before=[]){const next=project(after),old=project(before),changes=[];for(const [path,value] of next)if(JSON.stringify(old.get(path))!==JSON.stringify(value))changes.push({path:'cms_public/'+publicId(path),value});for(const path of old.keys())if(!next.has(path))changes.push({path:'cms_public/'+publicId(path),remove:true});return changes;}
