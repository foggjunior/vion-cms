import { readFile } from "node:fs/promises";
import { requireActor } from "../../server/auth.mjs";
import { canAccessFinance } from "../../server/policy.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let actor;
  try { actor = await requireActor(); }
  catch { return Response.redirect(new URL("/login", request.url)); }
  if (!canAccessFinance(actor.role)) return new Response("Finance access required.", { status: 403 });
  const html = await readFile(process.cwd() + "/finance/workspace.html", "utf8");
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
  } });
}
