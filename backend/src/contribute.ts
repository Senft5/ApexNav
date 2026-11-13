// Crowd road data intake, in real time (docs/BACKEND.md sections 3-4). Bins only, never a trace. A phone streams a drive as chunks
// (a run of 5 m bins on one road); each chunk is merged into the per-bin statistics immediately and earns points immediately.
// Nothing here ever returns another person's data.
import { Env, HttpError, body } from "./util";
import type { Viewer } from "./auth";
import { isoWeek } from "./points";
import { serverFlag } from "./flags";
import { establishedSql } from "./reports_sql";
import { MIN_DRIVERS } from "./roads";

export const LIMITS = { maxBins: 2000, minBins: 20, maxAgeDays: 14, kmPerDay: 600, kmPerWeek: 1500, uploadsPerHour: 300, minCoverage: 0.6 };
const BIN_KM = 0.005;
/**
 * Camber from the fixed live pipeline (ApexKit IMUPipeline.camberVersion). Earlier builds decayed camber to a placeholder 0
 * on every straight (and a fading tail after each corner), so camber from an upload without `cam_v: CAM_V` is stored as
 * unknown (null). Its roughness, crest and curvature are unaffected.
 */
export const CAM_V = 2;

/**
 * crest: the bin's peak unweighting in g (0 = none, 1 = weightless over the top), null when the phone did not measure it.
 * fl: flow, the pass's speed steadiness over about 40 m (1 even, 0 stopped or stop-start), a ratio that holds no speed;
 * hb: 1 when the pass braked hard there with no corner ahead to explain it. Both null from builds that don't send them.
 */
export interface Bin { i: number; cam: number | null; rough: number; crest: number | null; k: number | null; fl: number | null; hb: 0 | 1 | null; bp: 0 | 1 | null }
/** rec: from a recorded drive (the driver pressed Start), not ambient sharing. hr: the pass's busy-time bucket (0..11), only kept
 *  while the quiet_hours flag is on (flags.ts); null otherwise. */
export interface Contribution { wayId: number; dir: 0 | 1; drivenOn: string; driveId: string; bins: Bin[]; km: number; shape: [number, number][] | null; cls: RoadClass | null; lenM: number | null;
  rec: boolean; hr: number | null }

