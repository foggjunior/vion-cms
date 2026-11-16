import { readFile } from 'node:fs/promises';
import { requireActor } from '../../server/auth.mjs';
import { workspaceNavigation } from '../../server/workspace-navigation.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  let actor;
  try { actor = await requireActor(); }
  catch { return Response.redirect(new URL('/login', request.url)); }
  if (actor.role === 'accounting') return Response.redirect(new URL('/finance', request.url));

  const html = await readFile(process.cwd() + '/public/approved/index.html', 'utf8');
  return new Response(workspaceNavigation(html, actor.role),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://res.cloudinary.com; connect-src 'self' https://api.cloudinary.com; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"}});
}
