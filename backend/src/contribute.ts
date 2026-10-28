// Crowd road data intake, in real time (docs/BACKEND.md sections 3-4). Bins only, never a trace. A phone streams a drive as chunks
// (a run of 5 m bins on one road); each chunk is merged into the per-bin statistics immediately and earns points immediately.
// Nothing here ever returns another person's data.
import { Env, HttpError, body } from "./util";
import type { Viewer } from "./auth";
import { isoWeek } from "./points";

export const LIMITS = { maxBins: 2000, minBins: 20, maxAgeDays: 14, kmPerDay: 600, kmPerWeek: 1500, uploadsPerHour: 300, minCoverage: 0.6 };
const BIN_KM = 0.005;

/** crest: the bin's peak unweighting in g (0 = none, 1 = weightless over the top), null when the phone did not measure it. */
export interface Bin { i: number; cam: number | null; rough: number; crest: number | null; k: number | null }
export interface Contribution { wayId: number; dir: 0 | 1; drivenOn: string; driveId: string; bins: Bin[]; km: number; shape: [number, number][] | null }

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

  const seen = new Set<number>(), out: Bin[] = [];
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
    out.push({ i, cam, rough: b.rough, crest, k: b.k });
  }
  const lo = Math.min(...seen), hi = Math.max(...seen);
  if (out.length / (hi - lo + 1) < LIMITS.minCoverage) throw bad("not_contiguous");   // real drives cover a run of the road, not scattered bins
  return { wayId, dir, drivenOn: day, driveId, bins: out, km: out.length * BIN_KM, shape: validateShape(raw.shape, hi) };
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
  let m = 0;
  for (let k = 1; k < pts.length; k++) {
    const [a, b] = [pts[k - 1], pts[k]];
    m += Math.hypot((b[0] - a[0]) * 110540, (b[1] - a[1]) * 111320 * Math.cos(a[0] * Math.PI / 180));
  }
  return m >= hiBin * 5 * 0.8 ? pts : null;
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
    `INSERT INTO road_bins (way_id, dir, bin_idx, n, camber_mean, camber_m2, camber_n, rough_mean, rough_m2, crest_peak, crest_n, last_on, smooth_run)
     VALUES (?1, ?2, ?3, 1, ?4, CASE WHEN ?4 IS NULL THEN NULL ELSE 0 END, CASE WHEN ?4 IS NULL THEN 0 ELSE 1 END, ?5, 0, ?6, CASE WHEN ?6 IS NULL THEN 0 ELSE 1 END, ?7, 0)
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
       smooth_run  = CASE WHEN ${reset} THEN 0 WHEN ${smoother} THEN smooth_run + 1 ELSE 0 END,
       last_on     = MAX(COALESCE(last_on, ''), ?7),
       n           = CASE WHEN ${reset} THEN 1 ELSE n + 1 END`,
  ).bind(wayId, dir, b.i, b.cam, b.rough, b.crest, day);
}

/**
 * Who earns what for this chunk. The first person to upload a road+direction gets 3x, the second 2x, everyone after 1x (km x multiplier).
 * Points are earned on a person's FIRST drive on a road only (later drives still improve the data, they just do not pay again).
 * A drive's later chunks keep the multiplier its first chunk earned. Returns 0 when nothing is owed.
 */
async function multiplierFor(env: Env, userId: string, c: Contribution): Promise<number> {
  const holder = await hmac(env, `p|${userId}|${c.wayId}|${c.dir}`), drive = await hmac(env, `d|${userId}|${c.driveId}`);
  const slot = await env.DB.prepare("SELECT slot FROM rank_slots WHERE way_id = ? AND dir = ? AND holder = ?").bind(c.wayId, c.dir, holder.buffer).first<{ slot: number }>();
  const seen = await env.DB.prepare("SELECT d FROM seen WHERE h = ?").bind(holder.buffer).first<{ d: ArrayBuffer | null }>();
  if (seen) {
    const same = seen.d && new Uint8Array(seen.d).every((v, i) => v === drive[i]) && new Uint8Array(seen.d).length === drive.length;
    return same ? (slot ? MULTIPLIER[slot.slot - 1] : 1) : 0;                          // another drive of the same road already paid
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
  return mult;
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

  const mult = await multiplierFor(env, v.id, c);
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO seen (h) VALUES (?)").bind(chunk.buffer),                                  // fails (409 below) if a parallel copy won the race
    ...c.bins.map((b) => mergeBin(env, c.wayId, c.dir, b, c.drivenOn)),
    env.DB.prepare("INSERT INTO upload_counts (user_id, bucket, uploads, km) VALUES (?1, ?2, 1, ?3) ON CONFLICT (user_id, bucket) DO UPDATE SET uploads = uploads + 1, km = km + ?3").bind(v.id, hourKey, c.km),
    env.DB.prepare("DELETE FROM upload_counts WHERE bucket < ?").bind(new Date(now.getTime() - 8 * 86400_000).toISOString().slice(0, 13)),
  ];
  if (c.shape) {                                                                       // first good shape of a way wins; it's the map's, not the drive's
    const lats = c.shape.map((p) => p[0]), lons = c.shape.map((p) => p[1]);
    stmts.push(env.DB.prepare("INSERT OR IGNORE INTO road_ways (way_id, s, w, n, e, shape) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(c.wayId, Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons), JSON.stringify(c.shape)));
  }
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
  return { accepted: true, bins: c.bins.length };
}
