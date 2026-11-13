// Vetta's own scored road network for the region (docs/OWN_ROUTING.md; web/graph_tiles.js). The tiles are built by
// .github/workflows/graph-region.yml and committed to the repository's `graph-data` branch (v1/<i>_<j>.vgr and
// v1/index.json): free hosting on GitHub, no R2 or KV needed. This route relays them from raw.githubusercontent.com,
// only tile names of the 0.25 degree grid that the index lists (never an arbitrary path), kept in the edge cache under
// the index's build id, so a new build is fetched once and an old one never served as new. Cincinnati's tiles ship in
// the app (web/data/graph/v1); these are the rest of Ohio, Kentucky and Indiana. Public data (OpenStreetMap, ODbL), no
// sign-in: a request says only which ~25 km tile a route crosses.
export const RAW = "https://raw.githubusercontent.com/Senft5/ApexNav/graph-data/v1/";
export const TILE = /^(\d{1,4})_(\d{1,4})\.vgr$/;
export const INDEX_S = 3600;          // the phone and the edge re-check the index hourly (a build is a new id)
export const TILE_S = 86400;          // a tile is re-validated daily by the phone (ETag = build + tile), kept a year at the edge
export const EDGE_TILE_S = 365 * 86400;
export const SUBREQ_S = 7 * 86400;    // Cloudflare's cache of the raw GitHub fetch, per build

import { graphTileKey, r2Bytes, r2GraphIndex } from "./data_store";
import type { Env } from "./util";

type Index = { build?: string; built?: string; tiles?: Record<string, unknown> };
const SEC = { "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" };
const cacheOf = () => (typeof caches !== "undefined" ? (caches as unknown as { default: Cache }).default : null);
const indexKey = () => new Request("https://apexnav.cache/graph/v1/index.json");
const tileKey = (build: string, name: string) => new Request(`https://apexnav.cache/graph/v1/${encodeURIComponent(build)}/${name}`);
const buildOf = (ix: Index) => String(ix.build || ix.built || "0");
const etag = (s: string) => `"${s.replace(/[^\w.:-]/g, "_")}"`;

/** The region index from our R2 bucket (src/data_store.ts), else the edge cache, else raw GitHub; an empty index (no
 *  tiles) when neither has one. */
export async function regionIndex(fetcher: typeof fetch = fetch, env?: Env): Promise<{ body: string; ix: Index }> {
  const r2 = env ? await r2GraphIndex(env) : null;
  if (r2) {
    try { const ix = JSON.parse(r2) as Index; if (ix && ix.tiles) return { body: r2, ix }; } catch { /* GitHub then */ }
  }
  const cache = cacheOf();
  try {
    const hit = cache ? await cache.match(indexKey()) : undefined;
    if (hit) { const body = await hit.text(); return { body, ix: JSON.parse(body) as Index }; }
  } catch { /* the cache is a speed-up, never a failure */ }
  let body = "", ix: Index = {};
  try {
    const r = await fetcher(RAW + "index.json", { headers: { "user-agent": "Vetta-graph-relay/1.0" } });
    if (r.ok) { body = await r.text(); ix = JSON.parse(body) as Index; }
  } catch { body = ""; }
  if (!ix || typeof ix !== "object" || !ix.tiles) { ix = { build: "none", tiles: {} }; body = JSON.stringify({ version: 3, build: "none", tiles: {} }); }
  try { if (cache) await cache.put(indexKey(), new Response(body, { headers: { "content-type": "application/json", "cache-control": `public, max-age=${INDEX_S}` } })); } catch { /* not kept */ }
  return { body, ix };
}

