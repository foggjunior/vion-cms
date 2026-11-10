// Drop-in server-side adapter for the website. Enable only on staging after URL
// reconciliation. The existing website remains unchanged until explicitly wired.
export async function getCmsPublication(origin,path,{fetcher=fetch}={}){const url=new URL('/api/public/content',origin);url.searchParams.set('path',path);const response=await fetcher(url,{cache:'no-store'});if(response.status===404)return null;if(!response.ok)throw Error('CMS publication feed is unavailable.');const payload=await response.json();return payload;}
// In the website's App Router route, call redirect(target, RedirectType.replace)
// using permanentRedirect() for payload.status===308. Never interpolate secrets
// or query private cms_entries from a public browser.
