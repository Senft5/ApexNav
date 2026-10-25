// Crowd road data intake (docs/BACKEND.md sections 3-4). Bins only, never a trace. Uploads wait in ingest_pending
// until the nightly job (nightly.ts) ranks and merges them. Nothing here ever returns another person's data.
import { Env, HttpError, body } from "./util";
import type { Viewer } from "./auth";

export const LIMITS = { maxBins: 2000, minBins: 20, maxAgeDays: 14, kmPerDay: 600, kmPerWeek: 1500, uploadsPerHour: 30, minCoverage: 0.8 };
const BIN_KM = 0.005;

export interface Bin { i: number; cam: number | null; rough: number; crest: number; k: number }
export interface Contribution { wayId: number; dir: 0 | 1; drivenOn: string; bins: Bin[]; km: number }

const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const bad = (why: string) => new HttpError(400, why);

/** Pure validation: shape, ranges, date window, contiguous coverage. Throws HttpError(400). */
export function validateContribution(raw: Record<string, unknown>, nowMs = Date.now()): Contribution {
  const wayId = raw.way_id, dir = raw.dir, day = raw.driven_on, bins = raw.bins;
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
    if (!isNum(b.crest, 0, 3)) throw bad("bad_crest");
    if (!isNum(b.k, -0.2, 0.2)) throw bad("bad_curvature");          // radius under 5 m is not a road
    out.push({ i, cam, rough: b.rough, crest: b.crest, k: b.k });
  }
  const lo = Math.min(...seen), hi = Math.max(...seen);
  if (out.length / (hi - lo + 1) < LIMITS.minCoverage) throw bad("not_contiguous");   // real drives cover a run of the road, not scattered bins
  return { wayId, dir, drivenOn: day, bins: out, km: out.length * BIN_KM };
}

async function dedupeHash(env: Env, userId: string, wayId: number, dir: number): Promise<Uint8Array> {
  if (!env.PEPPER) throw new HttpError(503, "contribute_not_configured");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.PEPPER), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${userId}|${wayId}|${dir}`)));
}

export async function setContribute(env: Env, v: Viewer, req: Request): Promise<void> {
  const { on } = await body<{ on?: boolean }>(req);
  if (typeof on !== "boolean") throw bad("bad_on");
  await env.DB.prepare("UPDATE members SET contribute = ? WHERE user_id = ?").bind(on ? 1 : 0, v.id).run();
}

export async function contribute(env: Env, v: Viewer, req: Request): Promise<{ accepted: true; bins: number }> {
  const opted = await env.DB.prepare("SELECT contribute FROM members WHERE user_id = ?").bind(v.id).first<{ contribute: number }>();
  if (!opted?.contribute) throw new HttpError(403, "contribution_not_enabled");
  const c = validateContribution(await body<Record<string, unknown>>(req));

  const q = (sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a).first<{ s: number }>();
  const hour = await q("SELECT COUNT(*) AS s FROM ingest_pending WHERE user_id = ? AND received_at > datetime('now', '-1 hour')", v.id);
  if ((hour?.s ?? 0) >= LIMITS.uploadsPerHour) throw new HttpError(429, "rate_limited");
  const day = await q("SELECT COALESCE(SUM(km), 0) AS s FROM ingest_pending WHERE user_id = ? AND driven_on = ?", v.id, c.drivenOn);
  if ((day?.s ?? 0) + c.km > LIMITS.kmPerDay) throw new HttpError(429, "daily_km_cap");
  const week = await q("SELECT COALESCE(SUM(km), 0) AS s FROM ingest_pending WHERE user_id = ? AND received_at > datetime('now', '-7 days')", v.id);
  if ((week?.s ?? 0) + c.km > LIMITS.kmPerWeek) throw new HttpError(429, "weekly_km_cap");

  // one contribution per person per way+direction, ever: the hash is how we know without keeping a readable who-drove-what list
  const h = await dedupeHash(env, v.id, c.wayId, c.dir);
  const packed = JSON.stringify({ i: c.bins.map((b) => b.i), cam: c.bins.map((b) => b.cam), rough: c.bins.map((b) => b.rough), crest: c.bins.map((b) => b.crest), k: c.bins.map((b) => b.k) });
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO seen (h) VALUES (?)").bind(h.buffer),
      env.DB.prepare("INSERT INTO ingest_pending (user_id, way_id, dir, driven_on, km, bins) VALUES (?, ?, ?, ?, ?, ?)").bind(v.id, c.wayId, c.dir, c.drivenOn, c.km, packed),
    ]);
  } catch {
    throw new HttpError(409, "already_contributed");
  }
  return { accepted: true, bins: c.bins.length };
}