/** GET /api/graph/v1/index.json */
export async function graphIndex(req: Request, fetcher: typeof fetch = fetch, env?: Env): Promise<Response> {
  const { body, ix } = await regionIndex(fetcher, env);
  const tag = etag(buildOf(ix));
  const headers = { "content-type": "application/json", "cache-control": `public, max-age=${INDEX_S}`, etag: tag, ...SEC };
  if (req.headers.get("if-none-match") === tag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}

/** GET /api/graph/v1/<i>_<j>.vgr: a tile the index lists, from the edge cache under its build, else raw GitHub. */
export async function graphTile(req: Request, name: string, fetcher: typeof fetch = fetch, env?: Env): Promise<Response> {
  const notFound = () => new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json", ...SEC } });
  if (!TILE.test(name)) return notFound();
  const { ix } = await regionIndex(fetcher, env);
  const key = name.slice(0, -4);
  if (!ix.tiles || !Object.prototype.hasOwnProperty.call(ix.tiles, key)) return notFound();
  const build = buildOf(ix), tag = etag(`${build}-${key}`);
  const headers = { "content-type": "application/octet-stream", "cache-control": `public, max-age=${TILE_S}`, etag: tag, ...SEC };
  if (req.headers.get("if-none-match") === tag) return new Response(null, { status: 304, headers });
  const cache = cacheOf(), ck = tileKey(build, name);
  try {
    const hit = cache ? await cache.match(ck) : undefined;
    if (hit) return new Response(hit.body, { headers: { ...headers, "x-cache": "hit" } });
  } catch { /* the cache is a speed-up */ }
  // our bucket first: a build's tiles are all there before its index is (src/data_store.ts)
  const own = env ? await r2Bytes(env, graphTileKey(build, name)) : null;
  if (own) return new Response(own, { headers: { ...headers, "x-cache": "r2" } });
  let r: Response;
  // the Cache API is a no-op on *.workers.dev (it needs a custom domain), so the subrequest is cached by Cloudflare
  // instead (cacheEverything, a week). The tile's URL is the same in every build, so the build id goes in the query
  // (raw GitHub ignores it, the cache key keeps it): a new build is never answered from an old one's cache.
  const init = { headers: { "user-agent": "Vetta-graph-relay/1.0" }, cf: { cacheTtl: SUBREQ_S, cacheEverything: true } } as RequestInit;
  try { r = await fetcher(`${RAW}${name}?b=${encodeURIComponent(build)}`, init); } catch { r = new Response(null, { status: 502 }); }
  if (!r.ok) return new Response(JSON.stringify({ error: "graph_unavailable" }), { status: 502, headers: { "content-type": "application/json", ...SEC } });
  const bytes = await r.arrayBuffer();
  try { if (cache) await cache.put(ck, new Response(bytes, { headers: { "content-type": "application/octet-stream", "cache-control": `public, max-age=${EDGE_TILE_S}` } })); } catch { /* not kept */ }
  return new Response(bytes, { headers: { ...headers, "x-cache": "miss" } });
}

// Our own camera list for the region (tools/graph_etl/cameras.py, .github/workflows/cameras.yml; web/cameras.js): one file
// on the graph-data branch, relayed. The public Overpass servers time out or refuse the phone when busy; inside the region
// the phone reads this instead. Public OSM data, no sign-in; the request says nothing about the driver.
export const CAMERAS_RAW = "https://raw.githubusercontent.com/Senft5/ApexNav/graph-data/cameras/v1/region.json";
export const CAMERAS_S = 6 * 3600;    // the phone and Cloudflare re-check every 6 hours (a weekly build)

/** GET /api/cameras/v1/region.json: 502 when the data branch has no camera list (yet). */
export async function cameraList(fetcher: typeof fetch = fetch, env?: Env): Promise<Response> {
  const own = env ? await r2Bytes(env, "cameras/v1/region.json") : null;
  if (own) return new Response(own, { headers: { "content-type": "application/json", "cache-control": `public, max-age=${CAMERAS_S}`, "x-cache": "r2", ...SEC } });
  const init = { headers: { "user-agent": "Vetta-graph-relay/1.0" }, cf: { cacheTtl: CAMERAS_S, cacheEverything: true } } as RequestInit;
  let r: Response;
  try { r = await fetcher(CAMERAS_RAW, init); } catch { r = new Response(null, { status: 502 }); }
  if (!r.ok) return new Response(JSON.stringify({ error: "cameras_unavailable" }), { status: 502, headers: { "content-type": "application/json", "cache-control": "no-store", ...SEC } });
  const body = await r.text();
  try { const j = JSON.parse(body) as { tiles?: unknown; cams?: unknown }; if (!Array.isArray(j.tiles) || !Array.isArray(j.cams)) throw new Error("shape"); }
  catch { return new Response(JSON.stringify({ error: "cameras_unavailable" }), { status: 502, headers: { "content-type": "application/json", "cache-control": "no-store", ...SEC } }); }
  return new Response(body, { headers: { "content-type": "application/json", "cache-control": `public, max-age=${CAMERAS_S}`, ...SEC } });
}
