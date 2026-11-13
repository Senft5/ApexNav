// Read side of the crowd road data: merged, anonymous per-bin numbers for the roads a phone is about to drive.
// Members only. Nothing here says who contributed; `n` is how many passes were merged and `csd`/`rsd` how much they disagree
// (sample standard deviation of camber and roughness, null under two measuring passes), so the phone can show confidence.
import { Env, HttpError } from "./util";
import { serverFlag } from "./flags";
import { bumpWeight } from "./contribute";

const MAX_WAYS = 50;
/**
 * k-anonymity (IDEAS Z-08): a road+direction is shown only once this many different people have driven it, so a road only
 * one person drives (the lane to their house) never shows their drives to anyone. road_floor holds the first two distinct
 * established drivers (invited, or a member a week) of each road+direction (contribute.ts, migration 0058), so it counts them
 * without saying who, and a fresh account can't be the second.
 */
export const MIN_DRIVERS = 2;

/**
 * Open roads (owner decision 2026-10-28): a road driven once is still worth showing, at low confidence (the phone weights
 * one pass at 3/4, contributor.js), as long as nobody can learn where a person lives from it. A through road (motorway to
 * tertiary) or a long unclassified road (the rural back roads, OPEN_UNCLASSIFIED_M or more of map line) is shown from its
 * first pass. Everything else, an unknown class included, may be a dead end or the lane to someone's house and keeps the
 * two-driver rule above. Class and length are the public map line's (road_ways), never the drive's.
 */
export const OPEN_CLASSES = ["motorway", "trunk", "primary", "secondary", "tertiary"] as const;
export const OPEN_UNCLASSIFIED_M = 1500;
/** SQL: may road+direction (way, dir) be shown? `way` and `dir` are column expressions of the calling query. */
export const shownSql = (way: string, dir: string) =>
  `(EXISTS (SELECT 1 FROM road_ways ow WHERE ow.way_id = ${way} AND (ow.cls IN (${OPEN_CLASSES.map((c) => `'${c}'`).join(",")})
      OR (ow.cls = 'unclassified' AND ow.len_m >= ${OPEN_UNCLASSIFIED_M})))
    OR (SELECT COUNT(*) FROM road_floor rf WHERE rf.way_id = ${way} AND rf.dir = ${dir}) >= ${MIN_DRIVERS})`;

/** Confidence level for showing, never a count (owner decision 2026-10-28): 0 none, 1 one pass, 2 two to four, 3 five or more. */
export const confLevel = (passes: number) => (passes >= 5 ? 3 : passes >= 2 ? 2 : passes >= 1 ? 1 : 0);

export interface RoadBinRow {
  way_id: number; dir: number; bin_idx: number; n: number; camber_mean: number | null; camber_m2: number | null; camber_n: number;
  rough_mean: number | null; rough_m2: number | null; crest_peak: number | null; changed_on: string | null; k_mean: number | null; k_n: number;
  flow_mean: number | null; brake_mean: number | null; flow_n: number; bump_hit: number; bump_pass: number; bump_drivers: number;
}

/**
 * Crowd-verified bumps (IDEAS Q-02, docs/ROAD_INTELLIGENCE.md 4.3: on our own data 1 of 7 single-pass bumps repeats, so one
 * hit proves nothing). Two passes over the same bump land a bin or two apart (GPS), so a bump is read over WINDOW bins each
 * side: hits are the window's decayed hits, passes the most decayed passes over any bin in it, misses the rest. Presence is
 * Beta(PRIOR + hits, PRIOR + misses) (Jeffreys); a bump is verified when its posterior mean is over MIN_P and at least
 * MIN_DRIVERS different people hit it. One per window, at the bin with the most hits. Weights are divided by today's
 * (contribute.ts bumpWeight), so a pass one half-life old counts half.
 */