/** Valhalla's road classes (the phone's map match, `edge.road_class`); anything else is stored as unknown (null). */
export const ROAD_CLASSES = ["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "service_other", "track"] as const;
export type RoadClass = typeof ROAD_CLASSES[number];
const roadClass = (v: unknown): RoadClass | null => (ROAD_CLASSES as readonly unknown[]).includes(v) ? v as RoadClass : null;

const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const bad = (why: string) => new HttpError(400, why);

/** Pure validation: shape, ranges, date window, contiguous coverage. Throws HttpError(400). */
export function validateContribution(raw: Record<string, unknown>, nowMs = Date.now()): Contribution {
  const wayId = raw.way_id, dir = raw.dir, day = raw.driven_on, bins = raw.bins, driveId = raw.drive_id;
  if (typeof driveId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(driveId)) throw bad("bad_drive_id");
  if (typeof wayId !== "number" || !Number.isSafeInteger(wayId) || wayId < 1) throw bad("bad_way_id");
  if (dir !== 0 && dir !== 1) throw bad("bad_dir");
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw bad("bad_driven_on");
  const dayMs = Date.parse(day + "T00:00:00Z");
  if (!Number.isFinite(dayMs)) throw bad("bad_driven_on");
  if (dayMs > nowMs + 86400_000) throw bad("driven_in_future");
  if (dayMs < nowMs - (LIMITS.maxAgeDays + 1) * 86400_000) throw bad("too_old");
  if (!Array.isArray(bins) || bins.length < LIMITS.minBins || bins.length > LIMITS.maxBins) throw bad("bad_bin_count");

  const seen = new Set<number>(), out: Bin[] = [], camTrusted = raw.cam_v === CAM_V;
  for (const b of bins as Record<string, unknown>[]) {
    if (!b || typeof b !== "object") throw bad("bad_bin");
    const i = b.i;
    if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i > 100_000 || seen.has(i)) throw bad("bad_bin_index");
    seen.add(i);
    const cam = b.cam === null || b.cam === undefined ? null : b.cam;
    if (cam !== null && !isNum(cam, -15, 15)) throw bad("bad_camber");
    if (!isNum(b.rough, 0, 1.5)) throw bad("bad_roughness");
    const crest = b.crest === null || b.crest === undefined ? null : b.crest;        // a phone with no crest sensor says so
    if (crest !== null && !isNum(crest, 0, 3)) throw bad("bad_crest");
    if (b.k !== null && !isNum(b.k, -0.2, 0.2)) throw bad("bad_curvature");          // null = curvature unknown; radius under 5 m is not a road
    const fl = b.fl === null || b.fl === undefined ? null : b.fl;                      // an older build sends no flow: unknown
    if (fl !== null && !isNum(fl, 0, 1)) throw bad("bad_flow");
    const hb = b.hb === null || b.hb === undefined ? null : b.hb;
    if (hb !== null && hb !== 0 && hb !== 1) throw bad("bad_brake");
    const bp = b.bp === null || b.bp === undefined ? null : b.bp;                      // bump felt here (IDEAS Q-02); an older build: unknown
    if (bp !== null && bp !== 0 && bp !== 1) throw bad("bad_bump");
    out.push({ i, cam: camTrusted ? cam : null, rough: b.rough, crest, k: b.k, fl: fl === null ? null : Math.round(fl * 1000) / 1000, hb: hb as 0 | 1 | null, bp: bp as 0 | 1 | null });   // an old build's camber: validated, then unknown
  }
  const lo = Math.min(...seen), hi = Math.max(...seen);
  if (out.length / (hi - lo + 1) < LIMITS.minCoverage) throw bad("not_contiguous");   // real drives cover a run of the road, not scattered bins
  const shape = validateShape(raw.shape, hi);
  // the way's length for the open-road rule (roads.ts): its line's, or at least as far along it as the bins reach (the
  // phone counts 5 m bins along the full OSM line; the line it sends is simplified, so a little shorter)
  const lenM = shape ? Math.round(Math.max(shapeLength(shape), (hi + 1) * 5)) : null;
  const hr = raw.hr === null || raw.hr === undefined ? null : raw.hr;
  if (hr !== null && !(typeof hr === "number" && Number.isInteger(hr) && hr >= 0 && hr <= 11)) throw bad("bad_hour_bucket");
  return { wayId, dir, drivenOn: day, driveId, bins: out, km: out.length * BIN_KM, shape, cls: roadClass(raw.cls), lenM, rec: raw.rec === 1 || raw.rec === true, hr: hr as number | null };
}

const MAX_SHAPE = 64;
/**
 * The way's OSM geometry for the coverage map (IDEAS Q-14), optional: 2-64 [lat, lon] points within 0.5° of each other and
 * at least as long as the bins say the way is (bins count 5 m from its first node; 20% slack for simplifying). Anything else
 * is dropped rather than refused: the road data is still good without a line to draw.
 */
export function validateShape(raw: unknown, hiBin: number): [number, number][] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_SHAPE) return null;
  const pts: [number, number][] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0], -85, 85) || !isNum(p[1], -180, 180)) return null;
    pts.push([Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
  }
  const lats = pts.map((p) => p[0]), lons = pts.map((p) => p[1]);
  if (Math.max(...lats) - Math.min(...lats) > 0.5 || Math.max(...lons) - Math.min(...lons) > 0.5) return null;
  return shapeLength(pts) >= hiBin * 5 * 0.8 ? pts : null;
}

/** Length of a [lat, lon] line in metres (local flat-earth, fine at road scale). */
export function shapeLength(pts: [number, number][]): number {
  let m = 0;
  for (let k = 1; k < pts.length; k++) {
    const [a, b] = [pts[k - 1], pts[k]];
    m += Math.hypot((b[0] - a[0]) * 110540, (b[1] - a[1]) * 111320 * Math.cos(a[0] * Math.PI / 180));
  }
  return m;
}

const MULTIPLIER = [3, 2] as const;
/** Octane each for an invite that led to real road data (IDEAS O-07): the inviter and the person they invited, once. */
export const REFERRAL_OCTANE = 5;                 // first and second person to map a road+direction; then 1x

async function hmac(env: Env, text: string): Promise<Uint8Array> {
  if (!env.PEPPER) throw new HttpError(503, "contribute_not_configured");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.PEPPER), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
}

