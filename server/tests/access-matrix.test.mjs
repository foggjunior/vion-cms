// P1 authorisation regression net: every role against every allowlisted RPC method, the staff directory
// and finance boundaries, opt-in MFA, and a source check that each staff API route verifies the session
// and each state-changing route verifies the request origin. No server or credentials are started.
import test from 'node:test';import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';import {join} from 'node:path';
import {access,METHODS,READ_METHODS,ROLES,canAccessFinance,mfaSatisfied} from '../policy.mjs';

const all=Object.entries(METHODS).flatMap(([service,methods])=>methods.map(method=>[service,method]));
const isWrite=method=>!READ_METHODS.has(method);
const isPublishing=(service,method)=>isWrite(method)&&(method.toLowerCase().includes('publish')||['archive','archiveMember','remove'].includes(method));

test('Administrators can call every allowlisted method; accounting and unknown roles none',()=>{
 for(const [service,method] of all){
  assert(access('admin',service,method,[]),service+'.'+method);
  assert(!access('accounting',service,method,[]),'accounting '+service+'.'+method);
  assert(!access('owner',service,method,[]));
 }
});

test('Viewers only read content and edit their own profile',()=>{
 for(const [service,method] of all){
  const allowed=access('viewer',service,method,[]);
  if(['bookings','operations','backup'].includes(service))assert(!allowed,'viewer '+service+'.'+method);
  else if(isWrite(method)&&!(service==='review'&&method==='saveProfile')&&!(service==='accommodationInline'&&method==='rooms'))assert(!allowed,'viewer write '+service+'.'+method);
 }
 assert(access('viewer','review','saveProfile',[{}]));
});

test('Editors save drafts but never publish, archive, remove media or reach private operations',()=>{
 for(const [service,method] of all){
  const allowed=access('editor',service,method,[]);
  if(['bookings','operations','backup'].includes(service)||isPublishing(service,method))assert(!allowed,'editor '+service+'.'+method);
 }
 assert(access('editor','content','saveDraft',[{}]));
 for(const action of ['publish','unpublish','archive'])assert(!access('editor','review','action',['id',action,1]),action);
});

test('Publishers publish content but have no customer, costing or backup access',()=>{
 assert(access('publisher','content','publish',[]));assert(access('publisher','review','action',['id','publish',1]));
 for(const [service,method] of all)if(['bookings','operations','backup'].includes(service))assert(!access('publisher',service,method,[]),service+'.'+method);
});

test('Reservations handle bookings and costing, read content, and cannot edit or publish it',()=>{
 for(const method of METHODS.bookings)assert(access('reservations','bookings',method,[]));
 for(const method of ['list','get','save'])assert(access('reservations','operations',method,[]));
 for(const method of ['import','export'])assert(!access('reservations','operations',method,[]),'bulk '+method);
 for(const [service,method] of all)if(['content','site','taxonomies','media','defaults'].includes(service)&&isWrite(method))assert(!access('reservations',service,method,[]),service+'.'+method);
 for(const method of METHODS.backup)assert(!access('reservations','backup',method,[]));
 assert(access('reservations','accommodationInline','create',[{}]),'bounded inline accommodation');
});

test('The staff directory is administrator-only for every role and method',()=>{
 // profile/saveProfile act on the caller's own profile and ignore these arguments.
 for(const role of ROLES.filter(r=>r!=='admin'))for(const method of METHODS.review.filter(m=>!['profile','saveProfile'].includes(m))){
  assert(!access(role,'review',method,['users']),role+' '+method+' users');
  assert(!access(role,'review',method,[{kind:'staff'}]),role+' '+method+' staff');
 }
});

test('Finance is limited to administrators and accounting',()=>{
 assert.deepEqual(ROLES.filter(canAccessFinance).sort(),['accounting','admin']);
});

test('Prototype and unknown method names fail closed',()=>{
 for(const method of ['constructor','__proto__','toString','hasOwnProperty'])for(const role of ROLES)assert(!access(role,'content',method,[]),role+' '+method);
});

test('MFA can be required for privileged roles without affecting others',()=>{
 const env={CMS_REQUIRE_MFA_ROLES:'admin, accounting'};
 assert(!mfaSatisfied('admin',{firebase:{}},env));
 assert(mfaSatisfied('admin',{firebase:{sign_in_second_factor:'totp'}},env));
 assert(mfaSatisfied('editor',{firebase:{}},env));
 assert(mfaSatisfied('admin',{firebase:{}},{}),'off unless configured');
});

async function routes(dir){const out=[];for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())out.push(...await routes(path));else if(entry.name==='route.ts')out.push(path);}return out;}
test('Every staff API route verifies the session and every mutation verifies its origin',async()=>{
 const root=new URL('../../app/api/',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
 const files=await routes(root);assert(files.length>=15);
 // Public by design: the published feed, signed provider webhooks, the secret-authenticated scheduler and
 // browser-sent CSP reports (redacted, size-limited).
 const exempt=/[\\/](public|webhooks|cron|csp-report)[\\/]/;
 for(const file of files){
  const source=await readFile(file,'utf8'),rel=file.slice(root.length);
  if(exempt.test(file)){if(/[\\/]cron[\\/]/.test(file))assert(/timingSafeEqual/.test(source),'cron must check its secret');continue;}
  const sessionRoute=/[\\/]auth[\\/]session[\\/]/.test(file);
  if(!sessionRoute)assert(/requireActor\(\)/.test(source),rel+' does not verify the staff session');
  for(const verb of ['POST','PUT','DELETE','PATCH']){
   const at=source.indexOf('export async function '+verb);if(at<0)continue;
   const end=source.indexOf('export async function',at+10),body=source.slice(at,end<0?undefined:end);
   assert(/sameOrigin\(/.test(body),rel+' '+verb+' does not verify its origin');
  }
 }
});
