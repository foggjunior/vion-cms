import {NextResponse,type NextRequest} from 'next/server';
import {staffReportOnlyPolicy,CSP_REPORT_PATH} from './server/csp.mjs';
// Report-only CSP with a per-request nonce for the React staff pages (see server/csp.mjs). Next.js reads
// the nonce from the request's Content-Security-Policy-Report-Only header and applies it to its scripts.
// Nothing is blocked; violations are reported to /api/csp-report for review before enforcement.
export function proxy(request:NextRequest){
 const nonce=btoa(crypto.randomUUID());
 const policy=staffReportOnlyPolicy({nonce,dev:process.env.NODE_ENV==='development',authEmulator:process.env.NEXT_PUBLIC_AUTH_EMULATOR_URL||null});
 const headers=new Headers(request.headers);
 headers.set('x-nonce',nonce);
 headers.set('Content-Security-Policy-Report-Only',policy);
 const response=NextResponse.next({request:{headers}});
 response.headers.set('Content-Security-Policy-Report-Only',policy);
 response.headers.set('Reporting-Endpoints',`csp="${CSP_REPORT_PATH}"`);
 return response;
}
export const config={matcher:['/','/login','/setup','/staff','/integrations']};