export async function setContribute(env: Env, v: Viewer, req: Request): Promise<void> {
  const { on } = await body<{ on?: boolean }>(req);
  if (typeof on !== "boolean") throw bad("bad_on");
  await env.DB.prepare("UPDATE members SET contribute = ? WHERE user_id = ?").bind(on ? 1 : 0, v.id).run();
}

/**
 * Freshness (IDEAS Q-12). MEMORY: once a bin has this many passes each new one keeps a 1/(MEMORY+1) share, so a road that
 * changes slowly (wear, a patch) shows it instead of being outvoted by years of old passes; under MEMORY it's the plain mean.
 * A step change: a pass reading under half an established bin's roughness (3+ passes) and more than 0.05 g below it is
 * "much smoother"; two in a row and the road was repaved, so the bin starts again from the second. (No spread test: the
 * first smooth pass itself widens the spread it would be judged against.)
 */
export const FRESH = { memory: 20, repaveRatio: 0.5, repaveG: 0.05, repavePasses: 2 };

/**
 * Crowd bumps (IDEAS Q-02, docs/ROAD_INTELLIGENCE.md 4.3). Each pass that says whether it felt a spike in a bin adds its
 * weight to bump_pass, and to bump_hit when it did. The weight is 2^((day - epoch) / halfLifeDays): read on any later day and
 * divided by that day's weight, a pass from one half-life earlier counts half, so a filled pothole fades without a sweep and a
 * pass sent days late (a phone with no signal) counts as old as it is. D1 has no power(), so the weight is worked out here.
 * cellBins: drivers are counted once per person within a cell of this many bins and the neighbouring cell when the hit is
 * within nearBins of its edge (two hits of one person 10 m apart on two drives are one driver, never two).
 */
export const BUMP = { halfLifeDays: 120, epoch: "2026-01-01", cellBins: 8, nearBins: 2 };
export const bumpWeight = (day: string) => 2 ** ((Date.parse(day + "T00:00:00Z") - Date.parse(BUMP.epoch + "T00:00:00Z")) / 86400_000 / BUMP.halfLifeDays);

/** Running mean and Welford sum of squares for value x over count k, with the MEMORY cap (SQL; old values on the right). */
function meanSql(mean: string, m2: string, k: string, x: string) {
  const K = `MIN(${k}, ${FRESH.memory})`, a = `1.0 / (${FRESH.memory} + 1)`;
  return {
    mean: `${mean} + (${x} - ${mean}) / (${K} + 1)`,
    // exact Welford under MEMORY; past it an exponentially weighted variance, stored so that m2 / (k - 1) is still the variance
    m2: `CASE WHEN ${k} < ${FRESH.memory} THEN COALESCE(${m2}, 0) + (${x} - ${mean}) * (${x} - (${mean} + (${x} - ${mean}) / (${K} + 1)))
              ELSE ${k} * (1 - ${a}) * (COALESCE(${m2}, 0) / (${k} - 1) + ${a} * (${x} - ${mean}) * (${x} - ${mean})) END`,
  };
}

