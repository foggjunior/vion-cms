// Browser lab benchmark for CMS screens (isolated: no Firebase, no environment files, no live CMS).
//   node tools/prepare-cloud.mjs && node tools/bench-screens.mjs [sizes=200,600,1200] [runs=7]
// Serves the generated cloud UI from public/approved on 127.0.0.1:5191 in headless Chrome and answers
// /api/rpc with the real execute() pipeline over an in-memory Firestore double seeded with
// tools/bench-fixtures.mjs. For the dashboard and the Destinations list it records, per full page load,
// the number of RPC requests, response bytes (JSON) and time from navigation to the rendered screen.
// These are lab numbers for relative comparison on this machine, not production or real-user metrics.
import http from 'node:http';import path from 'node:path';import {createRequire} from 'node:module';import {readFile} from 'node:fs/promises';import {performance} from 'node:perf_hooks';
import {execute} from '../server/execute.mjs';import {encode,decode} from '../server/wire.mjs';import {createPersistence,LIMITS} from '../server/persistence.mjs';
import {fakeFirestore} from '../server/tests/support/fake-firestore.mjs';import {buildWorkspace,benchActor} from './bench-fixtures.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base='http://127.0.0.1:5191',sizes=(process.argv[2]||'200,600,1200').split(',').map(Number),runs=Number(process.argv[3]||7);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII=','base64');
const quantile=(values,q)=>{const s=[...values].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.ceil(q*s.length)-1)];};
const publicRoot=path.resolve('public'),server=http.createServer(async(req,res)=>{try{const file=path.resolve(publicRoot,'.'+decodeURIComponent(new URL(req.url,base).pathname));if(!file.startsWith(publicRoot+path.sep)){res.writeHead(403);res.end();return;}const type={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(await readFile(file));}catch{if(!res.headersSent)res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(5191,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true}),html=await readFile('public/approved/index.html','utf8'),report=[];
try{
 for(const size of sizes){
  const entries=await buildWorkspace(size),db=fakeFirestore(),seed=createPersistence(()=>db,{cache:false});
  for(let i=0;i<entries.length;i+=LIMITS.changesPerCommit-50){const before=await seed.snapshot();await seed.commit(before,[...before.entries,...entries.slice(i,i+LIMITS.changesPerCommit-50)],benchActor,'seed');}
  const persistence=createPersistence(()=>db);await persistence.snapshot();
  const context=await browser.newContext({viewport:{width:1440,height:1000}});let log=[];
  await context.route('**/workspace',r=>r.fulfill({contentType:'text/html',body:html}));
  await context.route('**/api/auth/session',r=>r.fulfill({json:{actor:benchActor}}));
  await context.route('**/api/media/**',r=>r.fulfill({contentType:'image/png',body:png}));
  await context.route('**/api/rpc',async route=>{const b=route.request().postDataJSON(),t=performance.now();try{const body=JSON.stringify({value:encode(await execute(benchActor,b.service,b.method,decode(b.args),persistence))});log.push({op:b.service+'.'+b.method,bytes:Buffer.byteLength(body),ms:performance.now()-t});await route.fulfill({contentType:'application/json',body});}catch(e){log.push({op:b.service+'.'+b.method,bytes:0,error:e.message});await route.fulfill({status:e.status||422,json:{error:e.message,code:e.code}});}});
  const screens=[['dashboard','/dashboard','.dashboard-layout'],['destinations','/destinations','#moduleRoot[data-ready="true"] .list-view']];
  const row={size,entries:entries.length};
  for(const [name,hash,ready] of screens){
   const samples=[];
   for(let r=0;r<runs;r++){const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));log=[];const t=performance.now();await page.goto(base+'/workspace#'+hash);try{await page.waitForSelector(ready,{timeout:120000});}catch(error){console.error('Not rendered',name,JSON.stringify({errors,log:log.map(x=>[x.op,x.error||x.bytes])}));console.error((await page.locator('body').innerText()).slice(0,600));throw error;}const ms=performance.now()-t;await page.waitForTimeout(300);samples.push({ms,requests:log.length,bytes:log.reduce((s,x)=>s+x.bytes,0),ops:log.map(x=>x.op)});await page.close();}
   row[name]={runs,requests:samples[0].requests,ops:[...new Set(samples[0].ops)],bytes:quantile(samples.map(s=>s.bytes),0.5),p50ms:Math.round(quantile(samples.map(s=>s.ms),0.5)),p95ms:Math.round(quantile(samples.map(s=>s.ms),0.95))};
  }
  await context.close();report.push(row);console.error(JSON.stringify(row));
 }
}finally{await browser.close();server.close();}
console.log(JSON.stringify({generatedAt:new Date().toISOString(),node:process.version,runs,report},null,2));
