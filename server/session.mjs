// Turns a Firebase session cookie (or a fresh ID token at sign-in) into a CMS actor. The staff record is read
// on every request, so deactivation and role changes apply immediately; revoked sessions are rejected by
// verifySessionCookie(…, true). Privileged roles listed in CMS_REQUIRE_MFA_ROLES must have signed in with a
// second factor (see policy.mjs mfaSatisfied). Kept free of Next.js imports so it can be tested directly.
import {admin} from './firebase.mjs';import {ROLES,mfaSatisfied} from './policy.mjs';
export async function actorFromToken(token,isSession=true,{admin:getAdmin=admin,env=process.env}={}){
 const {auth,db}=getAdmin();
 const claims=isSession?await auth.verifySessionCookie(token,true):await auth.verifyIdToken(token,true);
 const staff=(await db.collection('cms_staff').doc(claims.uid).get()).data();
 if(!staff?.active||!ROLES.includes(staff.role))throw Object.assign(Error('This account does not have active CMS access.'),{status:403});
 if(!mfaSatisfied(staff.role,claims,env))throw Object.assign(Error('This role requires multi-factor sign-in. Sign in again with your second factor.'),{status:403,code:'mfa-required'});
 return {uid:claims.uid,email:claims.email||'',role:staff.role,name:staff.name||claims.email||'Vion staff'};
}
