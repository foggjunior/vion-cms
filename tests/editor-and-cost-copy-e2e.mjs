// Isolated static UI + in-memory server pipeline. Never visits the live CMS,
// reads environment files, or calls Firebase/Cloudinary/Resend.
import http from 'node:http';import path from 'node:path';import {createRequire} from 'node:module';import {readFile,mkdir} from 'node:fs/promises';import {domain} from '../server/domain.mjs';import {execute} from '../server/execute.mjs';import {encode,decode} from '../server/wire.mjs';import {newRecord} from '../src/modules/shared/records.js';
const require=createRequire(import.meta.url),{chromium}=require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base='http://127.0.0.1:5190',actor={uid:'isolated-ui',role:'admin',name:'Test admin',email:'test@example.com'},png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII=','base64');
const seed=await domain([],actor),dest=newRecord('destination');dest.title='Arusha';dest.slug='arusha';await seed.ws.content.saveDraft(dest,{expectedVersion:null});await seed.ws.media.add({ok:true,blob:new Blob([png],{type:'image/png'}),info:{fileName:'test-lodge.png',type:'image/png',size:png.length,width:1,height:1}},{alt:'Lodge'});let entries=await seed.dump(),revision=0;seed.close();
const persistence={async snapshot(){return {entries:structuredClone(entries),revision}},async commit(before,after){if(before.revision!==revision)throw Error('Concurrent test write');entries=structuredClone(after);revision++;}};
const publicRoot=path.resolve('public'),server=http.createServer(async(req,res)=>{try{const file=path.resolve(publicRoot,'.'+decodeURIComponent(new URL(req.url,base).pathname));if(!file.startsWith(publicRoot+path.sep)){res.writeHead(403);res.end();return;}const type={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(await readFile(file));}catch{if(!res.headersSent)res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(5190,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());const html=await readFile('public/approved/index.html','utf8');let checks=0;const ok=(v,label)=>{if(!v)throw Error(label);checks++;console.log('PASS '+label)};
let rpcGate;
await context.route('**/workspace',r=>r.fulfill({contentType:'text/html',body:html}));await context.route('**/api/auth/session',r=>r.fulfill({json:{actor}}));await context.route('**/api/media/*',r=>r.fulfill({contentType:'image/png',body:png}));await context.route('**/api/rpc',async route=>{const gate=rpcGate;rpcGate=null;if(gate)await gate;try{const b=route.request().postDataJSON(),result=await execute(actor,b.service,b.method,decode(b.args),persistence);await route.fulfill({json:{value:encode(result)}})}catch(e){await route.fulfill({status:e.status||422,json:{error:e.message,code:e.code,issues:e.issues}})}});
async function open(path){const dirty=await page.evaluate(()=>window.__vionApp?.currentView()?.isDirty?.()||false);if(await page.evaluate(()=>location.hash)==='#'+path){await page.reload();}else if(dirty){await page.evaluate(path=>{window.__vionApp.navigate('#'+path);},path);const guard=page.getByRole('dialog',{name:'Leave without saving?',exact:true});await guard.getByRole('button',{name:'Leave and discard changes',exact:true}).click();}else await page.goto(base+'/workspace#'+path);await page.waitForURL(base+'/workspace#'+path);try{await page.locator('#moduleRoot[data-ready="true"]').waitFor({timeout:10000});}catch(e){console.log('PAGE ERRORS',errors);console.log('PAGE TEXT',await page.locator('body').innerText());throw e;}}
try {
 let releasePage;
 rpcGate=new Promise(resolve=>{releasePage=resolve;});
 await page.goto(base+'/workspace#/destinations/new');
 await page.locator('#moduleRoot .page-skeleton .skeleton-bar').first().waitFor();
 ok(true,'The page shows a skeleton while records load');
 releasePage();
 await page.locator('#moduleRoot[data-ready="true"]').waitFor();
 ok(await page.getByRole('tab',{name:'Private rates / STO'}).count()===0,'Destination editor has no rates tab');
 await open('/quotations/new');
 const add=page.getByRole('button',{name:'Add itinerary day',exact:true});
 for(let i=0;i<3;i++)await add.click();
 const days=page.locator('.daily-cost-panel');
 await days.nth(0).getByRole('button',{name:'Open daily costs'}).click();
 await days.nth(0).getByLabel('Unit cost',{exact:true}).first().fill('45');
 for(const index of [1,2]){
   await days.nth(index).getByRole('button',{name:'Open daily costs'}).click();
   await days.nth(index).getByLabel('Copy costs from').selectOption({label:'Day 1'});
   await days.nth(index).getByRole('button',{name:'Copy all costs'}).click();
   ok(await days.nth(index).getByLabel('Unit cost',{exact:true}).first().inputValue()==='45','Copied Day 1 costs to Day '+(index+1));
 }
 await days.nth(1).getByLabel('Unit cost',{exact:true}).first().fill('70');
 ok(await days.nth(0).getByLabel('Unit cost',{exact:true}).first().inputValue()==='45'&&await days.nth(2).getByLabel('Unit cost',{exact:true}).first().inputValue()==='45','Copied costs remain independent');
 await open('/foundations/new');
 await page.locator('#review-title').fill('Community foundation');
 await page.locator('#review-subtitle').fill('Supporting local education');
 const body=page.locator('#review-body');
 await body.fill('Our purpose');
 const style=page.getByLabel('Paragraph style');
 await style.selectOption('h2');
 ok(await body.locator('h2').innerText()==='Our purpose','Toolbar formats the selected paragraph in the editor');
 await body.press('Home');
 await body.press('Shift+End');
 await page.getByRole('button',{name:'Underline',exact:true}).click();
 ok(await body.locator('u').innerText()==='Our purpose','Underline is visible while editing');
 let releaseSave;
 rpcGate=new Promise(resolve=>{releaseSave=resolve;});
 await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await page.locator('button[aria-busy="true"]').filter({hasText:'Save draft'}).waitFor();
 ok(true,'Save draft shows a busy state while the server responds');
 releaseSave();
 await page.locator('#toast[data-tone="success"]').getByText('Draft saved.').waitFor();
 ok(await page.locator('#toast').evaluate(el=>{
   const css=getComputedStyle(el);
   return css.backgroundColor==='rgb(23, 75, 56)'&&css.top==='20px'&&css.right==='20px';
 }),'The completed save shows a green popup at the top right');
 await page.getByRole('button',{name:'Publish',exact:true}).waitFor();
 await page.getByRole('button',{name:'Publish',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Publish',exact:true}).click();
 await page.locator('#moduleRoot').getByText(/Add at least three distinct section headings/).waitFor();
 await page.locator('#toast[data-tone="error"]').getByText(/Add at least three distinct section headings/).waitFor();
 ok(true,'Publication rejects fewer than three section headings');
 await body.fill('Mission');
 for(const [index,heading] of ['Mission','Projects','Support'].entries()){
   if(index)await page.keyboard.insertText(heading);
   await style.selectOption('h2');
   await body.press('End');
   await body.press('Enter');
 }
 await page.keyboard.insertText('Learn about our work.');
 await body.press('Home');
 await body.press('Shift+End');
 await page.getByRole('button',{name:'Link',exact:true}).click();
 const linkDialog=page.getByRole('dialog',{name:'Link selected text'});
 await linkDialog.getByLabel('Link URL').fill('https://example.com/safari');
 await linkDialog.getByRole('button',{name:'Apply link'}).click();
 const anchor=body.getByRole('link',{name:'Learn about our work.',exact:true});
 ok(await anchor.getAttribute('href')==='https://example.com/safari'&&!(await body.innerText()).includes('https://example.com'),'Selected words become a link without inserting the URL into the article');
 await body.press('End');
 await page.getByRole('button',{name:'Insert photo',exact:true}).click();
 await page.getByRole('button',{name:/test-lodge.png/}).click();
 await page.getByRole('button',{name:'Use image',exact:true}).click();
 const photo=page.getByRole('dialog',{name:'Describe this photo'});
 await photo.getByLabel('Alt text').fill('A lodge in the Serengeti');
 await photo.getByLabel('Caption (optional)').fill('A stop on the safari route');
 await photo.getByRole('button',{name:'Insert photo',exact:true}).click();
 await body.getByRole('img',{name:'A lodge in the Serengeti'}).waitFor({timeout:3000}).catch(async e=>{console.log(await body.innerHTML(),errors);throw e;});
 ok(true,'Inline photo and alt text appear while editing');
 await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await page.getByText('Saved in this browser',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Publish',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Publish',exact:true}).click();
 await page.getByText('Published locally',{exact:true}).waitFor();
 await open('/site/give-back/community-foundation');
 await page.locator('.formatted-writing h2').first().waitFor();
 ok(await page.locator('#moduleRoot h1').count()===1&&await page.locator('.formatted-writing h2').count()===3,'Published page has one title and three section headings');
 await page.locator('.formatted-writing').getByRole('img',{name:'A lodge in the Serengeti'}).waitFor();
 const publishedLink=page.locator('.formatted-writing').getByRole('link',{name:'Learn about our work.',exact:true});
 const articleUrl=page.url();
 await context.route('https://example.com/safari',route=>route.fulfill({body:'Test destination'}));
 await page.evaluate(()=>{
   const open = window.open.bind(window);
   window.open = (...args)=>{
     const tab = open(...args);
     if (tab) {
       const focus = tab.focus.bind(tab);
       tab.focus = ()=>{document.body.dataset.linkFocusRequested='true';focus();};
     }
     return tab;
   };
 });
 const [linkedPage]=await Promise.all([page.waitForEvent('popup'),publishedLink.click()]);
 await linkedPage.waitForURL('https://example.com/safari');
 ok(page.url()===articleUrl&&await publishedLink.getAttribute('rel')==='noopener','Published selected text opens in a new tab and keeps the article open');
 ok(await page.locator('body').getAttribute('data-link-focus-requested')==='true'&&await linkedPage.evaluate(()=>window.opener===null),'Published link requests focus for the new tab and clears its opener');
 await linkedPage.close();
 ok(await page.locator('.formatted-writing figcaption').innerText()==='A stop on the safari route','Saved inline image and caption appear in the published preview');
 await open('/blogs/new');
 await page.locator('#review-title').fill('The Complete Serengeti Safari Guide');
 await page.locator('#review-slug').fill('serengeti-safari-guide');
 await page.locator('#review-seoTitle').fill('Serengeti Safari Guide | Wildlife & Best Time to Visit');
 await page.locator('#review-seoDescription').fill('Discover Serengeti National Park and the Great Migration.');
 await body.fill('Why Visit the Serengeti?');
 await style.selectOption('h2');
 await body.press('End');
 await body.press('Enter');
 await page.keyboard.insertText('The Great Migration');
 await style.selectOption('h3');
 await page.getByRole('button',{name:'Preview current draft'}).click();
 const draft=page.locator('.review-article .formatted-writing');
 ok(await draft.locator('h3').innerText()==='Why Visit the Serengeti?'&&await draft.locator('h4').innerText()==='The Great Migration','Blog draft renders a section and a nested subsection');
 ok((await page.locator('.review-seo').innerText()).includes('serengeti-safari-guide')&&await draft.getByText('Discover Serengeti National Park and the Great Migration.',{exact:true}).count()===0,'Blog metadata and slug stay separate from the article body');
 await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await page.getByText('Saved in this browser',{exact:true}).waitFor();
 await open('/media');
 let releaseUpload;
 const uploadWait=new Promise(resolve=>{releaseUpload=resolve;});
 await page.route('**/api/media/signature',async route=>{
   await uploadWait;
   await route.fulfill({status:503,json:{error:'Test upload rejected'}});
 },{times:1});
 const uploadPng=await page.evaluate(async()=>{
   const canvas=new OffscreenCanvas(64,64);
   canvas.getContext('2d').fillRect(0,0,64,64);
   return Array.from(new Uint8Array(await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer()));
 });
 await page.locator('#library-upload').setInputFiles({name:'upload-test.png',mimeType:'image/png',buffer:Buffer.from(uploadPng)});
 await page.locator('#moduleRoot .loading-status .cms-spinner').waitFor();
 ok(await page.locator('#library-upload').isDisabled(),'Gallery shows a spinner and blocks repeat uploads while checking');
 releaseUpload();
 await page.locator('#moduleRoot').getByText('Test upload rejected',{exact:true}).waitFor({timeout:8000});
 await page.locator('#toast[data-tone="error"]').getByText(/images could not be added/).waitFor();
 await page.waitForFunction(()=>!document.querySelector('#library-upload').disabled);
 ok(true,'Failed upload shows a popup and allows retry');
 await page.goto(base+'/workspace#/dashboard');
 const shortcuts=page.locator('.dashboard-side .quick-action');
 await shortcuts.first().waitFor();
 ok((await shortcuts.allTextContents()).join('|')==='New Booking|Quotation|Add Tour|Write Blog|Settings|Gallery|Backup','Dashboard has all seven requested shortcuts on the right');
 for(const width of [360,768,1024,1440]){
   await page.setViewportSize({width,height:900});
   ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Dashboard fits '+width+'px');
 }
 ok(!errors.length,'No browser errors');
 console.log(checks+' workflow checks passed');
} finally {
 await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
