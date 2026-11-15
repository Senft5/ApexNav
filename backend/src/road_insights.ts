// Road insights API (docs/ROAD_INSIGHTS.md; the viewer is web/insights.html on data.vettadrive.com). Aggregate facts about road
// sections only, never a drive, path, time, person or holder, under stricter rules than the members' app shows:
//  - through roads only (motorway to tertiary, and unclassified roads of OPEN_UNCLASSIFIED_M or more), never a lane;
//  - at least DATA_K distinct established drivers on that road and direction (road_floor, which now keeps up to FLOOR_CAP
//    hmac holders, never an id: contribute.ts);
//  - month granularity; values noised (Laplace, seeded per road, metric, month and the road's pass total, so asking again
//    returns the same draw and can't average it away, and a new pass brings a fresh draw rather than an exact difference),
//    with the noise scale from the driver count, so a thin road's figures hide any one person.
// Nothing is sold and no partner gets real data until the owner opens it (docs/ROAD_INSIGHTS.md §4: the sold-data opt-in
// and policy text first). Who may read real data:
//  - an internal key (its sha256 in DATA_OWNER_KEYS): the owner's own analysis, always;
//  - a partner key (its sha256 in DATA_API_KEYS): only while the server flag `road_data_partners` is on (off by default).
// Anyone else gets the public meta and the made-up sample (web/insights-sample.geojson), which says it is made up.
import { serverFlag } from "./flags";
import { FLOOR_CAP, OPEN_CLASSES, OPEN_UNCLASSIFIED_M, METHOD_VERSION, shownSql } from "./roads";
export { FLOOR_CAP };
import { Env, HttpError, sha256hex } from "./util";

/** Distinct established drivers a road+direction needs before any figure about it is released. */
export const DATA_K = 10;
/** Privacy budget per metric per month (Laplace scale = range / (EPSILON * drivers)). */
export const EPSILON = 1;
/** Largest box side for one request, degrees. */
export const MAX_SIDE = 1;
/** Clipping ranges: a value is clamped into these before the mean and noise, which bounds one person's effect. */
export const RANGE = { rough_g: 0.3, banked: 1, off_camber: 1, crests_per_km: 10, flow: 1, hard_brake: 1 } as const;
export type Metric = keyof typeof RANGE;

export type Access = "internal" | "partner";

/** Which access a request's key gives, or throws 401/403. A key is `vk_` + 32 or more url-safe characters. */
export async function keyAccess(req: Request, env: Env): Promise<Access> {
  const auth = req.headers.get("authorization") ?? "";
  const key = /^Bearer (vk_[A-Za-z0-9_-]{32,128})$/.exec(auth)?.[1] ?? req.headers.get("x-api-key") ?? "";
  if (!/^vk_[A-Za-z0-9_-]{32,128}$/.test(key)) throw new HttpError(401, "api_key_required");
  const h = await sha256hex(key);
  const list = (s?: string) => (s ?? "").split(",").map((x) => x.trim().toLowerCase()).filter((x) => /^[0-9a-f]{64}$/.test(x));
  if (list(env.DATA_OWNER_KEYS).includes(h)) return "internal";
  if (list(env.DATA_API_KEYS).includes(h)) {
    if (!serverFlag(env, "road_data_partners")) throw new HttpError(403, "partner_access_not_open");
    return "partner";
  }
  throw new HttpError(401, "api_key_unknown");
}

/** SQL: a through road (the class of its public map line), never a lane, a residential street or an unknown class. */
const throughSql = (way: string) =>
  `EXISTS (SELECT 1 FROM road_ways tw WHERE tw.way_id = ${way} AND (tw.cls IN (${OPEN_CLASSES.map((c) => `'${c}'`).join(",")})
     OR (tw.cls = 'unclassified' AND tw.len_m >= ${OPEN_UNCLASSIFIED_M})))`;

/** A uniform number in (0, 1) from a string: the noise is the same each time the same figure is asked for. */
async function unit(seed: string): Promise<number> {
  const h = await sha256hex(seed);
  return (parseInt(h.slice(0, 13), 16) + 0.5) / 2 ** 52;
}

/** Laplace noise of scale b, from a seed. */
export async function laplace(seed: string, b: number): Promise<number> {
  const u = (await unit(seed)) - 0.5;
  return -b * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}

/** A released figure: clamped, noised, clamped again into its range, two decimals (three for roughness). Null stays null. */
export async function release(v: number | null, metric: Metric, drivers: number, seed: string): Promise<number | null> {
  if (v == null || !Number.isFinite(v)) return null;
  const hi = RANGE[metric], d = Math.max(drivers, DATA_K);
  const noisy = Math.min(hi, Math.max(0, v)) + (await laplace(`${seed}|${metric}`, hi / (EPSILON * d)));
  const dp = metric === "rough_g" ? 1000 : 100;
  return Math.round(Math.min(hi, Math.max(0, noisy)) * dp) / dp;
}

/** Confidence as a band from the driver count, never the count: 10 to 19 "fair", 20 to 49 "good", 50 or more "high". */
/** "low" (under DATA_K) only ever appears in the internal app-floor view below. */
export const band = (drivers: number) => (drivers >= FLOOR_CAP ? "high" : drivers >= 20 ? "good" : drivers >= DATA_K ? "fair" : "low");

export function parseBox(url: URL): [number, number, number, number] {
  const box = (url.searchParams.get("bbox") ?? "").split(",").map(Number);
  if (box.length !== 4 || box.some((x) => !Number.isFinite(x))) throw new HttpError(400, "bad_bbox");
  const [s, w, n, e] = box;
  if (s < -90 || n > 90 || w < -180 || e > 180 || n <= s || e <= w || n - s > MAX_SIDE || e - w > MAX_SIDE) throw new HttpError(400, "bad_bbox");
  return [s, w, n, e];
}