/** Merges one bin into road_bins in a single atomic statement (computed from the old row). */
function mergeBin(env: Env, wayId: number, dir: number, b: Bin, day: string): D1PreparedStatement {
  const smoother = `(n >= 3 AND rough_mean IS NOT NULL AND ?5 < rough_mean * ${FRESH.repaveRatio} AND rough_mean - ?5 > ${FRESH.repaveG})`;
  const reset = `(${smoother} AND smooth_run + 1 >= ${FRESH.repavePasses})`;
  const cam = meanSql("camber_mean", "camber_m2", "camber_n", "?4"), rough = meanSql("rough_mean", "rough_m2", "n", "?5");
  return env.DB.prepare(
    `INSERT INTO road_bins (way_id, dir, bin_idx, n, camber_mean, camber_m2, camber_n, rough_mean, rough_m2, crest_peak, crest_n, last_on, smooth_run, k_mean, k_n,
                            flow_mean, brake_mean, flow_n, bump_hit, bump_pass)
     VALUES (?1, ?2, ?3, 1, ?4, CASE WHEN ?4 IS NULL THEN NULL ELSE 0 END, CASE WHEN ?4 IS NULL THEN 0 ELSE 1 END, ?5, 0, ?6, CASE WHEN ?6 IS NULL THEN 0 ELSE 1 END, ?7, 0,
             ?8, CASE WHEN ?8 IS NULL THEN 0 ELSE 1 END, ?9, CASE WHEN ?9 IS NULL THEN NULL ELSE ?10 END, CASE WHEN ?9 IS NULL THEN 0 ELSE 1 END,
             CASE WHEN ?11 IS NULL THEN 0 ELSE ?11 * ?12 END, CASE WHEN ?11 IS NULL THEN 0 ELSE ?12 END)
     ON CONFLICT (way_id, dir, bin_idx) DO UPDATE SET
       camber_mean = CASE WHEN ${reset} THEN ?4 WHEN ?4 IS NULL THEN camber_mean WHEN camber_n = 0 OR camber_mean IS NULL THEN ?4 ELSE ${cam.mean} END,
       camber_m2   = CASE WHEN ${reset} THEN CASE WHEN ?4 IS NULL THEN NULL ELSE 0 END WHEN ?4 IS NULL THEN camber_m2 WHEN camber_n = 0 OR camber_mean IS NULL THEN 0 ELSE ${cam.m2} END,
       camber_n    = CASE WHEN ${reset} THEN (?4 IS NOT NULL) ELSE camber_n + (?4 IS NOT NULL) END,
       rough_mean  = CASE WHEN ${reset} THEN ?5 ELSE ${rough.mean} END,
       rough_m2    = CASE WHEN ${reset} THEN 0 ELSE ${rough.m2} END,
       crest_peak  = CASE WHEN ${reset} THEN ?6 WHEN ?6 IS NULL THEN crest_peak WHEN crest_n = 0 OR crest_peak IS NULL THEN ?6
                          ELSE crest_peak + (?6 - crest_peak) / (MIN(crest_n, ${FRESH.memory}) + 1) END,
       crest_n     = CASE WHEN ${reset} THEN (?6 IS NOT NULL) ELSE crest_n + (?6 IS NOT NULL) END,
       changed_on  = CASE WHEN ${reset} THEN ?7 ELSE changed_on END,
       -- the road's shape (IDEAS Q-04) doesn't change when it's repaved: never reset
       k_mean      = CASE WHEN ?8 IS NULL THEN k_mean WHEN k_n = 0 OR k_mean IS NULL THEN ?8 ELSE k_mean + (?8 - k_mean) / (MIN(k_n, ${FRESH.memory}) + 1) END,
       k_n         = k_n + (?8 IS NOT NULL),
       -- flow (how members drive it, not the pavement): like the road's shape, never reset by repaving
       flow_mean   = CASE WHEN ?9 IS NULL THEN flow_mean WHEN flow_n = 0 OR flow_mean IS NULL THEN ?9 ELSE flow_mean + (?9 - flow_mean) / (MIN(flow_n, ${FRESH.memory}) + 1) END,
       brake_mean  = CASE WHEN ?9 IS NULL THEN brake_mean WHEN flow_n = 0 OR brake_mean IS NULL THEN ?10 ELSE brake_mean + (?10 - brake_mean) / (MIN(flow_n, ${FRESH.memory}) + 1) END,
       flow_n      = flow_n + (?9 IS NOT NULL),
       -- bumps (IDEAS Q-02): a repaved road starts again too (its potholes went with the old surface); drivers are kept, the
       -- posterior needs fresh hits to pass again
       bump_hit    = CASE WHEN ${reset} THEN COALESCE(?11 * ?12, 0) WHEN ?11 IS NULL THEN bump_hit ELSE bump_hit + ?11 * ?12 END,
       bump_pass   = CASE WHEN ${reset} THEN CASE WHEN ?11 IS NULL THEN 0 ELSE ?12 END WHEN ?11 IS NULL THEN bump_pass ELSE bump_pass + ?12 END,
       smooth_run  = CASE WHEN ${reset} THEN 0 WHEN ${smoother} THEN smooth_run + 1 ELSE 0 END,
       last_on     = MAX(COALESCE(last_on, ''), ?7),
       n           = CASE WHEN ${reset} THEN 1 ELSE n + 1 END`,
  ).bind(wayId, dir, b.i, b.cam, b.rough, b.crest, day, b.k, b.fl, b.fl === null ? null : (b.hb ?? 0), b.bp, bumpWeight(day));
}

