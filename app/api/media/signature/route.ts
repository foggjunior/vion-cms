import {requireActor,sameOrigin,jsonBody,failure} from '../../../../server/auth.mjs';import {beginUpload} from '../../../../server/direct-media.mjs';
export const runtime='nodejs';export async function POST(req:Request){try{sameOrigin(req);return Response.json(await beginUpload(await requireActor(),await jsonBody(req,10000)))}catch(e){return failure(e)}}