interface Row {
  way_id: number; shape: string; cls: string | null; dir: number; drivers: number; passes: number; last_on: string | null; km: number;
  rough: number | null; banked: number | null; off_camber: number | null; crests: number; flow: number | null; brake: number | null;
}

/**
 * GET /api/data/v1/roads.geojson?bbox=s,w,n,e: one feature per released road+direction on its public map line.
 * `&floor=app` (an internal key only; ignored for a partner): the owner's review view, under the members' app rule instead of
 * the ten-driver floor (roads.ts shownSql: through roads from their first pass, anything else once two drivers have), so he
 * can see what the product will look like before roads reach ten drivers. Nothing more than members already see in the app.
 */
export async function insightRoads(env: Env, url: URL, access: Access) {
  const [s, w, n, e] = parseBox(url);
  const appFloor = access === "internal" && url.searchParams.get("floor") === "app";
  const where = appFloor ? "" : ` AND ${throughSql("rw.way_id")}`;
  const having = appFloor ? shownSql("rw.way_id", "rb.dir") : `drivers >= ${DATA_K}`;
  const rows = (await env.DB.prepare(
    `SELECT rw.way_id, rw.shape, rw.cls, rb.dir, MAX(rb.last_on) AS last_on, COUNT(*) * 0.005 AS km, SUM(rb.n) AS passes,
            (SELECT COUNT(*) FROM road_floor rf WHERE rf.way_id = rw.way_id AND rf.dir = rb.dir) AS drivers,
            AVG(MIN(rb.rough_mean, ${RANGE.rough_g})) AS rough,
            1.0 * SUM(CASE WHEN rb.camber_n > 0 AND rb.camber_mean >= 3 THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN rb.camber_n > 0 THEN 1 ELSE 0 END), 0) AS banked,
            1.0 * SUM(CASE WHEN rb.camber_n > 0 AND rb.camber_mean <= -3 THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN rb.camber_n > 0 THEN 1 ELSE 0 END), 0) AS off_camber,
            SUM(CASE WHEN rb.crest_peak >= 0.15 THEN 1 ELSE 0 END) AS crests,
            AVG(CASE WHEN rb.flow_n > 0 THEN rb.flow_mean END) AS flow,
            AVG(CASE WHEN rb.flow_n > 0 THEN rb.brake_mean END) AS brake
       FROM road_ways rw JOIN road_bins rb ON rb.way_id = rw.way_id
      WHERE rw.s <= ?3 AND rw.n >= ?1 AND rw.w <= ?4 AND rw.e >= ?2${where}
      GROUP BY rw.way_id, rb.dir
     HAVING ${having}
      ORDER BY rw.way_id, rb.dir LIMIT 5000`,
  ).bind(s, w, n, e).all<Row>()).results;
  const features = [];
  for (const r of rows) {
    const month = r.last_on ? r.last_on.slice(0, 7) : null, seed = `${env.PEPPER ?? ""}|${r.way_id}|${r.dir}|${month}|${r.passes}`;
    const line = (JSON.parse(r.shape) as [number, number][]).map(([lat, lon]) => [lon, lat]);
    const rel = (v: number | null, m: Metric) => release(v, m, r.drivers, seed);
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: r.dir === 1 ? line.reverse() : line },
      properties: {
        way: r.way_id, dir: r.dir, cls: r.cls, confidence: band(r.drivers), last_month: month,
        rough_g: await rel(r.rough, "rough_g"), banked: await rel(r.banked, "banked"), off_camber: await rel(r.off_camber, "off_camber"),
        crests_per_km: await rel(r.km > 0 ? r.crests / r.km : null, "crests_per_km"),
        flow: await rel(r.flow, "flow"), hard_brake: await rel(r.brake, "hard_brake"),
      },
    });
  }
  return { type: "FeatureCollection", sample: false, access, floor: appFloor ? "app" : "k", method_version: METHOD_VERSION, k: DATA_K, epsilon: EPSILON,
           attribution: "Road lines © OpenStreetMap contributors (ODbL). Measurements © Vetta.", features };
}

/** GET /api/data/v1/meta: public, what the API is and what each field means. */
export const meta = () => ({
  name: "Vetta road insights", version: "v1", method_version: METHOD_VERSION,
  status: "Private preview: real data needs an API key; partners are not open yet. The sample is made up.",
  rules: { min_drivers: DATA_K, roads: "through roads only (motorway to tertiary, long unclassified)", time: "month", noise: `Laplace, epsilon ${EPSILON} per metric per month` },
  endpoints: {
    "GET /api/data/v1/roads.geojson?bbox=s,w,n,e": `real data; Authorization: Bearer vk_... ; box at most ${MAX_SIDE} degree a side`,
    "GET /insights-sample.geojson": "made-up values on real public road lines, the same fields, to try the format",
  },
  fields: {
    way: "OpenStreetMap way id", dir: "0 along the way's node order, 1 against", cls: "road class of the public map line",
    confidence: "fair (10 to 19 drivers), good (20 to 49), high (50 or more)", last_month: "YYYY-MM it was last measured",
    rough_g: "roughness, vertical g rms (not yet calibrated to IRI)", banked: "share of sections banked into the turn (3 degrees or more)",
    off_camber: "share of sections banked away from the turn", crests_per_km: "crests that unweight the car (0.15 g or more) per km",
    flow: "how evenly members drive it, 0 stop-start to 1 even", hard_brake: "how often members brake hard here with no corner ahead, 0 to 1",
  },
});