/**
 * A bump hit in bin i by this person (IDEAS Q-02): one more driver for the bin unless the same person already hit something
 * in its 40 m cell, or in the next cell when the hit is near that edge. The marker is a keyed hash, never the person. Runs
 * after the bin's merge in the same batch (the row exists); the UPDATE checks the markers before the INSERT adds this one.
 */
async function bumpDriverStmts(env: Env, userId: string, c: Contribution): Promise<D1PreparedStatement[]> {
  const out: D1PreparedStatement[] = [];
  for (const b of c.bins) {
    if (b.bp !== 1) continue;
    const cell = Math.floor(b.i / BUMP.cellBins), r = b.i - cell * BUMP.cellBins;
    const near = r < BUMP.nearBins ? cell - 1 : r >= BUMP.cellBins - BUMP.nearBins ? cell + 1 : null;
    const mark = async (k: number) => (await hmac(env, `b|${userId}|${c.wayId}|${c.dir}|${k}`)).buffer;
    const own = await mark(cell), other = near === null ? own : await mark(near);
    out.push(env.DB.prepare("UPDATE road_bins SET bump_drivers = bump_drivers + 1 WHERE way_id = ? AND dir = ? AND bin_idx = ? AND NOT EXISTS (SELECT 1 FROM seen WHERE h IN (?, ?))")
      .bind(c.wayId, c.dir, b.i, own, other),
      env.DB.prepare("INSERT OR IGNORE INTO seen (h) VALUES (?)").bind(own));
  }
  return out;
}

/**
 * Who earns what for this chunk. The first person to upload a road+direction gets 3x, the second 2x, everyone after 1x (km x multiplier).
 * Points are earned on a person's FIRST drive on a road only (later drives still improve the data, they just do not pay again).
 * A drive's later chunks keep the multiplier its first chunk earned. Returns 0 when nothing is owed.
 */
async function multiplierFor(env: Env, userId: string, c: Contribution): Promise<{ mult: number; again: boolean; holder: Uint8Array }> {
  const holder = await hmac(env, `p|${userId}|${c.wayId}|${c.dir}`), drive = await hmac(env, `d|${userId}|${c.driveId}`);
  const slot = await env.DB.prepare("SELECT slot FROM rank_slots WHERE way_id = ? AND dir = ? AND holder = ?").bind(c.wayId, c.dir, holder.buffer).first<{ slot: number }>();
  const seen = await env.DB.prepare("SELECT d FROM seen WHERE h = ?").bind(holder.buffer).first<{ d: ArrayBuffer | null }>();
  if (seen) {
    const same = seen.d && new Uint8Array(seen.d).every((v, i) => v === drive[i]) && new Uint8Array(seen.d).length === drive.length;
    // another drive of the same road already paid; on a recorded drive that is someone coming back to it (loved roads)
    return same ? { mult: slot ? MULTIPLIER[slot.slot - 1] : 1, again: false, holder } : { mult: 0, again: c.rec, holder };
  }
  let mult = 1;
  for (let s = 1; s <= MULTIPLIER.length; s++) {                                       // the primary key makes the claim atomic
    const r = await env.DB.prepare("INSERT OR IGNORE INTO rank_slots (way_id, dir, slot, user_id, driven_on, holder) VALUES (?, ?, ?, NULL, ?, ?)")
      .bind(c.wayId, c.dir, s, c.drivenOn, holder.buffer).run();
    if (r.meta.changes) {
      mult = MULTIPLIER[s - 1];
      // a pioneer badge (IDEAS S-09): counted now, for this member only
      await env.DB.prepare(`UPDATE members SET ${s === 1 ? "pioneer_firsts = pioneer_firsts" : "pioneer_seconds = pioneer_seconds"} + 1 WHERE user_id = ?`).bind(userId).run();
      break;
    }
  }
  await env.DB.prepare("INSERT OR IGNORE INTO seen (h, d) VALUES (?, ?)").bind(holder.buffer, drive.buffer).run();
  return { mult, again: false, holder };
}

/**
 * Loved roads (crowd.js): a member back on a road+direction on another recorded drive counts once, ever (a `seen` marker per
 * person and road), into road_love. No person, day or drive is stored with it.
 */
