// First slice of record-scoped saves (see persistence.commitScoped).
//
// Eligible: ordinary draft edits of an EXISTING record that change only that record's stored entry (plus,
// for editorial documents, a newly created activity entry) and do not touch the public projection.
//   - content.saveDraft for destinations, stays, tours and day trips (expectedVersion is a number);
//   - review.save for editorial documents (expected version > 0).
// Everything else keeps the whole-workspace revision check: new records, slug or path changes (route
// claims are cross-record), publishing/unpublishing/archiving, media, taxonomy, settings, bookings,
// operations, imports and restores.
//
// The read set protects cross-record invariants the edit relies on: the record itself plus every image,
// related record, taxonomy term or editorial document that the edit NEWLY references. If any of those
// changed or disappeared concurrently (for example an image was removed from the library), the save is
// rejected as stale instead of creating a dangling reference. References that were already present are
// covered by the other operation's own guards, which see this record's reference.
import {changes} from './persistence.mjs';
import {assetRefs,relationRefs,taxonomyRefs} from '../src/modules/shared/records.js';
import {documentAssets,routeOf} from '../src/review/model.js';

const CATALOGUE=new Set(['destination','accommodation','tour','dayTrip']);
const added=(next,prev)=>{const old=new Set(prev);return [...new Set(next)].filter(x=>!old.has(x));};

function catalogueReadSet(prev,next){
 return [
  ...added(assetRefs(next).map(r=>r.assetId),assetRefs(prev).map(r=>r.assetId)).map(id=>['assets',id]),
  ...added(relationRefs(next).map(r=>r.id),relationRefs(prev).map(r=>r.id)).map(id=>['records',id]),
  ...added(taxonomyRefs(next).map(r=>r.id),taxonomyRefs(prev).map(r=>r.id)).map(id=>['taxonomies',id]),
 ];
}
function editorialRefs(record){return [record?.categoryId,record?.impactId].filter(Boolean).map(id=>'review-document:'+id);}

export function scopedWrite(service,method,args,beforeEntries,after,projections=[]){
 if(projections.length)return null;
 const delta=changes(beforeEntries,after),find=(store,key)=>beforeEntries.find(e=>e.store===store&&e.key===key);
 if(service==='content'&&method==='saveDraft'&&Number.isInteger(args[1]?.expectedVersion)){
  if(delta.length!==1||!delta[0].entry||delta[0].entry.store!=='records')return null;
  const key=delta[0].entry.key,old=find('records',key);
  if(!old)return null;
  const prev=old.value.record,next=delta[0].entry.value.record;
  if(!CATALOGUE.has(next?.kind)||prev?.kind!==next.kind||prev.slug!==next.slug)return null;
  return {readSet:[['records',key],...catalogueReadSet(prev,next)]};
 }
 if(service==='review'&&method==='save'&&Number.isInteger(args[1])&&args[1]>0){
  const docs=delta.filter(c=>c.entry?.store==='meta'&&c.entry.key.startsWith('review-document:'));
  if(docs.length!==1)return null;
  for(const c of delta)if(c!==docs[0]&&!(c.entry?.store==='meta'&&c.entry.key.startsWith('review-activity:')&&!find('meta',c.entry.key)))return null;
  const key=docs[0].entry.key,old=find('meta',key);
  if(!old)return null;
  const prev=old.value.value,next=docs[0].entry.value.value;
  if(prev?.kind!==next?.kind||routeOf(next.kind,prev.record)!==routeOf(next.kind,next.record)||prev.status!==next.status)return null;
  return {readSet:[['meta',key],
   ...added(documentAssets(next.record),documentAssets(prev.record)).map(id=>['assets',id]),
   ...added(editorialRefs(next.record),editorialRefs(prev.record)).map(k=>['meta',k])]};
 }
 return null;
}

// Single-entry reads that need no workspace snapshot. Each maps the RPC argument to the stored entry and
// unwraps it exactly like the repository method; access checks still run first in execute().
export const POINT_READS=Object.freeze({
 'content.get':{entry:id=>['records',id],value:v=>v},
 'content.getPublished':{entry:id=>['published',id],value:v=>v},
 'bookings.get':{entry:id=>['meta','private-booking:'+id],value:v=>v?.value??null},
 'operations.get':{entry:id=>['meta','private-operation:'+id],value:v=>v?.value??null},
 'review.get':{entry:id=>['meta','review-document:'+id],value:v=>v?.value??null},
});
