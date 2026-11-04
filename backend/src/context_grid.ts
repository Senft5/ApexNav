// The context grid's wider region (web/route_ctx/context_grid.js): bundles of public national datasets (night lights, land
// cover, road noise, census, HPMS traffic, FARS crashes, flood zones, crops, parks) preprocessed by tools/ctx_etl and kept in
// KV (CTX) by .github/workflows/context-grid.yml, because the seven-state launch region is too big to commit. The Cincinnati
// bundles ship in web/data/ctx/v1 instead. Public data, no sign-in: a request says only which ~150 km tile a route is in.
import type { Env } from "./util";
import { HttpError } from "./util";

const KEY = /^v1\/(index\.json|8\/\d{1,3}\/\d{1,3}\.vcg)$/;

/** GET /api/ctx/v1/index.json and /api/ctx/v1/8/:x/:y.vcg: the bytes from KV, cached a day by the phone and the edge. */
export async function ctxServe(env: Env, key: string): Promise<Response> {
  if (!KEY.test(key)) throw new HttpError(404, "not_found");
  if (!env.CTX) throw new HttpError(404, "ctx_off");                // not set up yet (docs/OWNER_TODO.md): the phone uses its own copy
  const bytes = await env.CTX.get(key, "arrayBuffer");
  if (!bytes) throw new HttpError(404, "not_found");
  return new Response(bytes, { headers: {
    "content-type": key.endsWith(".json") ? "application/json" : "application/octet-stream",
    "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" } });
}
