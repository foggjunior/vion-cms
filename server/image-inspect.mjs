// Image checks shared by both upload paths (server/media.mjs and server/direct-media.mjs).
//
// The CMS accepts only JPEG, PNG and WebP, recognised by their bytes before anything is decoded. As defence in
// depth, libvips' other loaders are blocked for this process, so a crafted file cannot reach the loaders
// named in sharp's 2026 security advisories (HEIF/AVIF, SVG, GIF, TIFF, VIPS) even if detection were bypassed:
// GHSA-f88m-g3jw-g9cj (libvips, fixed 0.35.0), GHSA-rgj7-g3m4-5g8c (libheif, fixed 0.35.4),
// GHSA-wq5f-xc86-pv6w (librsvg, fixed 0.35.5). sharp itself is pinned to ^0.35.5.
//
// sharp's metadata() reads the header without decoding pixels, so limitInputPixels alone would not stop an
// oversized image there; the pixel count is therefore checked explicitly.
import sharp from 'sharp';
import {sniffImageType} from '../src/storage/media-validation.js';

export const IMAGE_LIMITS=Object.freeze({maxBytes:10*1024*1024,maxPixels:40_000_000,types:Object.freeze(['image/jpeg','image/png','image/webp'])});
export const BLOCKED_LOADERS=Object.freeze(['VipsForeignLoadHeif','VipsForeignLoadSvg','VipsForeignLoadNsgif','VipsForeignLoadTiff','VipsForeignLoadVips','VipsForeignLoadMagick','VipsForeignLoadPdf','VipsForeignLoadJxl','VipsForeignLoadFits','VipsForeignLoadOpenexr','VipsForeignLoadMat','VipsForeignLoadAnalyze','VipsForeignLoadRad','VipsForeignLoadPpm','VipsForeignLoadCsv','VipsForeignLoadMatrix']);
export const blockedLoaders=[];
for(const operation of BLOCKED_LOADERS){try{sharp.block({operation:[operation]});blockedLoaders.push(operation);}catch{/* not built into this libvips */}}

const invalid=message=>Object.assign(Error(message),{status:422});

export async function inspectImage(buffer,{limits=IMAGE_LIMITS}={}){
 if(!buffer?.length||buffer.length>limits.maxBytes)throw invalid('Choose an image up to 10 MB.');
 const type=await sniffImageType(new Blob([buffer]));
 if(!limits.types.includes(type))throw invalid('Only JPEG, PNG and WebP are accepted.');
 let info;
 try{info=await sharp(buffer,{limitInputPixels:limits.maxPixels}).metadata();}catch{throw invalid('The image could not be decoded or is too large.');}
 if(!info.width||!info.height||info.width*info.height>limits.maxPixels)throw invalid('The image is too large (over 40 million pixels) or has no size.');
 if((info.pages||1)>1)throw invalid('Animated or multi-page images are not accepted.');
 return {type,width:info.width,height:info.height};
}
