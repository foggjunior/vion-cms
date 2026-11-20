// P0 public data minimisation: field allowlists, conditional visibility, disabled accommodation pages,
// stored-document sanitising, deterministic catalogue pages and projection reconciliation.
// Synthetic records only; persistence is in memory (domain.mjs + fake Firestore). No environment files.
import test from 'node:test';import assert from 'node:assert/strict';
import contentSchema from '../../schemas/content.schema.json' with {type:'json'};
import siteSchema from '../../schemas/site.schema.json' with {type:'json'};
import {domain} from '../domain.mjs';
import {project,publicProjection,publicId} from '../publication.mjs';
import {PUBLIC_FIELDS,WITHHELD_FIELDS,ACCOMMODATION_SUMMARY_FIELDS,sanitizePublished} from '../public-fields.mjs';
import {cataloguePage,contentByPath,parseCatalogueQuery,PAGE_BYTE_BUDGET} from '../public-feed.mjs';
import {planReconciliation,applyReconciliation,readStoredProjection,summarise} from '../public-reconcile.mjs';
import {assetRefs,formToRecord,newRecord,recordToForm,taxonomyRefs} from '../../src/modules/shared/records.js';
import {comparePricing,describePrice,pricingIssues} from '../../src/modules/shared/pricing.js';
import {newDocument,DEFINITIONS} from '../../src/review/model.js';
import {newSettings,newMember} from '../../src/modules/shared/site.js';
import {fakeFirestore} from './support/fake-firestore.mjs';

const actor={uid:'alice',name:'Alice',email:'alice@example.com',role:'admin'};
const now=new Date().toISOString();
const image=id=>[{store:'assets',key:id,value:{id,fileName:id+'.png',type:'image/png',size:10,width:1200,height:800,alt:'Alt '+id.slice(0,4),credit:'',caption:'',createdAt:now,updatedAt:now,version:1}},{store:'assetBlobs',key:id,value:{id,url:'https://res.cloudinary.com/demo/image/upload/v1/vion-cms/'+id+'.png',publicId:'vion-cms/'+id}}];
const SENTINEL={internal:'STAFF-ONLY-NAME',phone:'+255700000999',guest:'guest-secret@example.com',supplier:'SUPPLIER-NET-RATE-4321',finance:'LEDGER-REF-777',directory:'directory-private@example.com',draft:'UNPUBLISHED-DRAFT-TEXT'};

async function publish(ws,record){const saved=await ws.content.saveDraft(record,{expectedVersion:null});return ws.content.publish(saved.record.id,{expectedVersion:saved.record.version});}

// One published destination (with a staff-only name), an enabled stay with a hidden phone, a disabled stay
// with its own gallery, a tour that names both stays, a later unpublished draft edit, and private records.
async function seed(){
 const img=Array.from({length:8},()=>crypto.randomUUID());
 const d=await domain(img.flatMap(image),actor),ws=d.ws;
 const dest=Object.assign(newRecord('destination'),{title:'Serengeti',slug:'serengeti',internalName:SENTINEL.internal,featured:true,overview:'Plains',bestTime:'June',cover:{assetId:img[0],alt:'Plains'}});
 await publish(ws,dest);
 const open=Object.assign(newRecord('accommodation'),{publicPageEnabled:true,title:'Open Lodge',slug:'open-lodge',type:'Lodge',standard:'Luxury',description:'Lodge',destinationId:dest.id,publicPhone:SENTINEL.phone,publicPhoneVisible:false,cover:{assetId:img[1],alt:'Lodge'}});
 await publish(ws,open);
 const hidden=Object.assign(newRecord('accommodation'),{title:'Quiet Camp',slug:'quiet-camp',type:'Camp',standard:'Mid-range',description:'Private description',destinationId:dest.id,website:'https://camp.example',publicPageEnabled:false,cover:{assetId:img[2],alt:'Camp'},gallery:[{assetId:img[3],alt:'Camp gallery'}]});
 await publish(ws,hidden);
 const day=(n,stay)=>({id:crypto.randomUUID(),dayNumber:n,title:'Day '+n,description:'Drive',destinationIds:[dest.id],accommodationIds:[stay],meals:[],activities:[],photos:n===1?[{assetId:img[5],alt:'Game drive'}]:[]});
 const tour=Object.assign(newRecord('tour'),{title:'Northern',slug:'northern',overview:'Overview',summary:'Summary',durationDays:2,destinationIds:[dest.id],cover:{assetId:img[4],alt:'Car'},itinerary:[day(1,open.id),day(2,hidden.id)],inclusions:['Guide'],exclusions:['Tips'],pricing:{mode:'groupUsd',group2:'700',group4:'600.25',group6:'500'}});
 const published=await publish(ws,tour);
 await ws.content.saveDraft({...published.record,overview:SENTINEL.draft},{expectedVersion:published.record.version});
 const staff=newDocument('users');staff.title='Private staff';staff.email=SENTINEL.directory;let row=await ws.review.save(staff,0);
 const entries=await d.dump();d.close();
 // Private operational rows as stored by the operations, bookings and finance features.
 entries.push(
  {store:'meta',key:'private-booking:b1',value:{key:'private-booking:b1',value:{id:'b1',kind:'booking',fullName:'Guest',email:SENTINEL.guest,phone:'+1555'}}},
  {store:'meta',key:'private-operation:q1',value:{key:'private-operation:q1',value:{kind:'quotation',supplierCost:SENTINEL.supplier,profitPercent:'20'}}},
  {store:'meta',key:'private-operation:f1',value:{key:'private-operation:f1',value:{kind:'finance',reference:SENTINEL.finance}}}
 );
 return {entries,ids:{dest:dest.id,open:open.id,hidden:hidden.id,tour:tour.id,staff:row.id},img};
}

