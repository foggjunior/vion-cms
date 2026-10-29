// Slug and local route rules. Route prefixes are a prototype assumption (C2 legacy slugs unresolved);
// they never alter live website URLs. Redirects are planned local entries, not real server redirects.
export const ROUTE_PREFIXES = Object.freeze({ destination: '/destinations/', accommodation: '/accommodations/', tour: '/tours/' });

// Documented hub paths that a record slug must never claim.
export const RESERVED_ROUTES = Object.freeze(['/tours/day-trips', '/tours/zanzibar-trips', '/tours/climbing-trips']);

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 96;

export function slugify(text) {
  const slug = String(text || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= SLUG_MAX_LENGTH) return slug;
  const cut = slug.slice(0, SLUG_MAX_LENGTH);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash > 20 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '');
}

export function routeFor(kind, slug) {
  return slug && ROUTE_PREFIXES[kind] ? ROUTE_PREFIXES[kind] + slug : null;
}

export function isReservedRoute(route) { return RESERVED_ROUTES.includes(route); }

export function slugFormatMessage(slug) {
  if (!slug) return null;
  if (slug.length > SLUG_MAX_LENGTH) return `Shorten the slug to ${SLUG_MAX_LENGTH} characters or fewer.`;
  if (!SLUG_PATTERN.test(slug)) {
    const suggestion = slugify(slug);
    return `Use lowercase letters, numbers and single hyphens only${suggestion ? ` — for example "${suggestion}"` : ''}.`;
  }
  return null;
}

// Every route claimed by any record (active or archived): current slug, published route,
// previously published routes and planned redirect sources.
export function routeClaims(ctx) {
  const claims = new Map();
  const add = (route, claim) => {
    if (!route) return;
    if (!claims.has(route)) claims.set(route, []);
    claims.get(route).push(claim);
  };
  for (const env of ctx.records.values()) {
    const { record, workflow } = env;
    add(routeFor(env.kind, record.slug), { recordId: env.id, kind: env.kind, title: record.title, status: record.status, reason: 'current slug' });
    for (const entry of workflow?.routeHistory || []) add(entry.route, { recordId: env.id, kind: env.kind, title: record.title, status: record.status, reason: 'previously published route' });
  }
  for (const pub of ctx.published.values()) {
    add(pub.route, { recordId: pub.id, kind: pub.kind, title: pub.snapshot.title, status: 'published', reason: 'published route' });
  }
  for (const redirect of ctx.redirects || []) {
    add(redirect.from, { recordId: redirect.recordId, kind: redirect.kind, title: ctx.records.get(redirect.recordId)?.record.title || 'unknown record', reason: 'planned redirect source' });
  }
  return claims;
}

export function findRouteConflict(kind, slug, recordId, ctx, claims = routeClaims(ctx)) {
  const route = routeFor(kind, slug);
  if (!route) return null;
  if (isReservedRoute(route)) {
    return { route, reason: 'reserved', message: `${route} is a reserved hub path. Choose a different slug.` };
  }
  const other = (claims.get(route) || []).find(claim => claim.recordId !== recordId);
  if (!other) return null;
  const status = other.status === 'archived' ? ' (archived)' : '';
  return {
    route, reason: other.reason, otherId: other.recordId,
    message: `${route} is already used as the ${other.reason} of "${other.title}"${status}. Slugs must be unique across active and archived records — choose a different slug.`
  };
}

export function uniqueSlug(base, kind, recordId, ctx) {
  const root = slugify(base) || kind;
  const claims = routeClaims(ctx);
  let candidate = root;
  for (let n = 2; findRouteConflict(kind, candidate, recordId, ctx, claims); n += 1) candidate = `${root}-${n}`;
  return candidate;
}

// Pure redirect planning for a record whose published route changes from prevRoute to nextRoute.
// Reclaiming an old route removes its redirect (no loops); existing redirects to prevRoute are
// re-pointed to nextRoute (no chains).
export function planRedirects({ recordId, kind, prevRoute, nextRoute, redirects, now, newId }) {
  const plan = { remove: [], update: [], add: [] };
  for (const r of redirects) {
    if (r.from === nextRoute && r.recordId === recordId) plan.remove.push(r.id);
  }
  if (!prevRoute || prevRoute === nextRoute) return plan;
  for (const r of redirects) {
    if (r.to === prevRoute && r.recordId === recordId && r.from !== nextRoute) plan.update.push({ ...r, to: nextRoute, updatedAt: now });
  }
  if (!redirects.some(r => r.from === prevRoute && !plan.remove.includes(r.id))) {
    plan.add.push({ id: newId(), from: prevRoute, to: nextRoute, statusCode: 308, recordId, kind, createdAt: now, updatedAt: now });
  }
  return plan;
}

export function applyRedirectPlan(redirects, plan) {
  const updated = new Map(plan.update.map(r => [r.id, r]));
  return redirects.filter(r => !plan.remove.includes(r.id)).map(r => updated.get(r.id) || r).concat(plan.add);
}

// Returns human-readable problems: duplicate sources, self-redirects and cycles.
export function redirectProblems(redirects) {
  const problems = [];
  const bySource = new Map();
  for (const r of redirects) {
    if (r.from === r.to) problems.push(`Redirect ${r.from} points to itself.`);
    if (bySource.has(r.from)) problems.push(`More than one redirect starts at ${r.from}.`);
    bySource.set(r.from, r.to);
  }
  for (const start of bySource.keys()) {
    const seen = new Set([start]);
    let next = bySource.get(start);
    while (next && bySource.has(next)) {
      if (seen.has(next)) { problems.push(`Redirects starting at ${start} form a loop.`); break; }
      seen.add(next);
      next = bySource.get(next);
    }
  }
  return [...new Set(problems)];
}