/** A crest (ROAD_INTELLIGENCE 3.2): a bin whose peak unweighting is this many g or more. */
export const CREST_G = 0.15;
export const VERIFY = { window: 2, prior: 0.5, minP: 0.8, minDrivers: 2 };
export function verifiedBumps(rows: { bin_idx: number; bump_hit: number; bump_pass: number; bump_drivers: number }[], today = new Date().toISOString().slice(0, 10)): [number, number][] {
  const now = bumpWeight(today), at = new Map(rows.map((r) => [r.bin_idx, r])), out: [number, number][] = [];
  const W = VERIFY.window, A = VERIFY.prior;
  for (const r of rows) {
    if (!(r.bump_hit > 0)) continue;
    let hits = 0, passes = 0, drivers = 0, peak = true;
    for (let j = r.bin_idx - W; j <= r.bin_idx + W; j++) {
      const q = at.get(j); if (!q) continue;
      hits += q.bump_hit; passes = Math.max(passes, q.bump_pass); drivers += q.bump_drivers;
      if (q.bump_hit > r.bump_hit || (q.bump_hit === r.bump_hit && j < r.bin_idx)) peak = false;   // one per window: the most hits, then the first
    }
    if (!peak || drivers < VERIFY.minDrivers) continue;
    const h = hits / now, m = Math.max(0, passes - hits) / now, p = (A + h) / (2 * A + h + m);
    if (p > VERIFY.minP) out.push([r.bin_idx, Math.round(p * 100) / 100]);
  }
  return out;
}

/** Busy times are shown only for a road+direction this many different people drove (the owner's Quiet hours option a). */
export const HOURS_MIN_DRIVERS = 5;
/** Loved roads: how many members came back to it, as a level (never the count): 0 under 2, 1 two, 2 three or four, 3 five or more. */
export const loveLevel = (again: number) => (again >= 5 ? 3 : again >= 3 ? 2 : again >= 2 ? 1 : 0);

/** Sample standard deviation from a Welford sum of squares over k passes; null when fewer than two passes measured it. */
export function sampleSd(m2: number | null, k: number): number | null {
  if (m2 == null || !Number.isFinite(m2) || k < 2) return null;
  return Math.round(Math.sqrt(Math.max(0, m2) / (k - 1)) * 1e4) / 1e4;
}

/** 0.1-degree cells ("i_j": floor(lat / 0.1), floor(lon / 0.1)) a cells query may name, at most (VI-1: no finer than 0.1°). */
export const CELL_DEG = 0.1, MAX_CELLS = 16, MAX_CELL_WAYS = 300;
/**
 * GET /api/roads?cells=i_j,...: the measured ways in those 0.1° cells, for the route engine's crowd provider. The phone says
 * which ~11 km cells a plan crosses, never its route or way ids (VI-1); answer { ways: <as ?ways=>, lines: { way: [[lat, lon]] } }
 * with each way's public map line (road_ways) so the phone places the bins itself. Same open-road / two-driver rule.
 */
export async function roadCells(env: Env, url: URL) {
  const cells = (url.searchParams.get("cells") ?? "").split(",").filter(Boolean);
  if (!cells.length || cells.length > MAX_CELLS || cells.some((c) => !/^-?\d{1,4}_-?\d{1,4}$/.test(c))) throw new HttpError(400, "bad_cells");
  const ids = new Set<number>();
  const lines: Record<string, unknown> = {};
  for (const c of cells) {
    const [i, j] = c.split("_").map(Number), s = i * CELL_DEG, w = j * CELL_DEG, n = s + CELL_DEG, e = w + CELL_DEG;
    if (s < -90 || n > 90 || w < -180 || e > 180) throw new HttpError(400, "bad_cells");
    const rows = (await env.DB.prepare(
      `SELECT way_id, shape FROM road_ways WHERE s <= ?3 AND n >= ?1 AND w <= ?4 AND e >= ?2 LIMIT ${MAX_CELL_WAYS}`,
    ).bind(s, w, n, e).all<{ way_id: number; shape: string }>()).results;
    for (const r of rows) { if (ids.size >= MAX_CELL_WAYS) break; ids.add(r.way_id); lines[r.way_id] = JSON.parse(r.shape); }
  }
  const ways = ids.size ? await binsFor(env, [...ids]) : {};
  // only the lines of ways that are shown (a way with no shown direction says nothing, its line included)
  for (const k of Object.keys(lines)) if (!(k in ways)) delete lines[k];
  return { ways, lines };
}