test('Every schema and editorial field is explicitly classified as public or withheld',()=>{
 for(const kind of ['destination','accommodation','tour','dayTrip']){
  const known=new Set([...PUBLIC_FIELDS[kind],...WITHHELD_FIELDS[kind]]);
  for(const field of Object.keys(contentSchema.$defs[kind].properties))assert(known.has(field),kind+'.'+field+' is not classified in server/public-fields.mjs');
 }
 for(const kind of ['siteSettings','teamMember','teamLineup']){
  const known=new Set([...PUBLIC_FIELDS[kind],...WITHHELD_FIELDS[kind]]);
  for(const field of Object.keys(siteSchema.$defs[kind].properties))assert(known.has(field),kind+'.'+field+' is not classified');
 }
 for(const def of Object.values(DEFINITIONS)){
  if(def.private){assert.equal(PUBLIC_FIELDS[def.kind],undefined,def.kind+' is private and must have no public fields');continue;}
  for(const field of def.fields)assert(PUBLIC_FIELDS[def.kind]?.includes(field.key),def.kind+'.'+field.key+' is not classified');
 }
 for(const kind of Object.keys(WITHHELD_FIELDS))for(const field of WITHHELD_FIELDS[kind])assert(!PUBLIC_FIELDS[kind].includes(field),kind+'.'+field+' is both public and withheld');
});

test('Projection withholds staff-only, hidden, draft and private operational values',async()=>{
 const {entries}=await seed(),feed=JSON.stringify([...project(entries).values()]);
 for(const [name,value] of Object.entries(SENTINEL))assert(!feed.includes(value),name+' value reached the public feed');
 const dest=project(entries).get('/destinations/serengeti').data;
 assert.equal(dest.internalName,undefined);assert.equal(dest.status,undefined);assert.equal(dest.title,'Serengeti');
 const open=project(entries).get('/accommodations/open-lodge').data;
 assert.equal(open.publicPhone,undefined);assert.equal(open.publicPhoneVisible,undefined);assert.equal(open.publicPageEnabled,undefined);
});

