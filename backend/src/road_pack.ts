// One road bin's merge, in TypeScript: step 1 of packing road data (2026-11-15, launch scale). Road-data uploads write
// about 210 D1 rows per km (one per 5 m bin), and Workers Paid includes 50 M rows written a month, so a couple of thousand
// active drivers would use up a month in its first week. Packing a way's bins into a few rows per km needs the merge done
// in the Worker instead of in SQL; this is that merge, kept identical to contribute.ts mergeBin (the SQL one) by
// test/road_pack.test.ts, which runs both on the same passes.
import { FRESH, bumpWeight, type Bin } from "./contribute";

/** Bins per road_chunks row (migration 0068): 640 m of one way and direction. */
export const ROAD_CHUNK = 128;
type Packed = Record<string, unknown[]>;
/** A bin as stored in its chunk's JSON: the BIN_COLUMNS values in order. */
export const packRow = (r: BinRow): unknown[] => BIN_COLUMNS.map((c) => r[c]);
export const unpackRow = (a: unknown[]): BinRow => Object.fromEntries(BIN_COLUMNS.map((c, k) => [c, a[k] ?? (NOT_NULL.has(c) ? 0 : null)])) as unknown as BinRow;
const NOT_NULL: ReadonlySet<string> = new Set(["n", "camber_n", "crest_n", "smooth_run", "k_n", "flow_n", "bump_hit", "bump_pass", "bump_drivers"]);
/** A chunk's JSON with its bins in index order (JavaScript keeps integer keys ascending). */
export const chunkJson = (p: Packed): string => JSON.stringify(Object.fromEntries(Object.keys(p).map(Number).sort((a, b) => a - b).map((k) => [String(k), p[k]])));
export type { Packed };

/** A road_bins row, the columns the merge reads and writes (way, direction and index are the key, not stored here). */
export interface BinRow {
  n: number;
  camber_mean: number | null; camber_m2: number | null; camber_n: number;
  rough_mean: number | null; rough_m2: number | null;
  crest_peak: number | null; crest_n: number;
  last_on: string | null; changed_on: string | null; smooth_run: number;
  k_mean: number | null; k_n: number;
  flow_mean: number | null; brake_mean: number | null; flow_n: number;
  bump_hit: number; bump_pass: number; bump_drivers: number;
}

export const BIN_COLUMNS = ["n", "camber_mean", "camber_m2", "camber_n", "rough_mean", "rough_m2", "crest_peak", "crest_n", "last_on", "changed_on",
  "smooth_run", "k_mean", "k_n", "flow_mean", "brake_mean", "flow_n", "bump_hit", "bump_pass", "bump_drivers"] as const;

// SQL arithmetic: anything with a NULL in it is NULL
type N = number | null;
const add = (a: N, b: N): N => (a === null || b === null ? null : a + b);
const sub = (a: N, b: N): N => (a === null || b === null ? null : a - b);
const mul = (a: N, b: N): N => (a === null || b === null ? null : a * b);
const div = (a: N, b: N): N => (a === null || b === null || b === 0 ? null : a / b);
const lt = (a: N, b: N): boolean => a !== null && b !== null && a < b;
const gt = (a: N, b: N): boolean => a !== null && b !== null && a > b;

/** contribute.ts meanSql: running mean, and Welford's sum of squares capped at FRESH.memory passes. */
function meanM2(mean: N, m2: N, k: number, x: N): { mean: N; m2: N } {
  const K = Math.min(k, FRESH.memory), a = 1.0 / (FRESH.memory + 1);
  const next = add(mean, div(sub(x, mean), K + 1));
  const d = sub(x, mean);
  return {
    mean: next,
    m2: k < FRESH.memory ? add(m2 ?? 0, mul(d, sub(x, next))) : mul(k * (1 - a), add(div(m2 ?? 0, k - 1), mul(a, mul(d, d)))),
  };
}
/** The capped running mean the SQL uses for crest, curvature, flow and braking. */
const capped = (old: N, n: number, x: N): N => add(old, div(sub(x, old), Math.min(n, FRESH.memory) + 1));

