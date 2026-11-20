import {redactCspReports} from '../../../server/csp.mjs';
// Receives report-only CSP violations from staff pages. Logs only the directive, the blocked resource's
// origin and the page path (no query strings, cookies, user agents or staff identifiers). Bodies over
// 16 KB are refused. No authentication: browsers send these reports on their own.
export const runtime='nodejs';
export async function POST(req:Request){
 if(Number(req.headers.get('content-length'))>16384)return new Response(null,{status:413});
 const text=await req.text();if(text.length>16384)return new Response(null,{status:413});
 let payload:any;try{payload=JSON.parse(text);}catch{return new Response(null,{status:400});}
 for(const report of redactCspReports(payload))console.warn('CSP report-only violation',JSON.stringify(report));
 return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});
}
