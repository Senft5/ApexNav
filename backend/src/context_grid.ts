// The context grid's wider region (web/route_ctx/context_grid.js): bundles of public national datasets (night lights, land
// cover, road noise, census, HPMS traffic, FARS crashes, flood zones, crops, parks) preprocessed by tools/ctx_etl. Served
// from KV (CTX) where .github/workflows/context-grid.yml put them, else from the repository's graph-data branch
// (ctx/v1/, built by .github/workflows/ctx-region.yml for Ohio, Kentucky and Indiana: free, no KV needed), relayed from
// raw.githubusercontent.com behind the edge cache. The Cincinnati bundles ship in web/data/ctx/v1 instead. Public data,
// no sign-in: a request says only which ~150 km tile a route is in.
import type { Env } from "./util";
import { HttpError } from "./util";
import { r2Bytes } from "./data_store";

const KEY = /^v1\/(index\.json|8\/\d{1,3}\/\d{1,3}\.vcg)$/;
export const CTX_RAW = "https://raw.githubusercontent.com/Senft5/ApexNav/graph-data/ctx/";
const SEC = { "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" };
const DAY = 86400, WEEK = 7 * DAY;

/** The key's bytes from the graph-data branch (edge-cached a day for the index, a week for a bundle), or null. */
async function fromGitHub(key: string, fetcher: typeof fetch): Promise<ArrayBuffer | null> {
  const cache = typeof caches !== "undefined" ? (caches as unknown as { default: Cache }).default : null;
  const ck = new Request(`https://apexnav.cache/ctx/${key}`), ttl = key.endsWith(".json") ? 3600 : WEEK;
  try { const hit = cache ? await cache.match(ck) : undefined; if (hit) return await hit.arrayBuffer(); } catch { /* a speed-up only */ }
  let r: Response;
  try {
    r = await fetcher(CTX_RAW + key, { headers: { "user-agent": "Vetta-ctx-relay/1.0" }, cf: { cacheTtl: ttl, cacheEverything: true } } as RequestInit);
  } catch { return null; }
  if (!r.ok) return null;
  const bytes = await r.arrayBuffer();
  try { if (cache) await cache.put(ck, new Response(bytes, { headers: { "cache-control": `public, max-age=${ttl}` } })); } catch { /* not kept */ }
  return bytes;
}

/** GET /api/ctx/v1/index.json and /api/ctx/v1/8/:x/:y.vcg: KV, else the graph-data branch; cached a day by the phone. */
export async function ctxServe(env: Env, key: string, fetcher: typeof fetch = fetch): Promise<Response> {
  if (!KEY.test(key)) throw new HttpError(404, "not_found");
  // our R2 bucket (src/data_store.ts, mirrored by CI), else KV, else the graph-data branch
  let bytes = await r2Bytes(env, `ctx/${key}`);
  if (!bytes && env.CTX) bytes = await env.CTX.get(key, "arrayBuffer");
  if (!bytes) bytes = await fromGitHub(key, fetcher);
  // nothing anywhere: the index says "no bundles here" (an empty index, cached an hour) rather than a 404 every phone
  // logs on every plan; the phone then uses the copy it ships with
  if (!bytes && key === "v1/index.json") return new Response(JSON.stringify({ v: 1, bundles: {} }), { headers: {
    "content-type": "application/json", "cache-control": "public, max-age=3600", ...SEC } });
  if (!bytes) throw new HttpError(404, env.CTX ? "not_found" : "ctx_off");
  return new Response(bytes, { headers: {
    "content-type": key.endsWith(".json") ? "application/json" : "application/octet-stream",
    "cache-control": `public, max-age=${DAY}`, ...SEC } });
}