async function countAgain(env: Env, userId: string, c: Contribution): Promise<void> {
  const mark = await hmac(env, `a|${userId}|${c.wayId}|${c.dir}`);
  const r = await env.DB.prepare("INSERT OR IGNORE INTO seen (h) VALUES (?)").bind(mark.buffer).run();
  if (!r.meta.changes) return;
  await env.DB.prepare("INSERT INTO road_love (way_id, dir, again_n) VALUES (?, ?, 1) ON CONFLICT (way_id, dir) DO UPDATE SET again_n = again_n + 1").bind(c.wayId, c.dir).run();
}

/**
 * Busy times (IDEAS R-36): only while the quiet_hours flag is on (default off, the owner's open decision). One count per drive
 * per road+direction in its 4-hour bucket, and the person's hmac (never their id) so a road shows times only once 5+ drove it.
 */
async function countHour(env: Env, userId: string, c: Contribution, holder: Uint8Array): Promise<void> {
  if (c.hr === null || !serverFlag(env, "quiet_hours")) return;
  const once = await hmac(env, `h|${userId}|${c.driveId}|${c.wayId}|${c.dir}`);
  const r = await env.DB.prepare("INSERT OR IGNORE INTO seen (h) VALUES (?)").bind(once.buffer).run();
  if (!r.meta.changes) return;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO road_hours (way_id, dir, bucket, n) VALUES (?, ?, ?, 1) ON CONFLICT (way_id, dir, bucket) DO UPDATE SET n = n + 1").bind(c.wayId, c.dir, c.hr),
    env.DB.prepare("INSERT OR IGNORE INTO road_hour_holders (way_id, dir, holder) VALUES (?, ?, ?)").bind(c.wayId, c.dir, holder.buffer),
  ]);
}

/**
 * Referral (IDEAS O-07): a member who joined on someone's invite, on their first accepted road data, earns REFERRAL_OCTANE
 * for themselves and their inviter, once. Only the request whose update flips the flag pays, so parallel chunks can't pay twice.
 */
async function payReferral(env: Env, userId: string, now: Date): Promise<void> {
  const flip = await env.DB.prepare("UPDATE members SET referral_paid = 1 WHERE user_id = ? AND referral_paid = 0 AND invited_by IS NOT NULL RETURNING invited_by")
    .bind(userId).first<{ invited_by: string }>();
  if (!flip) return;
  const week = isoWeek(now.getTime());
  await env.DB.batch([userId, flip.invited_by].map((who) => env.DB.prepare(
    `INSERT INTO points_ledger (user_id, iso_week, octane) SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM members WHERE user_id = ?1)
     ON CONFLICT (user_id, iso_week) DO UPDATE SET octane = octane + ?3`).bind(who, week, REFERRAL_OCTANE)));
}