export async function roadBins(env: Env, url: URL) {
  if (url.searchParams.has("cells")) return roadCells(env, url);
  const ids = (url.searchParams.get("ways") ?? "").split(",").filter(Boolean).map(Number);
  if (!ids.length || ids.length > MAX_WAYS || ids.some((x) => !Number.isSafeInteger(x) || x < 1)) throw new HttpError(400, "bad_ways");
  return binsFor(env, ids);
}

async function binsFor(env: Env, ids: number[]) {
  const out = {} as Record<string, Record<string, Dir>>;
  for (let k = 0; k < ids.length; k += MAX_WAYS) Object.assign(out, await binsChunk(env, ids.slice(k, k + MAX_WAYS)));
  return out;
}

type Col = (number | null)[];
type Dir = { i: number[]; n: number[]; cam: Col; cn: number[]; csd: Col; rough: Col; rsd: Col; crest: Col; ch: (string | null)[]; k: Col; kn: number[];
             fl: Col; hb: Col; fn: number[]; ag?: number; hr?: number[]; bp?: [number, number][] };
async function binsChunk(env: Env, ids: number[]) {
  // the open-road / two-driver rule is checked once per way and direction (p, s), not once per bin: per bin it read
  // about 3.5 rows for every bin sent (D1 Free allows 5 million rows read a day), now about one
  // no ORDER BY (the sort read every row a second time): the pairs go in way order and each direction's bins come off the
  // primary key in bin order, so rows arrive in order; checked below, and sorted only if they ever don't
  ids = [...ids].sort((a, b) => a - b);
  const pairs = ids.map((_, k) => `(?${k + 1}, 0), (?${k + 1}, 1)`).join(", ");
  const rows = (await env.DB.prepare(
    `WITH p(way_id, dir) AS (VALUES ${pairs}), s AS (SELECT p.way_id, p.dir FROM p WHERE ${shownSql("p.way_id", "p.dir")})
     SELECT rb.way_id, rb.dir, rb.bin_idx, rb.n, rb.camber_mean, rb.camber_m2, rb.camber_n, rb.rough_mean, rb.rough_m2, rb.crest_peak, rb.changed_on, rb.k_mean, rb.k_n,
            rb.flow_mean, rb.brake_mean, rb.flow_n, rb.bump_hit, rb.bump_pass, rb.bump_drivers
       FROM s JOIN road_bins rb ON rb.way_id = s.way_id AND rb.dir = s.dir`,
  ).bind(...ids).all<RoadBinRow>()).results;
  const before = (a: RoadBinRow, b: RoadBinRow) => a.way_id - b.way_id || a.dir - b.dir || a.bin_idx - b.bin_idx;
  for (let k = 1; k < rows.length; k++) if (before(rows[k - 1], rows[k]) > 0) { rows.sort(before); break; }
  // { [way]: { [dir]: { i:[bin], n:[], cam:[], cn:[], csd:[], rough:[], rsd:[], crest:[], ch:[] } } } keeps the payload small;
  // unknown stays null. ch: the month a step change (repaving, IDEAS Q-12) restarted the bin, never the day. k / kn: the
  // driven paths' mean curvature (1/m, + = left in the direction of travel) and how many passes measured it (IDEAS Q-04).
  // fl / hb / fn: flow (members' mean speed steadiness 0..1, a ratio with no speed in it), the share of passes that braked hard
  // with no corner ahead, and how many passes sent flow; null / 0 from passes that didn't. ag (per direction): loveLevel, how
  // many members came back to it. hr (per direction, only with the quiet_hours flag on and 5+ drivers): 12 shares of passes.
  // bp (per direction, only when there are any): crowd-verified bumps as [bin, posterior] (verifiedBumps), never a count.
  const out: Record<string, Record<string, Dir>> = {};
  const r3 = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 1000);
  for (const r of rows) {
    const d = ((out[r.way_id] ??= {})[r.dir] ??= { i: [], n: [], cam: [], cn: [], csd: [], rough: [], rsd: [], crest: [], ch: [], k: [], kn: [], fl: [], hb: [], fn: [] });
    d.fl.push(r.flow_n > 0 ? r3(r.flow_mean) : null); d.hb.push(r.flow_n > 0 ? r3(r.brake_mean) : null); d.fn.push(r.flow_n ?? 0);
    d.k.push(r.k_n > 0 && r.k_mean != null ? Math.round(r.k_mean * 1e6) / 1e6 : null); d.kn.push(r.k_n);
    d.ch.push(r.changed_on ? r.changed_on.slice(0, 7) : null);
    d.i.push(r.bin_idx); d.n.push(r.n); d.cam.push(r.camber_mean); d.cn.push(r.camber_n); d.csd.push(sampleSd(r.camber_m2, r.camber_n));
    d.rough.push(r.rough_mean); d.rsd.push(sampleSd(r.rough_m2, r.n)); d.crest.push(r.crest_peak);
  }
  const byDir = new Map<string, RoadBinRow[]>();
  for (const r of rows) if (r.bump_hit > 0 || r.bump_pass > 0) { const k = `${r.way_id}:${r.dir}`; (byDir.get(k) ?? byDir.set(k, []).get(k)!).push(r); }
  for (const [k, rs] of byDir) { const [w, dir] = k.split(":"), bp = verifiedBumps(rs); if (bp.length) out[w][dir].bp = bp; }
  const shownIds = Object.keys(out).map(Number);
  if (shownIds.length) {
    const m2 = shownIds.map(() => "?").join(",");
    const love = (await env.DB.prepare(`SELECT way_id, dir, again_n FROM road_love WHERE way_id IN (${m2})`).bind(...shownIds).all<{ way_id: number; dir: number; again_n: number }>()).results;
    for (const l of love) { const d = out[l.way_id]?.[l.dir]; if (d && loveLevel(l.again_n)) d.ag = loveLevel(l.again_n); }
    if (serverFlag(env, "quiet_hours")) {
      const hours = (await env.DB.prepare(
        `SELECT h.way_id, h.dir, h.bucket, h.n FROM road_hours h
          WHERE h.way_id IN (${m2}) AND (SELECT COUNT(*) FROM road_hour_holders x WHERE x.way_id = h.way_id AND x.dir = h.dir) >= ${HOURS_MIN_DRIVERS}`,
      ).bind(...shownIds).all<{ way_id: number; dir: number; bucket: number; n: number }>()).results;
      const counts = new Map<string, number[]>();
      for (const h of hours) { const k = `${h.way_id}:${h.dir}`; const a = counts.get(k) ?? new Array(12).fill(0); a[h.bucket] += h.n; counts.set(k, a); }
      for (const [k, a] of counts) {
        const [w, dir] = k.split(":"), d = out[w]?.[dir], tot = a.reduce((x, y) => x + y, 0);
        if (d && tot > 0) d.hr = a.map((x) => Math.round((x / tot) * 1000) / 1000);
      }
    }
  }
  return out;
}

