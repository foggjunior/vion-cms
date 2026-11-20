// Area 4: upload image checks after the sharp 0.35.5 upgrade. Synthetic images only; Cloudinary is a mock.
import test from 'node:test';import assert from 'node:assert/strict';
import sharp from 'sharp';
import {inspectImage,blockedLoaders,IMAGE_LIMITS} from '../image-inspect.mjs';
import {verifyRemote} from '../direct-media.mjs';

const make=(format,width=1200,height=800)=>sharp({create:{width,height,channels:3,background:{r:40,g:120,b:80}}})[format]().toBuffer();
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
const avif=Buffer.concat([Buffer.from([0,0,0,0x1c]),Buffer.from('ftypavif'),Buffer.alloc(64)]);

test('sharp 0.35.5 or later is installed and unused loaders are blocked',async()=>{
 const [major,minor,patch]=sharp.versions.sharp.split('.').map(Number);
 assert(major>0||minor>35||(minor===35&&patch>=5),'sharp '+sharp.versions.sharp);
 for(const loader of ['VipsForeignLoadHeif','VipsForeignLoadSvg','VipsForeignLoadNsgif','VipsForeignLoadTiff'])assert(blockedLoaders.includes(loader),loader+' not blocked');
 await assert.rejects(()=>sharp(svg).metadata(),'the SVG loader refuses to run even if called directly');
});

test('JPEG, PNG and WebP are accepted with their real dimensions',async()=>{
 for(const format of ['jpeg','png','webp']){const info=await inspectImage(await make(format));assert.equal(info.type,'image/'+format);assert.equal(info.width,1200);assert.equal(info.height,800);}
});

test('SVG, GIF, HEIF/AVIF and unknown bytes are rejected before decoding',async()=>{
 for(const bytes of [svg,gif,avif,Buffer.from('not an image at all')])await assert.rejects(()=>inspectImage(bytes),e=>e.status===422&&/JPEG, PNG and WebP/.test(e.message));
});

test('Oversized files and images over 40 million pixels are rejected',async()=>{
 await assert.rejects(()=>inspectImage(Buffer.alloc(IMAGE_LIMITS.maxBytes+1)),e=>/10 MB/.test(e.message));
 const huge=await sharp({create:{width:8000,height:6000,channels:3,background:'#335533'}}).png({compressionLevel:9}).toBuffer();
 assert(huge.length<IMAGE_LIMITS.maxBytes,'a small file can still claim a huge canvas');
 // sharp 0.35.5 already refuses the header via limitInputPixels; the explicit pixel check is a second guard.
 await assert.rejects(()=>inspectImage(huge),e=>e.status===422&&/40 million pixels|too large/.test(e.message));
 await assert.rejects(()=>inspectImage(Buffer.from([0xff,0xd8,0xff,0xe0,1,2,3])),e=>e.status===422,'truncated JPEG');
});

test('Cloudinary verification (mocked) accepts a real image and rejects mismatches',async()=>{
 const jpeg=await make('jpeg');
 const provider=meta=>({api:{resource:async()=>({bytes:jpeg.length,format:'jpg',width:1200,height:800,secure_url:'https://res.cloudinary.com/demo/image/upload/v1/vion-cms/x.jpg',...meta})}});
 const serve=bytes=>async()=>new Response(bytes);
 const ok=await verifyRemote('vion-cms/x',{provider:provider(),fetcher:serve(jpeg)});
 assert.equal(ok.dimensions.width,1200);assert.equal(ok.type,'image/jpeg');
 await assert.rejects(()=>verifyRemote('vion-cms/x',{provider:provider({format:'gif'}),fetcher:serve(jpeg)}),e=>e.status===422);
 await assert.rejects(()=>verifyRemote('vion-cms/x',{provider:provider({width:9000,height:9000}),fetcher:serve(jpeg)}),e=>e.status===422);
 await assert.rejects(()=>verifyRemote('vion-cms/x',{provider:provider({secure_url:'https://evil.example/x.jpg'}),fetcher:serve(jpeg)}),/Unexpected image delivery host/);
 await assert.rejects(()=>verifyRemote('vion-cms/x',{provider:provider(),fetcher:serve(svg)}),e=>e.status===422,'bytes must match an accepted format');
 await assert.rejects(()=>verifyRemote('vion-cms/x',{provider:provider(),fetcher:serve(Buffer.alloc(IMAGE_LIMITS.maxBytes+10))}),e=>e.status===422);
 await assert.rejects(()=>verifyRemote('vion-cms/x',{provider:provider(),fetcher:async()=>new Response('',{status:404})}),/could not be verified/);
});
