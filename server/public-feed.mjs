// Public read model for the website: /api/public/catalogue and /api/public/content.
//
// Catalogue pages are deterministic: documents of one kind ordered by their cms_public document ID
// (a hash of the public path), resumed with `after=<last id>`. A page holds at most `limit` documents
// and stays under PAGE_BYTE_BUDGET of JSON, well below Vercel's 4.5 MB function response limit, so a
// large inventory pages instead of failing. Every stored document passes sanitizePublished() before it
// is served, which also hides documents written before the field allowlist existed.
import {FieldPath} from 'firebase-admin/firestore';
import {assetRefs} from '../src/modules/shared/records.js';
import {siteAssetRefs} from '../src/modules/shared/site.js';
import {documentAssets,DEFINITIONS,keyOf,DEFAULT_BLOG_CATEGORIES} from '../src/review/model.js';
import {sanitizePublished,publicRecord} from './public-fields.mjs';
import {publicId} from './publication.mjs';
import {entryId} from './persistence.mjs';

export const PUBLIC_KINDS=Object.freeze(['tour','destination','accommodation','dayTrip','blog','blogCategory','faq','migration','impact','foundation','experience','page','menu','teamMember','teamLineup','siteSettings','taxonomies']);
// The default page size matches the previous fixed 200-item response, so a website build that does not
// paginate behaves exactly as before up to 200 records (and fails loudly beyond them).
export const DEFAULT_PAGE=200,MAX_PAGE=200,PAGE_BYTE_BUDGET=3_000_000;
const MEDIA_BATCH=300;
const invalid=message=>Object.assign(Error(message),{status:400});

export function parseCatalogueQuery(params){
 const kind=params.get('kind');
 if(!kind||!PUBLIC_KINDS.includes(kind))throw invalid('Choose a supported public kind.');
 const after=params.get('after')||null;
 if(after!==null&&!/^[0-9a-f]{64}$/.test(after))throw invalid('Invalid page cursor.');
 const raw=params.get('limit'),limit=raw===null?DEFAULT_PAGE:Number(raw);
 if(!Number.isInteger(limit)||limit<1||limit>MAX_PAGE)throw invalid('Choose a page size from 1 to '+MAX_PAGE+'.');
 return {kind,after,limit,includeMedia:params.get('include')==='media'};
}

export function mediaIds(data){
 if(!data?.kind)return [];
 if(['tour','destination','accommodation','dayTrip'].includes(data.kind))return [...assetRefs(data).map(ref=>ref.assetId),...(data.accommodationSummaries||[]).map(stay=>stay.cover?.assetId)].filter(Boolean);
 if(['siteSettings','teamMember','teamLineup'].includes(data.kind))return siteAssetRefs(data).map(ref=>ref.assetId);
 if(DEFINITIONS[keyOf(data.kind)])return documentAssets(data);
 return [];
}

async function mediaFor(db,ids){
 const media={},list=[...new Set(ids)];
 for(let i=0;i<list.length;i+=MEDIA_BATCH){
  const refs=list.slice(i,i+MEDIA_BATCH).map(id=>db.collection('cms_public').doc(publicId('/_media/'+id)));
  for(const doc of await db.getAll(...refs)){const value=doc.exists?sanitizePublished(doc.data()):null;if(value?.kind==='media'&&typeof value.data.url==='string')media[value.data.id]=value.data;}
 }
 return media;
}

export async function cataloguePage(db,{kind,after=null,limit=DEFAULT_PAGE,includeMedia=false}){
 let query=db.collection('cms_public').where('kind','==',kind).orderBy(FieldPath.documentId()).limit(limit+1);
 if(after)query=query.startAfter(after);
 const docs=(await query.get()).docs;
 const items=[];let bytes=0,last=null,consumed=0;
 for(const doc of docs.slice(0,limit)){
  const value=sanitizePublished(doc.data());
  const size=value?Buffer.byteLength(JSON.stringify(value)):0;
  if(items.length&&bytes+size>PAGE_BYTE_BUDGET)break;
  consumed++;last=doc.id;
  if(value){items.push(value);bytes+=size;}
 }
 const next=consumed<docs.length?last:null;
 const defaults=kind==='blogCategory'&&!after?DEFAULT_BLOG_CATEGORIES.map(category=>({kind,id:category.id,data:category})):[];
 const page={items:[...defaults,...items],next,truncated:!!next};
 if(includeMedia)page.media=await mediaFor(db,items.flatMap(item=>mediaIds(item.data)));
 return page;
}

// The public feed is not cached here (no CDN or browser caching). The website is the single cache layer:
// it caches by CMS origin, path and kind, receives signed invalidations after each committed publication
// change (server/revalidation.mjs), and refetches anything older than its hard maximum age. A second cache
// here would let an invalidated website read stale data back from the CMS edge.
// X-Vion-Generated-At tells the website when a response was produced, so it can enforce that maximum age.
export const PUBLIC_CACHE='no-store';
export const NOT_FOUND_CACHE='no-store';
export const feedHeaders=extra=>({'Cache-Control':PUBLIC_CACHE,'X-Vion-Generated-At':new Date().toISOString(),...extra});

// A team entry can be missing from cms_public (documents written before team projection existed) while
// its published snapshot exists. Read that one stored entry instead of the whole workspace: a public,
// unauthenticated path must never trigger a whole-workspace read.
const TEAM_PATH=/^\/_site\/(teamLineup|teamMember)\/([a-z0-9-]+)$/i;
export async function publishedTeamEntry(db,path){
 const match=path.match(TEAM_PATH);if(!match)return undefined;
 const [,kind,id]=match,doc=await db.collection('cms_entries').doc(entryId('sitePublished',id)).get();
 if(!doc.exists)return undefined;
 const entry=doc.data();if(entry.store!=='sitePublished'||entry.key!==id)return undefined;
 const published=JSON.parse(entry.json);if(published?.kind!==kind)return undefined;
 const data=publicRecord(kind,published.snapshot);
 return data?{path,kind,id,data}:undefined;
}

// One published document by public path. With includeMedia, the images it references are embedded so a
// detail page needs one request instead of one per image.
export async function contentByPath(db,path,{fallback=publishedTeamEntry,includeMedia=false}={}){
 const doc=await db.collection('cms_public').doc(publicId(path)).get();
 let value=doc.exists?doc.data():undefined;
 if(!value&&fallback)value=await fallback(db,path);
 const clean=sanitizePublished(value);
 if(clean?.data&&includeMedia){const ids=mediaIds(clean.data);if(ids.length)clean.media=await mediaFor(db,ids);}
 return clean;
}
