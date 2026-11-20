// Response-size handling and redacted diagnostics for staff API responses.
//
// Vercel Functions reject buffered request and response bodies over 4.5 MB with FUNCTION_PAYLOAD_TOO_LARGE;
// the response limit does not apply to streamed responses (https://vercel.com/docs/functions/limitations).
// Whole-workspace RPCs (content.loadContext, backup.exportData) grow with content: a synthetic workspace of
// 600 published records already returns about 8 MB (tools/bench-capacity.mjs). Responses above
// RESPONSE_LIMIT_BYTES are therefore streamed in chunks, and responses above STREAM_LIMIT_BYTES fail with a
// clear 413 rather than exhausting the browser or the function. Logs carry the operation name and sizes
// only: no record content, names or addresses.
export const RESPONSE_LIMIT_BYTES=4_000_000;
export const STREAM_LIMIT_BYTES=48_000_000;
const CHUNK=256*1024;

/** @param {any} payload @param {{operation?:string,started?:number,limit?:number,streamLimit?:number,log?:any}} [options] */
export function rpcResponse(payload,{operation,started=Date.now(),limit=RESPONSE_LIMIT_BYTES,streamLimit=STREAM_LIMIT_BYTES,log=console}={}){
 const json=JSON.stringify(payload),body=Buffer.from(json),bytes=body.length,ms=Date.now()-started;
 const headers={'Content-Type':'application/json','Cache-Control':'private, no-store','Server-Timing':`total;dur=${ms}`,'X-Vion-Response-Bytes':String(bytes)};
 if(bytes>streamLimit){
  log.warn('CMS response too large',JSON.stringify({operation,bytes,streamLimit}));
  return Response.json({error:`This request returns ${(bytes/1e6).toFixed(1)} MB, more than the CMS can send in one response. Tell an administrator: the workspace has outgrown single-request loading.`,code:'response-too-large',issues:[]},{status:413,headers:{'Cache-Control':'private, no-store','X-Vion-Response-Bytes':String(bytes)}});
 }
 if(bytes>limit){
  log.warn('CMS response streamed above the buffered platform limit',JSON.stringify({operation,bytes,limit}));
  let offset=0;
  const stream=new ReadableStream({pull(controller){if(offset>=bytes){controller.close();return;}controller.enqueue(body.subarray(offset,offset+CHUNK));offset+=CHUNK;}});
  return new Response(stream,{status:200,headers:{...headers,'X-Vion-Streamed':'1'}});
 }
 if(bytes>limit*0.75)log.warn('CMS response near the buffered platform limit',JSON.stringify({operation,bytes,limit}));
 return new Response(json,{status:200,headers});
}
