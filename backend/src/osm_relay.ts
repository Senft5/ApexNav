// OpenStreetMap map features for a planned route, relayed (web/route_ctx/osm_overpass.js): the public Overpass servers send
// no CORS headers when they are busy (overpass-api.de answered 502 without them, maps.mail.ru 504, on every live run of
// 2026-11-04), so the phone could never read them. GET /api/ctx/osm?bbox=s,w,n,e takes ONE 0.05° tile box of the grid the
// phone caches by (about 5 x 4 km; anything finer, larger or off the grid is refused), asks the mirrors for it server-side
// (the first good answer wins, MIRROR_MS each), and answers the elements with only the tags the phone reads (KEEP), the
// same shape Overpass returns. Kept a week per tile in the Cache API (and in KV when a binding named OSM exists); a miss
// that outlasts the phone's wait is still finished and kept (ctx.waitUntil), so the next plan there has it. No account,
// nothing about the driver: a tile box is all the request says, as it was when the phone asked Overpass itself.
// Data: © OpenStreetMap contributors, ODbL (About > Sources).

export const TILE = 0.05;
export const KEEP_S = 7 * 86400;
export const MIRROR_MS = 9000;
// the Overpass usage policy asks for an identifying User-Agent with a way to reach the operator (no person's email)
export const UA = "Vetta-route-context/1.0 (+https://apexnav.senftns.workers.dev/about.html)";
export const WAIT_MS = 3500;   // a miss: the phone gets 504 after this (its plan has moved on) and the fetch finishes for the next one
export const MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
// kept in step with web/route_ctx/osm_overpass.js (tests/test_osm_relay_parity.py compares them)
export const DRIVABLE = "^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road)(_link)?$";
export const R_SIGN = 40;
export const KEEP = new Set(["highway", "name", "ref", "maxspeed", "maxspeed:forward", "maxspeed:backward", "lanes", "oneway", "surface", "maxheight", "maxwidth", "maxweight",
  "smoothness", "hgv", "access", "vehicle", "motor_vehicle", "motorcar", "bridge", "covered", "junction", "traffic_calming",
  "crossing", "railway", "hazard", "animal", "traffic_sign", "barrier", "tourism", "historic", "amenity", "opening_hours", "brand",
  "route", "network", "scenic", "service", "stop", "dual_carriageway", "memorial", "bridge:name", "tunnel", "ford"]);

/** "s,w,n,e" → the grid tile "i_j" it is, or null: exactly one 0.05° box on the grid, nothing finer or larger. */
export function tileOf(bbox: string | null): string | null {
  const v = (bbox ?? "").split(",").map(Number);
  if (v.length !== 4 || !v.every(Number.isFinite)) return null;
  const [s, w, n, e] = v, i = Math.round(s / TILE), j = Math.round(w / TILE);
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  if (!near(s, i * TILE) || !near(w, j * TILE) || !near(n, (i + 1) * TILE) || !near(e, (j + 1) * TILE)) return null;
  if (Math.abs(s) > 85 || Math.abs(w) > 180) return null;
  return `${i}_${j}`;
}

/** The Overpass query for one tile: osm_overpass.js query([tile]), character for character. */
export function query(tiles: string[]): string {
  const bb = (k: string) => { const [i, j] = k.split("_").map(Number); return [i * TILE, j * TILE, (i + 1) * TILE, (j + 1) * TILE].map((v) => v.toFixed(4)).join(","); };
  const ways = tiles.map((k) => `way(${bb(k)})[highway~"${DRIVABLE}"];`).join("");
  const pois = tiles.map((k) => `nwr(${bb(k)})[~"^(tourism|historic)$"~"^(viewpoint|memorial|marker|monument|milestone|wayside_cross|wayside_shrine|ruins|fort|battlefield|mill|archaeological_site|boundary_stone|bridge|building|church|yes)$"];` +
    `nwr(${bb(k)})[amenity=fuel];`).join("");
  return `[out:json][timeout:25][maxsize:67108864];(${ways})->.r;` +
    `(node(w.r)[highway~"^(traffic_signals|stop|give_way|crossing|mini_roundabout)$"];node(w.r)[traffic_calming];node(w.r)[railway=level_crossing];node(w.r)[crossing];node(w.r)[ford];)->.on;` +
    `node(around.r:${R_SIGN})[~"^(hazard|traffic_sign)$"~"."]->.signs;way(around.r:15)[barrier=guard_rail]->.rails;(${pois})->.poi;` +
    `rel(bw.r)[route~"^(bicycle|road)$"]->.rels;` +
    `.r out body geom qt;.on out body qt;.signs out body qt;.rails out tags geom qt;.poi out tags center qt;` +
    `foreach.rels->.x{.x out tags;way.r(r.x);out ids;}`;
}

