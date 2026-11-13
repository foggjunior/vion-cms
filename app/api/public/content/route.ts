import {snapshot} from "../../../../server/persistence.mjs";
import {admin} from '../../../../server/firebase.mjs';import {project,publicId} from '../../../../server/publication.mjs';import {failure} from '../../../../server/auth.mjs';
export const runtime='nodejs';export async function GET(req:Request){try{const path=new URL(req.url).searchParams.get('path');if(!path||!path.startsWith('/')||path.length>300)return Response.json({error:'A public path is required.'},{status:400});const doc=await admin().db.collection('cms_public').doc(publicId(path)).get();let value=doc.data();
  // The public index may be missing a team entry even when its snapshot exists.
  // Project only published data, using the same rules as the public index.
  if (!value && /^\/_site\/team(?:Lineup|Member)\/[a-z0-9-]+$/i.test(path)) {
    const {entries} = await snapshot();
    value = project(entries).get(path);
  }
  if (!value) return Response.json({error:'Not found'},{status:404});if(value?.redirect)return Response.json({redirect:value.redirect,status:308});return Response.json(value,{headers:{'Cache-Control':'public, max-age=0, s-maxage=60'}});}catch(e){return failure(e)}}