/**
 * The coverage map (IDEAS Q-14): measured roads in a box (at most 0.5° a side) as their map line, per direction a confidence
 * level from the most passes on any bin (confLevel: never the count itself). Open roads show from their first pass; any other
 * road only once two or more people have driven it (Z-08), so a lane one person drives stays blank, the same as a road nobody
 * has driven: blank means "waiting for a pioneer", never "someone drives here".
 */
export async function coverage(env: Env, url: URL) {
  const box = (url.searchParams.get("bbox") ?? "").split(",").map(Number);
  if (box.length !== 4 || box.some((x) => !Number.isFinite(x))) throw new HttpError(400, "bad_bbox");
  const [s, w, n, e] = box;
  if (s < -90 || n > 90 || w < -180 || e > 180 || n <= s || e <= w || n - s > 0.5 || e - w > 0.5) throw new HttpError(400, "bad_bbox");
  const rows = (await env.DB.prepare(
    // per direction also what it measured (IDEAS R-04, stage discovery): mean roughness (g, pass-weighted) and the share of
    // camber-measured bins banked into the turn (>= 3 deg) or off-camber (<= -3 deg); null when nothing was measured
    `SELECT rw.way_id, rw.shape, rb.dir, MAX(rb.n) AS passes,
            SUM(rb.rough_mean * rb.n) / NULLIF(SUM(CASE WHEN rb.rough_mean IS NOT NULL THEN rb.n END), 0) AS rough,
            1.0 * SUM(CASE WHEN rb.camber_n > 0 AND rb.camber_mean >= 3 THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN rb.camber_n > 0 THEN 1 ELSE 0 END), 0) AS banked,
            1.0 * SUM(CASE WHEN rb.camber_n > 0 AND rb.camber_mean <= -3 THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN rb.camber_n > 0 THEN 1 ELSE 0 END), 0) AS off_camber,
            -- crests (R-04): the share of bins two or more passes measured that go light by CREST_G or more
            1.0 * SUM(CASE WHEN rb.crest_n >= 2 AND rb.crest_peak >= ${CREST_G} THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN rb.crest_n >= 2 AND rb.crest_peak IS NOT NULL THEN 1 ELSE 0 END), 0) AS crested
       FROM road_ways rw JOIN road_bins rb ON rb.way_id = rw.way_id
      WHERE rw.s <= ?3 AND rw.n >= ?1 AND rw.w <= ?4 AND rw.e >= ?2
      GROUP BY rw.way_id, rb.dir
     HAVING ${shownSql("rw.way_id", "rb.dir")}
      ORDER BY rw.way_id, rb.dir LIMIT 2000`,
  ).bind(s, w, n, e).all<{ way_id: number; shape: string; dir: number; passes: number; rough: number | null; banked: number | null; off_camber: number | null; crested: number | null }>()).results;
  // crowd-verified bumps per direction (verifiedBumps, the rule /api/roads uses), only on the ways shown above
  const shown = new Set(rows.map((r) => `${r.way_id}:${r.dir}`)), bumpRows = new Map<string, { bin_idx: number; bump_hit: number; bump_pass: number; bump_drivers: number }[]>();
  if (shown.size) {
    const br = (await env.DB.prepare(
      `SELECT rb.way_id, rb.dir, rb.bin_idx, rb.bump_hit, rb.bump_pass, rb.bump_drivers
         FROM road_ways rw JOIN road_bins rb ON rb.way_id = rw.way_id
        WHERE rw.s <= ?3 AND rw.n >= ?1 AND rw.w <= ?4 AND rw.e >= ?2 AND rb.bump_pass > 0
        ORDER BY rb.way_id, rb.dir, rb.bin_idx LIMIT 20000`,
    ).bind(s, w, n, e).all<{ way_id: number; dir: number; bin_idx: number; bump_hit: number; bump_pass: number; bump_drivers: number }>()).results;
    for (const r of br) { const k = `${r.way_id}:${r.dir}`; if (!shown.has(k)) continue; const a = bumpRows.get(k) ?? []; a.push(r); bumpRows.set(k, a); }
  }
  type Item = { way: number; line: [number, number][]; conf: number[]; rough: (number | null)[]; banked: (number | null)[]; offCamber: (number | null)[]; crested: (number | null)[]; bumps: number[] };
  const ways = new Map<number, Item>();
  const r3 = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 1000);
  for (const r of rows) {
    const it = ways.get(r.way_id) ?? { way: r.way_id, line: JSON.parse(r.shape), conf: [0, 0], rough: [null, null], banked: [null, null], offCamber: [null, null], crested: [null, null], bumps: [0, 0] };
    it.conf[r.dir] = confLevel(r.passes);
    it.rough[r.dir] = r3(r.rough); it.banked[r.dir] = r3(r.banked); it.offCamber[r.dir] = r3(r.off_camber); it.crested[r.dir] = r3(r.crested);
    it.bumps[r.dir] = verifiedBumps(bumpRows.get(`${r.way_id}:${r.dir}`) ?? []).length;
    ways.set(r.way_id, it);
  }
  return { ways: [...ways.values()] };
}