type El = { type: string; id: number; lat?: number; lon?: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[]; nodes?: number[]; center?: { lat: number; lon: number } };
const r6 = (v: number) => +v.toFixed(6);   // as the phone rounds (osm_overpass.js parse)
/** Overpass JSON → the same elements, in the same order, with only the KEEP tags and 6-decimal positions. */
export function compact(json: unknown): { elements: El[] } {
  const out: El[] = [];
  for (const e of ((json as { elements?: El[] })?.elements ?? [])) {
    if (!e || typeof e.type !== "string") continue;
    const x: El = { type: e.type, id: e.id };
    if (e.tags) { const t: Record<string, string> = {}; for (const k in e.tags) if (KEEP.has(k)) t[k] = e.tags[k]; x.tags = t; }
    if (typeof e.lat === "number" && typeof e.lon === "number") { x.lat = r6(e.lat); x.lon = r6(e.lon); }
    if (Array.isArray(e.geometry)) x.geometry = e.geometry.filter((p) => p && typeof p.lat === "number").map((p) => ({ lat: r6(p.lat), lon: r6(p.lon) }));
    if (Array.isArray(e.nodes)) x.nodes = e.nodes;
    if (e.center && typeof e.center.lat === "number") x.center = { lat: r6(e.center.lat), lon: r6(e.center.lon) };
    out.push(x);
  }
  return { elements: out };
}

type Kv = { get(k: string, t: "text"): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> };
type Waiter = { waitUntil(p: Promise<unknown>): void };

/** The first mirror to answer good JSON for the query (remark "runtime error" / "timed out" is not good); null if none. */
export async function ask(q: string, fetcher: typeof fetch = fetch, mirrors = MIRRORS, ms = MIRROR_MS): Promise<unknown | null> {
  try {
    return await Promise.any(mirrors.map(async (url) => {
      const r = await fetcher(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA }, signal: AbortSignal.timeout(ms) });
      if (!r.ok) throw new Error(`http ${r.status}`);
      const j = await r.json() as { remark?: string; elements?: unknown };
      if (!j || !Array.isArray(j.elements) || (j.remark && /error|timed out/i.test(j.remark))) throw new Error("bad answer");
      return j;
    }));
  } catch { return null; }
}