test('A visible accommodation phone is published; hidden social, review and lineup entries are not',async()=>{
 const share=crypto.randomUUID(),d=await domain(image(share),actor),ws=d.ws;
 try{
  const stay=Object.assign(newRecord('accommodation'),{publicPageEnabled:true,title:'Lodge',slug:'lodge',type:'Lodge',standard:'Luxury',description:'D',noDestinationReason:'Town hotel',publicPhone:'+255700000001',publicPhoneVisible:true,cover:{assetId:share,alt:'Lodge'}});
  await publish(ws,stay);
  const settings=newSettings();
  Object.assign(settings.company,{name:'Vion',officeAddress:'Arusha'});Object.assign(settings.contact,{primaryPhone:'+255700000002',email:'hello@example.com'});
  settings.branding.logoLight={source:'bundled',key:'vion-logo-dark-artwork',alt:'Vion'};settings.branding.shareImage={assetId:share,alt:'Share'};
  settings.social=[{id:'s1',network:'Instagram',url:'https://instagram.com/vion',visible:true},{id:'s2',network:'Facebook',url:'https://facebook.com/old',visible:false}];
  settings.reviews=[{id:'r1',platform:'Tripadvisor',url:'https://tripadvisor.com/x',description:'Reviews',buttonLabel:'Read reviews',visible:false}];
  const saved=await ws.site.saveSettings(settings,{expectedVersion:null});
  await ws.site.publishSettings({expectedVersion:saved.record.version});
  const out=project(await d.dump());
  assert.equal(out.get('/accommodations/lodge').data.publicPhone,'+255700000001');
  assert.equal(out.get('/accommodations/lodge').data.noDestinationReason,undefined);
  const site=[...out.values()].find(v=>v.kind==='siteSettings');
  assert(site,'settings were not published');
  assert.deepEqual(site.data.social.map(s=>s.id),['s1']);assert.equal(site.data.reviews.length,0);
  // Lineup visibility is applied by the projector itself.
  const lineup=sanitizePublished({path:'/_site/teamLineup/team-lineup',kind:'teamLineup',id:'team-lineup',data:{id:'team-lineup',kind:'teamLineup',entries:[{memberId:'m1',visible:true},{memberId:'m2',visible:false}]}});
  assert.deepEqual(lineup.data.entries.map(e=>e.memberId),['m1']);
 }finally{d.close()}
});

test('A disabled accommodation has no page, list entry, alias or gallery media; tours keep a minimal summary',async()=>{
 const {entries,ids,img}=await seed();
 // A historical alias pointing at the disabled page must not be emitted either.
 entries.push({store:'redirects',key:'r1',value:{id:'r1',from:'/accommodations/old-quiet-camp',to:'/accommodations/quiet-camp',statusCode:308,recordId:ids.hidden,kind:'accommodation'}});
 const out=project(entries);
 assert(!out.has('/accommodations/quiet-camp'));
 assert(!out.has('/accommodations/old-quiet-camp'));
 assert(![...out.values()].some(v=>v.kind==='accommodation'&&v.id===ids.hidden),'disabled stay listed');
 assert(!out.has('/_media/'+img[3]),'disabled stay gallery image published');
 const tour=out.get('/tours/northern').data;
 assert.equal(tour.accommodationSummaries.length,1);
 const stay=tour.accommodationSummaries[0];
 assert.equal(stay.id,ids.hidden);assert.equal(stay.title,'Quiet Camp');assert.equal(stay.publicPage,false);
 for(const key of Object.keys(stay))assert([...ACCOMMODATION_SUMMARY_FIELDS,'publicPage'].includes(key),'summary leaked '+key);
 assert.equal(stay.description,undefined);assert.equal(stay.website,undefined);assert.equal(stay.slug,undefined);
 assert(out.has('/_media/'+img[2]),'summary cover should be published for the tour card');
 // The enabled stay keeps its page and is not summarised.
 assert(out.has('/accommodations/open-lodge'));
});

test('Stored documents from the previous projector are sanitised on read',()=>{
 const legacyDest={path:'/destinations/a',kind:'destination',id:'d',data:{id:'d',kind:'destination',title:'A',slug:'a',internalName:SENTINEL.internal,status:'published',version:3}};
 const legacyStay={path:'/accommodations/b',kind:'accommodation',id:'b',data:{id:'b',kind:'accommodation',title:'B',slug:'b',publicPhone:SENTINEL.phone,publicPhoneVisible:false,publicPageEnabled:true}};
 const legacyDisabled={path:'/accommodations/c',kind:'accommodation',id:'c',data:{id:'c',kind:'accommodation',title:'C',slug:'c',publicPageEnabled:false}};
 assert.equal(sanitizePublished(legacyDest).data.internalName,undefined);
 assert.equal(sanitizePublished(legacyStay).data.publicPhone,undefined);
 assert.equal(sanitizePublished(legacyDisabled),null);
 assert.equal(sanitizePublished({path:'/_x',kind:'unknownKind',data:{secret:1}}),null,'unknown kinds fail closed');
 assert.deepEqual(sanitizePublished({path:'/a',redirect:'/b',status:308,extra:'x'}),{path:'/a',redirect:'/b',status:308});
});