/** The road-data method these numbers come from (docs/ROAD_DATA.md); bumped when measuring or merging changes meaning. */
export const METHOD_VERSION = "2026-10";

/**
 * Owner-only export (docs/ROAD_DATA.md, the road-data framework; nothing is sold): an area's measured roads as GeoJSON, one
 * feature per road+direction on its public map line, under the same open-road / two-driver rule as everything else. Only
 * facts about the road: its class, a confidence from how many passes measured it (0..1, 1 - 1/(1 + passes), never the count),
 * mean roughness, banked and off-camber shares, and the month it was last measured. No person, day, drive or holder.
 */
export async function exportRoads(env: Env, url: URL) {
  const box = (url.searchParams.get("bbox") ?? "").split(",").map(Number);
  if (box.length !== 4 || box.some((x) => !Number.isFinite(x))) throw new HttpError(400, "bad_bbox");
  const [s, w, n, e] = box;
  if (s < -90 || n > 90 || w < -180 || e > 180 || n <= s || e <= w || n - s > 2 || e - w > 2) throw new HttpError(400, "bad_bbox");
  const rows = (await env.DB.prepare(
    `SELECT rw.way_id, rw.shape, rw.cls, rb.dir, MAX(rb.n) AS passes, MAX(rb.last_on) AS last_on,
            SUM(rb.rough_mean * rb.n) / NULLIF(SUM(CASE WHEN rb.rough_mean IS NOT NULL THEN rb.n END), 0) AS rough,
            1.0 * SUM(CASE WHEN rb.camber_n > 0 AND rb.camber_mean >= 3 THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN rb.camber_n > 0 THEN 1 ELSE 0 END), 0) AS banked,
            1.0 * SUM(CASE WHEN rb.camber_n > 0 AND rb.camber_mean <= -3 THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN rb.camber_n > 0 THEN 1 ELSE 0 END), 0) AS off_camber
       FROM road_ways rw JOIN road_bins rb ON rb.way_id = rw.way_id
      WHERE rw.s <= ?3 AND rw.n >= ?1 AND rw.w <= ?4 AND rw.e >= ?2
      GROUP BY rw.way_id, rb.dir
     HAVING ${shownSql("rw.way_id", "rb.dir")}
      ORDER BY rw.way_id, rb.dir LIMIT 20000`,
  ).bind(s, w, n, e).all<{ way_id: number; shape: string; cls: string | null; dir: number; passes: number; last_on: string | null; rough: number | null; banked: number | null; off_camber: number | null }>()).results;
  const r3 = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 1000);
  return {
    type: "FeatureCollection",
    method_version: METHOD_VERSION,
    features: rows.map((r) => {
      const line = (JSON.parse(r.shape) as [number, number][]).map(([lat, lon]) => [lon, lat]);
      return {
        type: "Feature",
        geometry: { type: "LineString", coordinates: r.dir === 1 ? line.reverse() : line },   // drawn in the direction measured
        properties: { way: r.way_id, dir: r.dir, cls: r.cls, confidence: r3(1 - 1 / (1 + r.passes)), rough_g: r3(r.rough),
                      banked: r3(r.banked), off_camber: r3(r.off_camber), last_month: r.last_on ? r.last_on.slice(0, 7) : null,
                      method_version: METHOD_VERSION },
      };
    }),
  };
}