/** ?diag=1: each mirror asked once for the tile, in parallel: its status, time and size (never the data), and the cache. */
export async function diag(tile: string, fetcher: typeof fetch = fetch, ms = MIRROR_MS): Promise<Response> {
  const q = query([tile]);
  const mirrors = await Promise.all(MIRRORS.map(async (url) => {
    const t0 = Date.now();
    try {
      const r = await fetcher(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA }, signal: AbortSignal.timeout(ms) });
      const text = await r.text();
      let elements: number | null = null, remark: string | null = null;
      try { const j = JSON.parse(text); elements = Array.isArray(j.elements) ? j.elements.length : null; remark = typeof j.remark === "string" ? j.remark.slice(0, 120) : null; } catch { /* not JSON */ }
      return { mirror: new URL(url).host, status: r.status, ms: Date.now() - t0, bytes: text.length, elements, remark, head: elements == null ? text.slice(0, 120) : undefined };
    } catch (e) { return { mirror: new URL(url).host, status: 0, ms: Date.now() - t0, error: String((e as Error)?.name || e).slice(0, 80) }; }
  }));
  const cache = typeof caches !== "undefined" ? (caches as unknown as { default: Cache }).default : null;
  let cached: boolean | null = null;
  try { cached = cache ? !!(await cache.match(cacheKey(tile))) : null; } catch { cached = null; }
  return new Response(JSON.stringify({ tile, cached, mirrors }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
const cacheKey = (tile: string) => new Request(`https://apexnav.cache/osm/v1/${tile}`);

// Built tiles (tools/osm_ctx/build.py, .github/workflows/osm-ctx.yml, 2026-11-14): the same elements built each week from
// the Geofabrik extracts and kept in R2 (DATA, osm/v1/<bi>_<bj>.txt.gz, one 0.25° bundle of 25 tiles, a line each:
// "<tile>\t<json>"), read before Overpass, which timed out or refused on nearly every service check from 2026-11-12. A
// tile outside the built region, or across its border (not in its bundle), still goes to Overpass.
export const BUNDLE = 5;
export const bundleKey = (tile: string) => { const [i, j] = tile.split("_").map(Number); return `osm/v1/${Math.floor(i / BUNDLE)}_${Math.floor(j / BUNDLE)}.txt.gz`; };
type R2Get = { get(k: string): Promise<{ body: ReadableStream } | null>; head?(k: string): Promise<unknown> };
// the last bundles read, per isolate: the next tile a plan asks for is usually in the same 0.25° bundle
const bundles = new Map<string, Promise<string | null>>();
const BUNDLES_KEPT = 3;
export function resetBuiltForTest(): void { bundles.clear(); builtIndex = null; }
async function bundleText(data: R2Get, key: string): Promise<string | null> {
  let p = bundles.get(key);
  if (!p) {
    p = (async () => {
      try {
        const o = await data.get(key);
        if (!o) return null;
        return await new Response(o.body.pipeThrough(new DecompressionStream("gzip"))).text();
      } catch { return null; }
    })();
    bundles.set(key, p);
    while (bundles.size > BUNDLES_KEPT) bundles.delete(bundles.keys().next().value as string);
  }
  const text = await p;
  if (text == null) bundles.delete(key);   // not there (yet), or R2 failed: asked again next time
  return text;
}
// whether a build is in R2 at all (osm/v1/index.json), asked at most every 10 minutes per isolate: with one, a tile it
// doesn't hold (outside the three states, or across their border) answers 504 at once instead of holding the plan while
// Overpass is tried (still tried in the background and kept, for the next plan there)
let builtIndex: { at: number; on: boolean } | null = null;
export async function hasBuild(data: { head?(k: string): Promise<unknown> } | undefined, now = Date.now()): Promise<boolean> {
  if (!data || typeof data.head !== "function") return false;
  if (builtIndex && now - builtIndex.at < 600_000) return builtIndex.on;
  let on = false;
  try { on = !!(await data.head("osm/v1/index.json")); } catch { on = false; }
  builtIndex = { at: now, on };
  return on;
}
/** The tile's built elements (compact JSON text), or null when it wasn't built (Overpass then). */
export async function builtTile(data: R2Get | undefined, tile: string): Promise<string | null> {
  if (!data) return null;
  const text = await bundleText(data, bundleKey(tile));
  if (!text) return null;
  const head = `${tile}\t`;
  const at = text.startsWith(head) ? 0 : (() => { const k = text.indexOf(`\n${head}`); return k < 0 ? -1 : k + 1; })();
  if (at < 0) return null;
  const end = text.indexOf("\n", at);
  return text.slice(at + head.length, end < 0 ? undefined : end);
}

const inflight = new Map<string, Promise<string | null>>();
/**
 * GET /api/ctx/osm?bbox=: the tile's compact elements from the cache, else from the mirrors (then kept). `waiter` keeps a
 * miss running past the response; `waitMs` is how long the response waits for a miss before answering 504 (still
 * finishing and keeping it).
 */
export async function osmTile(url: URL, env: { OSM?: Kv; DATA?: R2Get }, waiter?: Waiter, fetcher: typeof fetch = fetch, waitMs = WAIT_MS): Promise<Response> {
  const tile = tileOf(url.searchParams.get("bbox"));
  const headers = { "content-type": "application/json", "cache-control": `public, max-age=${KEEP_S}`, "x-content-type-options": "nosniff" };
  if (!tile) return new Response(JSON.stringify({ error: "bad_bbox" }), { status: 400, headers: { "content-type": "application/json" } });
  if (url.searchParams.get("diag") === "1") return diag(tile, fetcher);
  const key = new Request(`https://apexnav.cache/osm/v1/${tile}`), kvKey = `osm/v1/${tile}`;
  const cache = typeof caches !== "undefined" ? (caches as unknown as { default: Cache }).default : null;
  try {
    const hit = cache ? await cache.match(key) : undefined;
    if (hit) return new Response(hit.body, { headers: { ...headers, "x-cache": "hit" } });
    const kv = env.OSM ? await env.OSM.get(kvKey, "text") : null;
    if (kv) { if (cache) await cache.put(key, new Response(kv, { headers })); return new Response(kv, { headers: { ...headers, "x-cache": "kv" } }); }
  } catch { /* the cache is a speed-up, never a failure */ }
  const built = await builtTile(env.DATA, tile);
  if (built != null) {
    try { if (cache) await cache.put(key, new Response(built, { headers })); } catch { /* read from R2 again next time */ }
    return new Response(built, { headers: { ...headers, "x-cache": "built" } });
  }
  let job = inflight.get(tile);
  if (!job) {
    job = (async () => {
      const j = await ask(query([tile]), fetcher);
      if (!j) return null;
      const body = JSON.stringify(compact(j));
      try { if (cache) await cache.put(key, new Response(body, { headers })); } catch { /* not kept: asked again next time */ }
      try { if (env.OSM) await env.OSM.put(kvKey, body, { expirationTtl: KEEP_S }); } catch { /* KV optional */ }
      return body;
    })().finally(() => inflight.delete(tile));
    inflight.set(tile, job);
    if (waiter) waiter.waitUntil(job);
  }
  const wait = (await hasBuild(env.DATA)) ? 0 : waitMs;   // built region: an unbuilt tile isn't worth the plan's wait
  const body = await Promise.race([job, new Promise<"late">((r) => setTimeout(() => r("late"), wait))]);
  if (body === "late") return new Response(JSON.stringify({ error: "still_fetching" }), { status: 504, headers: { "content-type": "application/json", "retry-after": "10" } });
  if (!body) return new Response(JSON.stringify({ error: "overpass_unavailable" }), { status: 502, headers: { "content-type": "application/json" } });
  return new Response(body, { headers: { ...headers, "x-cache": "miss" } });
}
