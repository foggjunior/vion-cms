import {admin} from '../../../../server/firebase.mjs';import {failure} from '../../../../server/auth.mjs';import {contentByPath,feedHeaders} from '../../../../server/public-feed.mjs';
// GET ?path=<public path>[&include=media]. A missing team entry falls back to its single stored snapshot
// (publishedTeamEntry), never to a whole-workspace read.
export const runtime='nodejs';export async function GET(req:Request){try{const url=new URL(req.url),path=url.searchParams.get('path');if(!path||!path.startsWith('/')||path.length>300)return Response.json({error:'A public path is required.'},{status:400});
  const value=await contentByPath(admin().db,path,{includeMedia:url.searchParams.get('include')==='media'});
  if(!value)return Response.json({error:'Not found'},{status:404,headers:feedHeaders()});if('redirect' in value)return Response.json({redirect:value.redirect,status:308},{headers:feedHeaders()});return Response.json(value,{headers:feedHeaders()});}catch(e){return failure(e)}}