export async function contribute(env: Env, v: Viewer, req: Request): Promise<{ accepted: true; bins: number; duplicate?: true }> {
  const opted = await env.DB.prepare("SELECT contribute FROM members WHERE user_id = ?").bind(v.id).first<{ contribute: number }>();
  if (!opted?.contribute) throw new HttpError(403, "contribution_not_enabled");
  const c = validateContribution(await body<Record<string, unknown>>(req));

  // the same chunk sent twice (a retry after a dropped connection) is acknowledged but merged once
  const lo = Math.min(...c.bins.map((b) => b.i)), hi = Math.max(...c.bins.map((b) => b.i));
  const chunk = await hmac(env, `c|${v.id}|${c.driveId}|${c.wayId}|${c.dir}|${lo}|${hi}`);
  const hasReceipt = async () => {
    try { return await env.DB.prepare("SELECT 1 FROM seen WHERE h = ?").bind(chunk.buffer).first(); }
    catch { throw new HttpError(503, "contribution_temporarily_unavailable"); }
  };
  if (await hasReceipt()) return { accepted: true, bins: c.bins.length, duplicate: true };

  const now = new Date(), hourKey = now.toISOString().slice(0, 13);
  const sum = (sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a).first<{ u: number; k: number }>();
  const hour = await sum("SELECT COALESCE(SUM(uploads), 0) AS u, 0 AS k FROM upload_counts WHERE user_id = ? AND bucket = ?", v.id, hourKey);
  if ((hour?.u ?? 0) >= LIMITS.uploadsPerHour) throw new HttpError(429, "rate_limited");
  const day = await sum("SELECT 0 AS u, COALESCE(SUM(km), 0) AS k FROM upload_counts WHERE user_id = ? AND bucket >= ?", v.id, new Date(now.getTime() - 86400_000).toISOString().slice(0, 13));
  if ((day?.k ?? 0) + c.km > LIMITS.kmPerDay) throw new HttpError(429, "daily_km_cap");
  const week = await sum("SELECT 0 AS u, COALESCE(SUM(km), 0) AS k FROM upload_counts WHERE user_id = ? AND bucket >= ?", v.id, new Date(now.getTime() - 7 * 86400_000).toISOString().slice(0, 13));
  if ((week?.k ?? 0) + c.km > LIMITS.kmPerWeek) throw new HttpError(429, "weekly_km_cap");

  const { mult, again, holder } = await multiplierFor(env, v.id, c);
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO seen (h) VALUES (?)").bind(chunk.buffer),                                  // fails (409 below) if a parallel copy won the race
    ...c.bins.map((b) => mergeBin(env, c.wayId, c.dir, b, c.drivenOn)),
    ...(await bumpDriverStmts(env, v.id, c)),
    // the two-driver privacy floor (roads.ts shownSql) counts established members only (migration 0058): a fresh account
    // still earns its slot above, but can't alone make a lone driver's road visible. Counted again on a later drive, once
    // the account is a week old.
    env.DB.prepare(`INSERT OR IGNORE INTO road_floor (way_id, dir, holder) SELECT ?1, ?2, ?3
                     WHERE ${establishedSql("?4")} AND (SELECT COUNT(*) FROM road_floor WHERE way_id = ?1 AND dir = ?2) < ${MIN_DRIVERS}`)
      .bind(c.wayId, c.dir, holder.buffer, v.id),
    env.DB.prepare("INSERT INTO upload_counts (user_id, bucket, uploads, km) VALUES (?1, ?2, 1, ?3) ON CONFLICT (user_id, bucket) DO UPDATE SET uploads = uploads + 1, km = km + ?3").bind(v.id, hourKey, c.km),
    env.DB.prepare("DELETE FROM upload_counts WHERE bucket < ?").bind(new Date(now.getTime() - 8 * 86400_000).toISOString().slice(0, 13)),
  ];
  if (c.shape) {                                                                       // first good shape of a way wins; it's the map's, not the drive's
    // class and length (the open-road rule, roads.ts) also first-wins, filled in for ways stored before they were sent
    const lats = c.shape.map((p) => p[0]), lons = c.shape.map((p) => p[1]);
    stmts.push(env.DB.prepare(`INSERT INTO road_ways (way_id, s, w, n, e, shape, cls, len_m) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                               ON CONFLICT (way_id) DO UPDATE SET cls = COALESCE(road_ways.cls, excluded.cls), len_m = COALESCE(road_ways.len_m, excluded.len_m)`)
      .bind(c.wayId, Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons), JSON.stringify(c.shape), c.cls, c.lenM));
  }
  // this month's km and pioneer km (IDEAS S-11): every accepted chunk counts; pioneer km only while this drive holds the first slot
  stmts.push(env.DB.prepare(`INSERT INTO member_months (user_id, month, km, pioneer_km) VALUES (?1, ?2, ?3, ?4)
                             ON CONFLICT (user_id, month) DO UPDATE SET km = km + ?3, pioneer_km = pioneer_km + ?4`)
    .bind(v.id, now.toISOString().slice(0, 7), c.km, mult === MULTIPLIER[0] ? c.km : 0));
  if (mult > 0) {
    stmts.push(env.DB.prepare("INSERT INTO points_ledger (user_id, iso_week, octane) VALUES (?1, ?2, ?3) ON CONFLICT (user_id, iso_week) DO UPDATE SET octane = octane + ?3")
      .bind(v.id, isoWeek(now.getTime()), c.km * mult));
  }
  try {
    await env.DB.batch(stmts);
  } catch {
    if (await hasReceipt()) return { accepted: true, bins: c.bins.length, duplicate: true };
    throw new HttpError(503, "contribution_temporarily_unavailable");
  }
  await payReferral(env, v.id, now);
  if (again) await countAgain(env, v.id, c);
  await countHour(env, v.id, c, holder);
  return { accepted: true, bins: c.bins.length };
}
