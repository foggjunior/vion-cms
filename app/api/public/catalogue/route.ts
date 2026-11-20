import {admin} from '../../../../server/firebase.mjs';import {failure} from '../../../../server/auth.mjs';import {cataloguePage,parseCatalogueQuery,feedHeaders} from '../../../../server/public-feed.mjs';
// GET ?kind=<kind>[&after=<cursor>][&limit=1..200][&include=media]
// Returns {items, next, truncated[, media]}. Follow `next` until it is null. `truncated` stays true while
// more pages exist, so an older client that does not paginate still fails loudly instead of silently
// rendering a partial catalogue.
export const runtime='nodejs';export async function GET(req:Request){try{const query=parseCatalogueQuery(new URL(req.url).searchParams);return Response.json(await cataloguePage(admin().db,query),{headers:feedHeaders()})}catch(e){return failure(e)}}
