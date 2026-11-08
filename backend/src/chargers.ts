// EV chargers for fuel-stop spacing (web/route_ctx/car.js): the Alternative Fuel Stations API (US DOE, public domain) of the
// lab once called NREL, renamed the National Laboratory of the Rockies (NLR): developer.nrel.gov no longer resolves, the API
// is at developer.nlr.gov (same paths, same api.data.gov keys; the secret keeps its old name NREL_API_KEY). Asked by tile so
// the key the owner creates (free, api.data.gov; docs/OWNER_TODO.md) never ships in the app. The phone sends 0.25-degree
// tile ids its route passes through, never the route or a position; each tile is one "nearest" call from the tile's
// centre, cached a day at Cloudflare's edge. No key: 503 no_key, and the phone says so.
import { Env, HttpError } from "./util";

export const TILE = 0.25, MAX_TILES = 40, RADIUS_MI = 11;
const NREL = "https://developer.nlr.gov/api/alt-fuel-stations/v1/nearest.json";

/** Tile ids "i_j" (0.25-degree indices) from the query, validated; throws 400. */
export function parseTiles(raw: string | null): [number, number][] {
  const parts = (raw ?? "").split(",").filter(Boolean);
  if (!parts.length || parts.length > MAX_TILES) throw new HttpError(400, "bad_tiles");
  return parts.map((p) => {
    const m = /^(-?\d{1,3})_(-?\d{1,3})$/.exec(p);
    if (!m) throw new HttpError(400, "bad_tiles");
    const [i, j] = [Number(m[1]), Number(m[2])];
    if (i < -360 || i >= 360 || j < -720 || j >= 720) throw new HttpError(400, "bad_tiles");
    return [i, j];
  });
}

/** NREL's answer as stations inside the tile: [{ lat, lon, dc }] (dc: has DC fast charging). Public, open stations only. */
export function parseNrel(json: unknown, [i, j]: [number, number]): { lat: number; lon: number; dc: boolean }[] {
  const list = (json as { fuel_stations?: Record<string, unknown>[] })?.fuel_stations ?? [];
  const [s, w] = [i * TILE, j * TILE];
  return list.flatMap((x) => {
    const lat = x.latitude, lon = x.longitude;
    if (typeof lat !== "number" || typeof lon !== "number" || lat < s || lat >= s + TILE || lon < w || lon >= w + TILE) return [];
    return [{ lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, dc: typeof x.ev_dc_fast_num === "number" && x.ev_dc_fast_num > 0 }];
  });
}

export async function chargers(env: Env, url: URL, fetcher: typeof fetch = fetch) {
  const tiles = parseTiles(url.searchParams.get("tiles"));
  if (!env.NREL_API_KEY) throw new HttpError(503, "no_key");
  const cache = typeof caches !== "undefined" ? (caches as unknown as { default: Cache }).default : null;
  const stations: { lat: number; lon: number; dc: boolean }[] = [];
  let failed = 0;
  await Promise.all(tiles.map(async (t) => {
    const key = new Request(`https://apexnav.cache/chargers/v1/${t[0]}_${t[1]}`);
    try {
      const hit = cache ? await cache.match(key) : undefined;
      if (hit) { stations.push(...((await hit.json()) as typeof stations)); return; }
      const q = new URLSearchParams({ api_key: env.NREL_API_KEY!, latitude: String((t[0] + 0.5) * TILE), longitude: String((t[1] + 0.5) * TILE),
        radius: String(RADIUS_MI), fuel_type: "ELEC", status: "E", access: "public", limit: "200" });
      const r = await fetcher(`${NREL}?${q}`);
      if (!r.ok) { failed++; return; }
      const mine = parseNrel(await r.json(), t);
      stations.push(...mine);
      if (cache) await cache.put(key, new Response(JSON.stringify(mine), { headers: { "content-type": "application/json", "cache-control": "max-age=86400" } }));
    } catch { failed++; }
  }));
  return { stations, partial: failed > 0 };
}
