// Area 4: CMS_REQUIRE_MFA_ROLES with mock Firebase sessions (no Firebase project, no real tokens).
// Covers sessions with and without a second factor, role changes taking effect on the next request,
// deactivation, recovery by configuration, and the last-active-administrator rule.
import test from 'node:test';import assert from 'node:assert/strict';
import {actorFromToken} from '../session.mjs';import {staffReportOnlyPolicy,redactCspReports} from '../csp.mjs';
import {fakeFirestore} from './support/fake-firestore.mjs';

const ENFORCE={CMS_REQUIRE_MFA_ROLES:'admin,accounting'};
function firebase(sessions){
 const db=fakeFirestore();
 const verify=async token=>{const claims=sessions[token];if(!claims)throw Object.assign(Error('revoked or invalid'),{code:'auth/session-cookie-revoked'});return claims;};
 return {db,deps:env=>({admin:()=>({auth:{verifySessionCookie:verify,verifyIdToken:verify},db}),env})};
}
const staff=(db,uid,role,active=true)=>db.doc('cms_staff/'+uid).set({uid,email:uid+'@example.test',name:uid,role,active,version:1});
const withFactor=uid=>({uid,email:uid+'@example.test',firebase:{sign_in_provider:'password',sign_in_second_factor:'totp'}});
const passwordOnly=uid=>({uid,email:uid+'@example.test',firebase:{sign_in_provider:'password'}});

test('With enforcement on, admins and accounting need a second factor; other roles do not',async()=>{
 const {db,deps}=firebase({'admin-mfa':withFactor('a1'),'admin-pw':passwordOnly('a2'),'acct-pw':passwordOnly('c1'),'acct-mfa':withFactor('c2'),'editor-pw':passwordOnly('e1')});
 await staff(db,'a1','admin');await staff(db,'a2','admin');await staff(db,'c1','accounting');await staff(db,'c2','accounting');await staff(db,'e1','editor');
 assert.equal((await actorFromToken('admin-mfa',true,deps(ENFORCE))).role,'admin');
 await assert.rejects(()=>actorFromToken('admin-pw',true,deps(ENFORCE)),e=>e.status===403&&e.code==='mfa-required');
 await assert.rejects(()=>actorFromToken('acct-pw',true,deps(ENFORCE)),e=>e.code==='mfa-required');
 assert.equal((await actorFromToken('acct-mfa',true,deps(ENFORCE))).role,'accounting');
 assert.equal((await actorFromToken('editor-pw',true,deps(ENFORCE))).role,'editor');
 // The same check applies when the session is created from a fresh ID token at sign-in.
 await assert.rejects(()=>actorFromToken('admin-pw',false,deps(ENFORCE)),e=>e.code==='mfa-required');
});

test('Enforcement is off unless configured, so enabling it is a deliberate owner step',async()=>{
 const {db,deps}=firebase({'admin-pw':passwordOnly('a2')});await staff(db,'a2','admin');
 assert.equal((await actorFromToken('admin-pw',true,deps({}))).role,'admin');
});

test('A role change applies on the next request, in both directions',async()=>{
 const {db,deps}=firebase({'pw':passwordOnly('u1')});await staff(db,'u1','editor');
 assert.equal((await actorFromToken('pw',true,deps(ENFORCE))).role,'editor');
 await db.doc('cms_staff/u1').update({role:'admin',version:2});
 await assert.rejects(()=>actorFromToken('pw',true,deps(ENFORCE)),e=>e.code==='mfa-required','promotion requires a new MFA sign-in');
 await db.doc('cms_staff/u1').update({role:'publisher',version:3});
 assert.equal((await actorFromToken('pw',true,deps(ENFORCE))).role,'publisher');
 await db.doc('cms_staff/u1').update({active:false,version:4});
 await assert.rejects(()=>actorFromToken('pw',true,deps(ENFORCE)),e=>e.status===403&&e.code!=='mfa-required','deactivation still wins');
 await assert.rejects(()=>actorFromToken('revoked',true,deps(ENFORCE)),e=>e.code==='auth/session-cookie-revoked');
});

test('Recovery: an enrolled administrator keeps access; removing a role from the setting restores password sign-in',async()=>{
 const {db,deps}=firebase({'lost-factor':passwordOnly('a1'),'backup-admin':withFactor('a2')});
 await staff(db,'a1','admin');await staff(db,'a2','admin');
 await assert.rejects(()=>actorFromToken('lost-factor',true,deps(ENFORCE)));
 assert.equal((await actorFromToken('backup-admin',true,deps(ENFORCE))).role,'admin','a second enrolled admin can manage staff while the first re-enrols');
 assert.equal((await actorFromToken('lost-factor',true,deps({CMS_REQUIRE_MFA_ROLES:'accounting'}))).role,'admin','owner fallback: narrow the setting and redeploy');
});

test('MFA never bypasses the last-active-administrator rule: a sole unenrolled admin is locked out, not removed',async()=>{
 const {db,deps}=firebase({'only-admin':passwordOnly('a1')});await staff(db,'a1','admin');
 await assert.rejects(()=>actorFromToken('only-admin',true,deps(ENFORCE)),e=>e.code==='mfa-required');
 const record=(await db.doc('cms_staff/a1').get()).data();
 assert.equal(record.active,true);assert.equal(record.role,'admin','the record is untouched; enabling enforcement requires two enrolled admins first');
});

test('The staff report-only CSP allows only the origins the code uses and needs a nonce',()=>{
 const policy=staffReportOnlyPolicy({nonce:'bm9uY2Utbm9uY2Utbm9uY2U='});
 assert.match(policy,/script-src 'self' 'nonce-bm9uY2Utbm9uY2Utbm9uY2U=' 'strict-dynamic'/);
 assert.match(policy,/connect-src 'self' https:\/\/identitytoolkit\.googleapis\.com https:\/\/securetoken\.googleapis\.com;/);
 assert.doesNotMatch(policy,/\*|unsafe-eval|'unsafe-inline'(?!;)/,'no wildcards or eval in production');
 assert.match(staffReportOnlyPolicy({nonce:'bm9uY2Utbm9uY2Utbm9uY2U=',dev:true,authEmulator:'http://127.0.0.1:9099/x'}),/'unsafe-eval'.*http:\/\/127\.0\.0\.1:9099/s);
 assert.throws(()=>staffReportOnlyPolicy({}));
});

test('CSP reports are reduced to directive, blocked origin and page path',()=>{
 const legacy={'csp-report':{'document-uri':'https://cms.example.test/staff?email=someone@example.test#x','violated-directive':'connect-src','effective-directive':'connect-src','blocked-uri':'https://tracker.example/collect?user=123'}};
 assert.deepEqual(redactCspReports(legacy),[{directive:'connect-src',blocked:'https://tracker.example',page:'/staff',disposition:'report'}]);
 const modern=[{type:'csp-violation',body:{documentURL:'https://cms.example.test/login?next=/finance',effectiveDirective:'script-src-elem',blockedURL:'inline',disposition:'report'}}];
 assert.deepEqual(redactCspReports(modern),[{directive:'script-src-elem',blocked:'inline',page:'/login',disposition:'report'}]);
 assert(!JSON.stringify(redactCspReports(legacy)).includes('someone@example.test'));
});
