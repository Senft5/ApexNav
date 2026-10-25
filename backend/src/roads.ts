// Read side of the crowd road data: merged, anonymous per-bin numbers for the roads a phone is about to drive.
// Members only. Nothing here says who contributed; `n` is how many passes were merged, so the phone can show confidence.
import { Env, HttpError } from "./util";

const MAX_WAYS = 50;

export interface RoadBinRow { way_id: number; dir: number; bin_idx: number; n: number; camber_mean: number | null; rough_mean: number | null; crest_peak: number | null }

export async function roadBins(env: Env, url: URL) {
  const ids = (url.searchParams.get("ways") ?? "").split(",").filter(Boolean).map(Number);
  if (!ids.length || ids.length > MAX_WAYS || ids.some((x) => !Number.isSafeInteger(x) || x < 1)) throw new HttpError(400, "bad_ways");
  const marks = ids.map(() => "?").join(",");
  const rows = (await env.DB.prepare(
    `SELECT way_id, dir, bin_idx, n, camber_mean, rough_mean, crest_peak FROM road_bins WHERE way_id IN (${marks}) ORDER BY way_id, dir, bin_idx`,
  ).bind(...ids).all<RoadBinRow>()).results;
  // { [way]: { [dir]: { i:[bin], n:[], cam:[], rough:[], crest:[] } } } keeps the payload small; unknown stays null
  const out: Record<string, Record<string, { i: number[]; n: number[]; cam: (number | null)[]; rough: (number | null)[]; crest: (number | null)[] }>> = {};
  for (const r of rows) {
    const d = ((out[r.way_id] ??= {})[r.dir] ??= { i: [], n: [], cam: [], rough: [], crest: [] });
    d.i.push(r.bin_idx); d.n.push(r.n); d.cam.push(r.camber_mean); d.rough.push(r.rough_mean); d.crest.push(r.crest_peak);
  }
  return out;
}
