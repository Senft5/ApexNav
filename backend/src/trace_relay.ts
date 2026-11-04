// The router's edge attributes for a STAGE (web/route_ctx/router_edges.js): a stretch of road cut from the public map tiles,
// the same for everyone who plans near it, never a driver's route. GET /api/ctx/trace?shape=<polyline6, at most MAX_POINTS
// points, MAX_KM long> → Valhalla trace_attributes (map_snap, the attributes the phone reads) as { units, edges }, kept
// KEEP_S per shape in the Cache API, so the network step of the next plan nearby answers at once. Routes the driver is
// offered are not sent here: their lines go to the public router from the phone, as before (docs/APP_REVIEW.md).
// Data: © OpenStreetMap contributors, ODbL, via the FOSSGIS Valhalla server.

export const VALHALLA = "https://valhalla1.openstreetmap.de/trace_attributes";
export const MAX_POINTS = 700, MAX_KM = 40, KEEP_S = 3 * 86400, TIMEOUT_MS = 8000;
// kept in step with web/route_ctx/router_edges.js ATTRS (tests/test_osm_relay_parity.py)
export const ATTRS = ["edge.speed_limit", "edge.speed", "edge.road_class", "edge.use", "edge.density", "edge.lane_count", "edge.surface", "edge.unpaved",
  "edge.bridge", "edge.tunnel", "edge.toll", "edge.traffic_signal", "edge.length", "edge.roundabout", "edge.truck_route", "edge.sidewalk",
  "edge.way_id", "edge.names", "node.traffic_signal", "node.type", "node.intersecting_edge.use", "node.intersecting_edge.driveability", "node.intersecting_edge.road_class"];

/** polyline6 → [[lat, lon]], or null when it isn't one. */
export function decode6(s: string): [number, number][] | null {
  const out: [number, number][] = [];
  let i = 0, lat = 0, lon = 0;
  try {
    while (i < s.length) {
      for (let w = 0; w < 2; w++) {
        let sh = 0, r = 0, b: number;
        do { if (i >= s.length) return null; b = s.charCodeAt(i++) - 63; if (b < 0 || b > 63) return null; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20);
        const d = r & 1 ? ~(r >> 1) : r >> 1;
        if (w === 0) lat += d; else lon += d;
      }
      out.push([lat / 1e6, lon / 1e6]);
    }
  } catch { return null; }
  return out;
}
const hav = (a: [number, number], b: [number, number]) => {
  const R = 6371, p = Math.PI / 180, dLa = (b[0] - a[0]) * p, dLo = (b[1] - a[1]) * p;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * p) * Math.cos(b[0] * p) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
/** A stage's line: 2 to MAX_POINTS points on the earth, at most MAX_KM long; else null. */
export function stageLine(shape: string | null): [number, number][] | null {
  if (!shape || shape.length > 12000) return null;
  const pts = decode6(shape);
  if (!pts || pts.length < 2 || pts.length > MAX_POINTS) return null;
  if (!pts.every(([la, lo]) => Math.abs(la) <= 85 && Math.abs(lo) <= 180)) return null;
  let km = 0;
  for (let k = 1; k < pts.length; k++) km += hav(pts[k - 1], pts[k]);
  return km <= MAX_KM ? pts : null;
}
async function sha(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function traceTile(url: URL, fetcher: typeof fetch = fetch): Promise<Response> {
  const shape = url.searchParams.get("shape");
  if (!stageLine(shape)) return new Response(JSON.stringify({ error: "bad_shape" }), { status: 400, headers: { "content-type": "application/json" } });
  const headers = { "content-type": "application/json", "cache-control": `public, max-age=${KEEP_S}`, "x-content-type-options": "nosniff" };
  const cache = typeof caches !== "undefined" ? (caches as unknown as { default: Cache }).default : null;
  const key = new Request(`https://apexnav.cache/trace/v1/${await sha(shape!)}`);
  try { const hit = cache ? await cache.match(key) : undefined; if (hit) return new Response(hit.body, { headers: { ...headers, "x-cache": "hit" } }); } catch { /* a speed-up only */ }
  let j: { units?: string; edges?: unknown[] } | null = null;
  try {
    const r = await fetcher(VALHALLA, { method: "POST", headers: { "content-type": "application/json", "user-agent": "Vetta route context relay" }, signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ encoded_polyline: shape, costing: "auto", shape_match: "map_snap", filters: { action: "include", attributes: ATTRS } }) });
    if (r.ok) j = await r.json();
  } catch { j = null; }
  if (!j || !Array.isArray(j.edges) || !j.edges.length) return new Response(JSON.stringify({ error: "router_unavailable" }), { status: 502, headers: { "content-type": "application/json" } });
  const body = JSON.stringify({ units: j.units ?? "kilometers", edges: j.edges });
  try { if (cache) await cache.put(key, new Response(body, { headers })); } catch { /* asked again next time */ }
  return new Response(body, { headers: { ...headers, "x-cache": "miss" } });
}
