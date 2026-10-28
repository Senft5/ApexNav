// Read side of the crowd road data: merged, anonymous per-bin numbers for the roads a phone is about to drive.
// Members only. Nothing here says who contributed; `n` is how many passes were merged and `csd`/`rsd` how much they disagree
// (sample standard deviation of camber and roughness, null under two measuring passes), so the phone can show confidence.
import { Env, HttpError } from "./util";

const MAX_WAYS = 50;

export interface RoadBinRow {
  way_id: number; dir: number; bin_idx: number; n: number; camber_mean: number | null; camber_m2: number | null; camber_n: number;
  rough_mean: number | null; rough_m2: number | null; crest_peak: number | null;
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
    `SELECT way_id, dir, bin_idx, n, camber_mean, camber_m2, camber_n, rough_mean, rough_m2, crest_peak FROM road_bins WHERE way_id IN (${marks}) ORDER BY way_id, dir, bin_idx`,
  ).bind(...ids).all<RoadBinRow>()).results;
  // { [way]: { [dir]: { i:[bin], n:[], cam:[], cn:[], csd:[], rough:[], rsd:[], crest:[] } } } keeps the payload small; unknown stays null
  type Col = (number | null)[];
  const out: Record<string, Record<string, { i: number[]; n: number[]; cam: Col; cn: number[]; csd: Col; rough: Col; rsd: Col; crest: Col }>> = {};
  for (const r of rows) {
    const d = ((out[r.way_id] ??= {})[r.dir] ??= { i: [], n: [], cam: [], cn: [], csd: [], rough: [], rsd: [], crest: [] });
    d.i.push(r.bin_idx); d.n.push(r.n); d.cam.push(r.camber_mean); d.cn.push(r.camber_n); d.csd.push(sampleSd(r.camber_m2, r.camber_n));
    d.rough.push(r.rough_mean); d.rsd.push(sampleSd(r.rough_m2, r.n)); d.crest.push(r.crest_peak);
  }
  return out;
}