/** One pass `b` on `day` merged into the bin's row (null: the bin is new), as contribute.ts mergeBin does in SQL. */
export function mergeBinRow(o: BinRow | null, b: Bin, day: string): BinRow {
  const w = bumpWeight(day), hb: N = b.fl === null ? null : (b.hb ?? 0);
  if (!o) {
    return {
      n: 1,
      camber_mean: b.cam, camber_m2: b.cam === null ? null : 0, camber_n: b.cam === null ? 0 : 1,
      rough_mean: b.rough, rough_m2: 0,
      crest_peak: b.crest, crest_n: b.crest === null ? 0 : 1,
      last_on: day, changed_on: null, smooth_run: 0,
      k_mean: b.k, k_n: b.k === null ? 0 : 1,
      flow_mean: b.fl, brake_mean: b.fl === null ? null : hb, flow_n: b.fl === null ? 0 : 1,
      bump_hit: b.bp === null ? 0 : b.bp * w, bump_pass: b.bp === null ? 0 : w, bump_drivers: 0,
    };
  }
  const smoother = o.n >= 3 && o.rough_mean !== null && lt(b.rough, mul(o.rough_mean, FRESH.repaveRatio)) && gt(sub(o.rough_mean, b.rough), FRESH.repaveG);
  const reset = smoother && o.smooth_run + 1 >= FRESH.repavePasses;
  const cam = meanM2(o.camber_mean, o.camber_m2, o.camber_n, b.cam), rough = meanM2(o.rough_mean, o.rough_m2, o.n, b.rough);
  const fresh = o.camber_n === 0 || o.camber_mean === null;
  return {
    camber_mean: reset ? b.cam : b.cam === null ? o.camber_mean : fresh ? b.cam : cam.mean,
    camber_m2: reset ? (b.cam === null ? null : 0) : b.cam === null ? o.camber_m2 : fresh ? 0 : cam.m2,
    camber_n: reset ? Number(b.cam !== null) : o.camber_n + Number(b.cam !== null),
    rough_mean: reset ? b.rough : rough.mean,
    rough_m2: reset ? 0 : rough.m2,
    crest_peak: reset ? b.crest : b.crest === null ? o.crest_peak : o.crest_n === 0 || o.crest_peak === null ? b.crest : capped(o.crest_peak, o.crest_n, b.crest),
    crest_n: reset ? Number(b.crest !== null) : o.crest_n + Number(b.crest !== null),
    changed_on: reset ? day : o.changed_on,
    k_mean: b.k === null ? o.k_mean : o.k_n === 0 || o.k_mean === null ? b.k : capped(o.k_mean, o.k_n, b.k),
    k_n: o.k_n + Number(b.k !== null),
    flow_mean: b.fl === null ? o.flow_mean : o.flow_n === 0 || o.flow_mean === null ? b.fl : capped(o.flow_mean, o.flow_n, b.fl),
    brake_mean: b.fl === null ? o.brake_mean : o.flow_n === 0 || o.brake_mean === null ? hb : capped(o.brake_mean, o.flow_n, hb),
    flow_n: o.flow_n + Number(b.fl !== null),
    bump_hit: reset ? (b.bp === null ? 0 : b.bp * w) : b.bp === null ? o.bump_hit : o.bump_hit + b.bp * w,
    bump_pass: reset ? (b.bp === null ? 0 : w) : b.bp === null ? o.bump_pass : o.bump_pass + w,
    bump_drivers: o.bump_drivers,
    smooth_run: reset ? 0 : smoother ? o.smooth_run + 1 : 0,
    last_on: (o.last_on ?? "") > day ? o.last_on : day,
    n: reset ? 1 : o.n + 1,
  };
}
