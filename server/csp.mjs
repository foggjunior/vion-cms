// Report-only Content Security Policy for the React staff pages (/, /login, /setup, /staff,
// /integrations). /workspace and /finance keep their own enforced policies (app/workspace/route.ts,
// app/finance/route.ts) and are not touched.
//
// Allowed origins come from what the code uses:
//   - Firebase Authentication email/password sign-in (lib/firebase-client.ts → signInWithEmailAndPassword):
//     identitytoolkit.googleapis.com (sign-in, account lookup) and securetoken.googleapis.com (token refresh).
//     No Google/popup sign-in exists in this code, so no Firebase auth iframe or google.com origin is allowed;
//     if one is added later, the report-only phase will show exactly what to add.
//   - Images: same-origin assets (/approved/assets) and Cloudinary renditions.
//   - An Auth emulator origin only when NEXT_PUBLIC_AUTH_EMULATOR_URL is set (local development).
// Scripts and <style> elements need this request's nonce ('strict-dynamic' lets Next's own chunks load);
// React inline style attributes are allowed through style-src-attr only.
export const CSP_REPORT_PATH='/api/csp-report';

const originOf=value=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.origin:null;}catch{return null;}};

/** @param {{nonce?:string,dev?:boolean,authEmulator?:string|null}} [options] */
export function staffReportOnlyPolicy({nonce,dev=false,authEmulator=null}={}){
 if(!/^[A-Za-z0-9+/=_-]{16,}$/.test(String(nonce||'')))throw Error('A request nonce is required.');
 const emulator=authEmulator?originOf(authEmulator):null;
 return [
  "default-src 'self'",
  `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev?" 'unsafe-eval'":''}`,
  `style-src 'self' 'nonce-${nonce}'`,
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: blob: https://res.cloudinary.com",
  "font-src 'self'",
  `connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com${emulator?' '+emulator:''}`,
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  `report-uri ${CSP_REPORT_PATH}`,
  'report-to csp'
 ].join('; ');
}

// Reduces a browser CSP report (legacy application/csp-report or Reporting API application/reports+json)
// to fields that carry no personal data: the directive, the blocked resource's origin (or a keyword such
// as inline/eval), and the page path without its query string or fragment.
export function redactCspReports(payload){
 const raw=Array.isArray(payload)?payload.map(r=>r?.body||r):[payload?.['csp-report']||payload?.body||payload];
 return raw.filter(r=>r&&typeof r==='object').slice(0,20).map(r=>{
  const directive=String(r['effective-directive']||r.effectiveDirective||r['violated-directive']||r.violatedDirective||'unknown').split(' ')[0].slice(0,60);
  const blocked=String(r['blocked-uri']||r.blockedURL||r.blockedUri||'');
  const page=String(r['document-uri']||r.documentURL||r.documentUri||'');
  const pagePath=(()=>{try{return new URL(page).pathname.slice(0,120);}catch{return '';}})();
  return {directive,blocked:originOf(blocked)||(/^[a-z-]{1,20}$/.test(blocked)?blocked:'other'),page:pagePath,disposition:String(r.disposition||'report').slice(0,10)};
 });
}
