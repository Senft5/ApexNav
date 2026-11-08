// Public road feeds the phone can't fetch itself (no CORS), relayed for the route-context providers (web/route_ctx/).
// GET /api/ctx/workzones?state=KY&tiles=78_-170,78_-169 → the WZDx features of that state's feed that touch those 0.5° tiles,
// unchanged (a GeoJSON FeatureCollection; web/route_ctx/hazards_live.js parses it as it parses the feeds it reads directly).
// The phone sends only 0.5° tiles (about 55 x 43 km), coarser than VI-1's 0.1° cells; nothing is logged or stored. The feed
// itself is fetched at most every 30 min per Cloudflare location (fetch cache), and no account is needed: it is public data.
// Feeds: Kentucky Transportation Cabinet WZDx v4.1 (USDOT WZDx feed registry, data.transportation.gov 69qe-yiui; no key,
// public records), served from a Google Cloud Storage bucket without CORS headers.
import { Env, HttpError, json } from "./util";

// Free client keys for the route-context sources (docs/OWNER_TODO.md): the owner sets the Worker secret CTX_KEYS to JSON such
// as {"seatgeekClientId": "...", "mapillaryToken": "MLY|...", "ohgoApiKey": "...", "nassApiKey": "..."}.
// GET /api/ctx/keys hands the known names to the app (they are client keys, the kind each service expects inside an app; the
// code never holds one). Unknown names are dropped; no secret is set → {}.
export const CTX_KEY_NAMES = ["seatgeekClientId", "mapillaryToken", "ohgoApiKey", "nassApiKey"];
export function ctxKeys(env: Env): Response {
  let all: Record<string, unknown> = {};
  try { all = env.CTX_KEYS ? JSON.parse(env.CTX_KEYS) : {}; } catch { all = {}; }
  const keys: Record<string, string> = {};
  for (const k of CTX_KEY_NAMES) if (typeof all[k] === "string" && all[k]) keys[k] = all[k] as string;
  return json({ keys }, 200, { "cache-control": "private, max-age=3600" });
}

export const WZDX_FEEDS: Record<string, string> = {
  KY: "https://storage.googleapis.com/kytc-its-2020-openrecords/public/feeds/WZDx/kytc_wzdx_v4.1.geojson",
};
const TILE = 0.5, MAX_TILES = 40;

type Feature = { type: string; geometry?: { type: string; coordinates: unknown }; properties?: Record<string, unknown> };

/** "i_j" keys of 0.5° tiles → boxes [s, w, n, e]; throws 400 on a malformed or too long list. */
export function parseTiles(s: string | null): [number, number, number, number][] {
  const keys = (s ?? "").split(",").filter(Boolean);
  if (!keys.length || keys.length > MAX_TILES || !keys.every((k) => /^-?\d{1,3}_-?\d{1,3}$/.test(k))) throw new HttpError(400, "bad_tiles");
  return keys.map((k) => { const [i, j] = k.split("_").map(Number); return [i * TILE, j * TILE, (i + 1) * TILE, (j + 1) * TILE]; });
}

function positions(g: Feature["geometry"]): [number, number][] {
  if (!g || !Array.isArray(g.coordinates)) return [];
  const c = g.coordinates as unknown[];
  if (g.type === "Point") return [c as [number, number]];
  if (g.type === "LineString" || g.type === "MultiPoint") return c as [number, number][];
  if (g.type === "MultiLineString" || g.type === "Polygon") return (c as [number, number][][]).flat();
  return [];
}

/** The features with any position inside any box. */
export function inTiles(features: Feature[], boxes: [number, number, number, number][]): Feature[] {
  return features.filter((f) => positions(f.geometry).some(([lon, lat]) => boxes.some(([s, w, n, e]) => lat >= s && lat < n && lon >= w && lon < e)));
}

export async function workzones(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams, state = (q.get("state") ?? "").toUpperCase();
  const src = WZDX_FEEDS[state];
  if (!src) throw new HttpError(400, "unknown_state");
  const boxes = parseTiles(q.get("tiles"));
  let feed: { features?: Feature[]; feed_info?: unknown };
  try {
    const r = await fetch(src, { cf: { cacheTtl: 1800, cacheEverything: true } } as RequestInit);
    if (!r.ok) return json({ error: "feed_unavailable" }, 502);
    feed = await r.json();
  } catch { return json({ error: "feed_unavailable" }, 502); }
  return json({ type: "FeatureCollection", feed_info: feed.feed_info ?? null, features: inTiles(Array.isArray(feed.features) ? feed.features : [], boxes) }, 200, { "cache-control": "public, max-age=600" });
}