test('Sanitising is idempotent for documents written by the current projector',async()=>{
 const {entries}=await seed();
 for(const value of project(entries).values())assert.deepEqual(sanitizePublished(value),value,value.path);
});

async function storeFeed(entries){const db=fakeFirestore();for(const change of publicProjection(entries))await db.doc(change.path).set(change.value);return db;}

test('Content reads serve sanitised documents and treat a disabled stored page as missing',async()=>{
 const db=fakeFirestore();
 await db.doc('cms_public/'+publicId('/accommodations/c')).set({path:'/accommodations/c',kind:'accommodation',id:'c',data:{id:'c',kind:'accommodation',title:'C',slug:'c',publicPageEnabled:false}});
 await db.doc('cms_public/'+publicId('/destinations/a')).set({path:'/destinations/a',kind:'destination',id:'a',data:{id:'a',kind:'destination',title:'A',slug:'a',internalName:SENTINEL.internal}});
 assert.equal(await contentByPath(db,'/accommodations/c'),null);
 assert.equal((await contentByPath(db,'/destinations/a')).data.internalName,undefined);
 assert.equal(await contentByPath(db,'/missing'),null);
});

test('Catalogue pages cover more than 200 records deterministically without duplicates or gaps',async()=>{
 const db=fakeFirestore(),total=437;
 for(let i=0;i<total;i++){const path='/tours/t-'+i;await db.doc('cms_public/'+publicId(path)).set({path,kind:'tour',id:'t'+i,data:{id:'t'+i,kind:'tour',title:'Tour '+i,slug:'t-'+i}});}
 // A stored disabled stay and a different kind must not appear in the tour pages.
 await db.doc('cms_public/'+publicId('/accommodations/x')).set({path:'/accommodations/x',kind:'accommodation',id:'x',data:{id:'x',kind:'accommodation',publicPageEnabled:false}});
 const read=async limit=>{const seen=[];let after=null,pages=0;do{const page=await cataloguePage(db,{kind:'tour',after,limit});seen.push(...page.items.map(i=>i.id));assert.equal(page.truncated,!!page.next);after=page.next;pages++;assert(pages<100,'pagination did not terminate');}while(after);return {seen,pages};};
 const first=await read(200),second=await read(200);
 assert.equal(first.seen.length,total);assert.equal(new Set(first.seen).size,total);
 assert.deepEqual(first.seen,second.seen,'page order is deterministic');
 assert.equal(first.pages,3);
 const small=await read(7);assert.deepEqual([...small.seen].sort(),[...first.seen].sort());
});

test('Catalogue pages stay under the response byte budget and embed public media on request',async()=>{
 const db=fakeFirestore(),big='x'.repeat(400_000),assetId=crypto.randomUUID();
 for(let i=0;i<20;i++){const path='/blog/b-'+i;await db.doc('cms_public/'+publicId(path)).set({path,kind:'blog',id:'b'+i,data:{id:'b'+i,kind:'blog',title:'B'+i,slug:'b-'+i,body:big,coverAssetId:assetId}});}
 await db.doc('cms_public/'+publicId('/_media/'+assetId)).set({path:'/_media/'+assetId,kind:'media',id:assetId,data:{id:assetId,url:'https://res.cloudinary.com/demo/x.png',alt:'A',width:1,height:1}});
 let after=null,count=0;
 do{const page=await cataloguePage(db,{kind:'blog',after,limit:200,includeMedia:true});assert(Buffer.byteLength(JSON.stringify(page))<PAGE_BYTE_BUDGET+100_000,'page exceeded budget');assert.equal(page.media[assetId].url,'https://res.cloudinary.com/demo/x.png');count+=page.items.length;after=page.next;}while(after);
 assert.equal(count,20);
});

