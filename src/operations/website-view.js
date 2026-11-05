import {h,button,linkButton} from '../components/dom.js';
import {fieldWrap,textControl} from '../components/fields.js';
import {notice} from '../components/feedback.js';
import {websiteReader,importWebsiteBookings} from './website-bookings.js';
export async function createWebsiteConnectionView({app}){
 const ws=await app.workspace();let config=null;
 try{const response=await fetch('config/firebase-public.local.json',{cache:'no-store'});if(response.ok)config=await response.json();}catch{}
 const root=h('section',{class:'panel'},h('h1',null,'Website bookings connection'));
 root.append(notice('info','Read-only import from the website bookings collection. Staff sign-in is required. Credentials stay in memory only; no service-account secrets are used. Existing imported requests are skipped, preserving local edits and status.'));
 if(!config?.apiKey||!config?.projectId){root.append(notice('warning','Local Firebase web config is missing. Follow docs/COSTING_BOOKINGS_QUOTATIONS.md. Never put Admin service credentials into the browser.'));return {el:root,title:'Website connection',navGroup:'Bookings',navLabel:'Connect website'};}
 const reader=websiteReader(config),status=h('p',{role:'status','aria-live':'polite',tabindex:'-1'});let active=true,busy=false,timer=null,signedIn=false;
 const email=textControl({id:'website-staff-email',autocomplete:'username'});email.type='email';email.required=true;
 const password=textControl({id:'website-staff-password',autocomplete:'current-password'});password.type='password';password.required=true;
 const form=h('form',{class:'ops-form'},fieldWrap({id:email.id,label:'Firebase staff email',control:email}),fieldWrap({id:password.id,label:'Password',control:password}));
 const sync=async()=>{if(busy||!active)return;busy=true;refresh.disabled=true;status.textContent='Reading website booking requests…';try{const docs=await reader.read();if(!active)return;const result=await importWebsiteBookings(ws,docs,config.projectId);if(active)status.textContent=`Imported ${result.added} new requests; ${result.skipped} already present. Refreshed ${new Date().toLocaleTimeString('en-GB',{timeZone:'Africa/Dar_es_Salaam'})}.`;}catch(e){if(active){status.className='ops-error';status.textContent=e.message;}if(timer){clearInterval(timer);timer=null;}}finally{busy=false;if(active)refresh.disabled=!signedIn;}};
 const refresh=button('Import now',{disabled:true,onClick:sync});
 const signIn=button('Sign in & import',{variant:'primary',onClick:async()=>{if(!form.reportValidity()||busy)return;busy=true;signedIn=false;refresh.disabled=true;signIn.disabled=true;const secret=password.value;password.value='';status.textContent='Signing in to Firebase…';try{await reader.signIn(email.value.trim(),secret);if(!active){reader.signOut();return;}signedIn=true;}catch(e){status.className='ops-error';status.textContent=e.message;}finally{busy=false;signIn.disabled=false;}if(signedIn&&active){await sync();}}});
 const auto=h('input',{id:'website-auto',type:'checkbox',on:{change:e=>{if(timer)clearInterval(timer);timer=e.target.checked?setInterval(()=>sync(),60000):null;}}});
 const disconnect=button('Disconnect',{onClick:()=>{reader.signOut();signedIn=false;if(timer)clearInterval(timer);timer=null;auto.checked=false;refresh.disabled=true;status.textContent='Disconnected. Imported requests remain in this browser.';}});
 form.addEventListener('submit',e=>{e.preventDefault();signIn.click();});
 root.append(h('p',null,'Project: '+config.projectId),notice('warning','The source repository requires the staff:true Firebase claim. That must match deployed rules. This connector does not grant staff permissions, change rules, create accounts, or write to the website. Live sign-in is not verified until an authorised staff member connects.'),form,h('div',{class:'ops-actions'},signIn,refresh,disconnect,linkButton('Open bookings','#/bookings')),h('label',{class:'check',for:auto.id},auto,' Refresh every 60 seconds while this screen remains open'),status,h('p',null,'Leaving this page ends the in-memory session. Requests with missing/invalid information are reported for review, never silently dropped or assigned invented traveller counts.'));
 return {el:root,title:'Website bookings connection',breadcrumb:'Bookings / Connect website',navGroup:'Bookings',navLabel:'Connect website',destroy(){active=false;reader.signOut();password.value='';if(timer)clearInterval(timer);}};
}
