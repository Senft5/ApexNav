// Read side of the crowd road data: merged, anonymous per-bin numbers for the roads a phone is about to drive.
// Members only. Nothing here says who contributed; `n` is how many passes were merged and `csd`/`rsd` how much they disagree
// (sample standard deviation of camber and roughness, null under two measuring passes), so the phone can show confidence.
import { Env, HttpError } from "./util";

const MAX_WAYS = 50;
/**
 * k-anonymity (IDEAS Z-08): a road+direction is shown only once this many different people have driven it, so a road only
 * one person drives (the lane to their house) never shows their drives to anyone. rank_slots holds the first two distinct
 * drivers of each road+direction (contribute.ts), so it counts them without saying who.
 */
export const MIN_DRIVERS = 2;

export interface RoadBinRow {
  way_id: number; dir: number; bin_idx: number; n: number; camber_mean: number | null; camber_m2: number | null; camber_n: number;
  rough_mean: number | null; rough_m2: number | null; crest_peak: number | null; changed_on: string | null;
}

/** Sample standard deviation from a Welford sum of squares over k passes; null when fewer than two passes measured it. */
export function sampleSd(m2: number | null, k: number): number | null {
  if (m2 == null || !Number.isFinite(m2) || k < 2) return null;
  return Math.round(Math.sqrt(Math.max(0, m2) / (k - 1)) * 1e4) / 1e4;
}

export async function roadBins(env: Env, url: URL) {
  const ids = (url.searchParams.get("ways") ?? "").split(",").filter(Boolean).map(Number);
  if (!ids.length || ids.length > MAX_WAYS || ids.some((x) => !Number.isSafeInteger(x) || x < 1)) throw new HttpError(400, "bad_ways");
  const marks = ids.map(() => "?").join(",");
  const rows = (await env.DB.prepare(
    `SELECT way_id, dir, bin_idx, n, camber_mean, camber_m2, camber_n, rough_mean, rough_m2, crest_peak, changed_on FROM road_bins rb
      WHERE way_id IN (${marks}) AND (SELECT COUNT(DISTINCT rs.holder) FROM rank_slots rs WHERE rs.way_id = rb.way_id AND rs.dir = rb.dir) >= ${MIN_DRIVERS}
      ORDER BY way_id, dir, bin_idx`,
  ).bind(...ids).all<RoadBinRow>()).results;
  // { [way]: { [dir]: { i:[bin], n:[], cam:[], cn:[], csd:[], rough:[], rsd:[], crest:[], ch:[] } } } keeps the payload small;
  // unknown stays null. ch: the month a step change (repaving, IDEAS Q-12) restarted the bin, never the day.
  type Col = (number | null)[];
  const out: Record<string, Record<string, { i: number[]; n: number[]; cam: Col; cn: number[]; csd: Col; rough: Col; rsd: Col; crest: Col; ch: (string | null)[] }>> = {};
  for (const r of rows) {
    const d = ((out[r.way_id] ??= {})[r.dir] ??= { i: [], n: [], cam: [], cn: [], csd: [], rough: [], rsd: [], crest: [], ch: [] });
    d.ch.push(r.changed_on ? r.changed_on.slice(0, 7) : null);
    d.i.push(r.bin_idx); d.n.push(r.n); d.cam.push(r.camber_mean); d.cn.push(r.camber_n); d.csd.push(sampleSd(r.camber_m2, r.camber_n));
    d.rough.push(r.rough_mean); d.rsd.push(sampleSd(r.rough_m2, r.n)); d.crest.push(r.crest_peak);
  }
  return out;
}

/**
 * The coverage map (IDEAS Q-14): measured roads in a box (at most 0.5° a side) as their map line, per direction with the most
 * passes on any bin. Only road+directions two or more people have driven (Z-08), so a road one person drives stays blank,
 * the same as a road nobody has driven: blank means "waiting for a pioneer", never "someone drives here".
 */
export async function coverage(env: Env, url: URL) {
  const box = (url.searchParams.get("bbox") ?? "").split(",").map(Number);
  if (box.length !== 4 || box.some((x) => !Number.isFinite(x))) throw new HttpError(400, "bad_bbox");
  const [s, w, n, e] = box;
  if (s < -90 || n > 90 || w < -180 || e > 180 || n <= s || e <= w || n - s > 0.5 || e - w > 0.5) throw new HttpError(400, "bad_bbox");
  const rows = (await env.DB.prepare(
    `SELECT rw.way_id, rw.shape, rb.dir, MAX(rb.n) AS passes FROM road_ways rw JOIN road_bins rb ON rb.way_id = rw.way_id
      WHERE rw.s <= ?3 AND rw.n >= ?1 AND rw.w <= ?4 AND rw.e >= ?2
      GROUP BY rw.way_id, rb.dir
     HAVING (SELECT COUNT(DISTINCT rs.holder) FROM rank_slots rs WHERE rs.way_id = rw.way_id AND rs.dir = rb.dir) >= ${MIN_DRIVERS}
      ORDER BY rw.way_id, rb.dir LIMIT 2000`,
  ).bind(s, w, n, e).all<{ way_id: number; shape: string; dir: number; passes: number }>()).results;
  const ways = new Map<number, { way: number; line: [number, number][]; passes: number[] }>();
  for (const r of rows) {
    const it = ways.get(r.way_id) ?? { way: r.way_id, line: JSON.parse(r.shape), passes: [0, 0] };
    it.passes[r.dir] = r.passes;
    ways.set(r.way_id, it);
  }
  return { ways: [...ways.values()] };
}