test('Catalogue query validation rejects unknown kinds, malformed cursors and oversized pages',()=>{
 const q=s=>parseCatalogueQuery(new URLSearchParams(s));
 assert.throws(()=>q('kind=staff'),e=>e.status===400);
 assert.throws(()=>q('kind=tour&after=../x'),e=>e.status===400);
 assert.throws(()=>q('kind=tour&limit=5000'),e=>e.status===400);
 assert.deepEqual(q('kind=tour'),{kind:'tour',after:null,limit:200,includeMedia:false});
});

test('Reconciliation removes stale and withheld stored data, then reports nothing to do',async()=>{
 const {entries}=await seed(),db=await storeFeed(entries);
 // Simulate documents written by the previous projector.
 const destRef=db.doc('cms_public/'+publicId('/destinations/serengeti')),old=(await destRef.get()).data();
 await destRef.set({...old,data:{...old.data,internalName:SENTINEL.internal,status:'published'}});
 await db.doc('cms_public/'+publicId('/accommodations/quiet-camp')).set({path:'/accommodations/quiet-camp',kind:'accommodation',id:'x',data:{publicPageEnabled:false}});
 await db.doc('cms_state/control').set({revision:7});
 const workspace={revision:7,entries},plan=planReconciliation(workspace,await readStoredProjection(db,{pageSize:3}));
 const report=summarise(plan);
 assert.equal(report.update,1);assert.deepEqual(report.withheldFieldsRemoved,['internalName','status']);
 assert.equal(report.remove,1);assert(report.removePaths.includes('/accommodations/quiet-camp'));
 assert(!JSON.stringify(report).includes(SENTINEL.internal),'report must not print field values');
 await applyReconciliation(db,plan,{batchSize:1});
 const again=summarise(planReconciliation(workspace,await readStoredProjection(db)));
 assert.deepEqual([again.create,again.update,again.remove],[0,0,0]);
});

test('Reconciliation aborts when the workspace revision changes during apply',async()=>{
 const {entries}=await seed(),db=fakeFirestore();
 await db.doc('cms_state/control').set({revision:2});
 const plan=planReconciliation({revision:1,entries},new Map());
 await assert.rejects(()=>applyReconciliation(db,plan),e=>e.code==='stale');
 assert.equal(Object.keys(db.dump()).filter(k=>k.startsWith('cms_public/')).length,0);
});


test('Group prices and day photos are public, and saved single-type tours can add more types', async () => {
  const {entries,img}=await seed();
  const out=project(entries);
  assert.equal(out.get('/destinations/serengeti').data.featured,true);
  const tour=out.get('/tours/northern').data;
  assert.deepEqual(tour.pricing,{mode:'groupUsd',group2:'700',group4:'600.25',group6:'500'});
  assert.equal(tour.itinerary[0].photos[0].assetId,img[5]);
  assert(out.has('/_media/'+img[5]));
  assert(assetRefs(tour).some(ref=>ref.path==='itinerary.0.photos.0'&&ref.assetId===img[5]));

  const first=crypto.randomUUID(), second=crypto.randomUUID();
  const form=recordToForm({...newRecord('tour'),typeId:first});
  assert.deepEqual(form.typeIds,[first]);
  form.typeIds.push(second,second);
  const {record}=formToRecord(form);
  assert.deepEqual(taxonomyRefs(record).map(ref=>ref.id),[first,second]);
  assert.equal(record.typeId,first);
});

test('Incomplete group pricing saves as a draft but cannot be published', () => {
  for(const kind of ['tour','dayTrip']){
    const form=recordToForm(newRecord(kind));
    form.pricing={mode:'groupUsd',group2:' 700 ',group4:'',group6:'500'};
    const {record}=formToRecord(form);
    assert.deepEqual(pricingIssues(record.pricing),[]);
    assert.deepEqual(pricingIssues(record.pricing,{publish:true}).map(issue=>issue.path),['pricing.group4']);
    assert.equal(describePrice(record.pricing).kind,'incomplete');
  }
  const valid={mode:'groupUsd',group2:'700',group4:'600.25',group6:'500'};
  assert.equal(describePrice(valid).text.replace(/\s+/g,' '),'From USD 500 per person');
  assert(pricingIssues({...valid,group6:'0'}).some(issue=>issue.path==='pricing.group6'));
  assert(comparePricing(valid,{...valid,group6:'499'})>0);
});
