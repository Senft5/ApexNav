// Friends on the map (docs/design/REVIEW.md 5.4, roadmap 24). Off unless you choose who sees you: Nobody (no row at all),
// your crews, or your friends. Your position is published with the delay applied (a viewer gets the newest sample at
// least that old, never a newer one) and, unless you choose Exact, snapped to a fixed grid about a mile across before it is
// stored, so repeated reads can't be averaged back. Inside one of your home zones nothing is stored, convoy unaffected
// (it has its own sharing). The phone only sends while you drive; turning sharing off deletes everything here.
import type { Viewer } from "./auth";
import { Env, HttpError, body, num } from "./util";
import { cleanText } from "./convoy";

export const DELAYS = [0, 600, 3600] as const, MIN_GAP_S = 20, STALE_AFTER_S = 1800, MAX_ZONES = 10;
export const GRID_DEG = 1 / 69;                         // about a mile of latitude
export const PRESENCE_SWEEP = "DELETE FROM presence_samples WHERE at <= datetime('now', '-2 hours')";

/** The fixed grid: the centre of the cell (about 1 mile square) a point falls in. Bands of latitude, each with its own
 *  longitude step, so a cell's size doesn't depend on where in the band you are. Pure. */
export function snap(lat: number, lon: number): { lat: number; lon: number } {
  const row = Math.floor(lat / GRID_DEG), cLat = (row + 0.5) * GRID_DEG;
  const step = GRID_DEG / Math.max(0.05, Math.cos((cLat * Math.PI) / 180));
  const col = Math.floor(lon / step);
  return { lat: Math.round(cLat * 1e5) / 1e5, lon: Math.round((col + 0.5) * step * 1e5) / 1e5 };
}
const metres = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.hypot((a.lat - b.lat) * 111_320, (a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180));

interface Settings { audience: "crew" | "friends"; delay_s: number; fuzz: number; zones: string }

/** GET /api/presence/settings: yours, or { audience: "nobody" }. */
export async function presenceSettingsGet(env: Env, v: Viewer) {
  const s = await env.DB.prepare("SELECT audience, delay_s, fuzz FROM presence_settings WHERE user_id = ?").bind(v.id).first<Settings>();
  return s ? { audience: s.audience, delay_s: s.delay_s, fuzz: !!s.fuzz } : { audience: "nobody", delay_s: 600, fuzz: true };
}

/** PUT /api/presence/settings { audience: nobody|crew|friends, delay_s, fuzz, zones }: nobody deletes it all. */
export async function presenceSettingsPut(env: Env, v: Viewer, req: Request): Promise<void> {
  const b = await body<{ audience?: unknown; delay_s?: unknown; fuzz?: unknown; zones?: unknown }>(req);
  if (b.audience === "nobody") { await presenceOff(env, v.id); return; }
  if (b.audience !== "crew" && b.audience !== "friends") throw new HttpError(400, "bad_audience");
  const delay = DELAYS.find((d) => d === b.delay_s);
  if (delay === undefined) throw new HttpError(400, "bad_delay");
  if (typeof b.fuzz !== "boolean") throw new HttpError(400, "bad_fuzz");
  const zones = b.zones === undefined ? [] : b.zones;
  if (!Array.isArray(zones) || zones.length > MAX_ZONES) throw new HttpError(400, "bad_zones");
  const clean = zones.map((z) => {
    const o = (z && typeof z === "object" ? z : {}) as { lat?: unknown; lon?: unknown; r?: unknown };
    return { lat: num(o.lat, "zones", -85, 85), lon: num(o.lon, "zones", -180, 180), r: num(o.r, "zones", 100, 5000) };
  });
  const prev = await env.DB.prepare("SELECT fuzz FROM presence_settings WHERE user_id = ?").bind(v.id).first<{ fuzz: number }>();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO presence_settings (user_id, audience, delay_s, fuzz, zones) VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT (user_id) DO UPDATE SET audience = ?2, delay_s = ?3, fuzz = ?4, zones = ?5, updated_at = datetime('now')`)
      .bind(v.id, b.audience, delay, b.fuzz ? 1 : 0, JSON.stringify(clean)),
    // samples stored under other choices go: an exact one must never be shown once you chose "within a mile"
    ...(prev && prev.fuzz !== (b.fuzz ? 1 : 0) ? [env.DB.prepare("DELETE FROM presence_samples WHERE user_id = ?").bind(v.id)] : []),
  ]);
}

/** Sharing off: nothing kept. Also used when the account goes. */
export async function presenceOff(env: Env, userId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM presence_samples WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM presence_settings WHERE user_id = ?").bind(userId),
  ]);
}

/** POST /api/presence { lat, lon, road? }: a position while driving. Dropped (204 all the same) when you don't share, it's
 *  inside a home zone, or it comes sooner than MIN_GAP_S after the last. */
export async function presencePublish(env: Env, v: Viewer, req: Request): Promise<void> {
  const s = await env.DB.prepare("SELECT audience, delay_s, fuzz, zones FROM presence_settings WHERE user_id = ?").bind(v.id).first<Settings>();
  if (!s) return;
  const b = await body<{ lat?: unknown; lon?: unknown; road?: unknown }>(req);
  const p = { lat: num(b.lat, "lat", -85, 85), lon: num(b.lon, "lon", -180, 180) };
  if ((JSON.parse(s.zones) as { lat: number; lon: number; r: number }[]).some((z) => metres(p, z) <= z.r)) return;
  const at = s.fuzz ? snap(p.lat, p.lon) : { lat: Math.round(p.lat * 1e5) / 1e5, lon: Math.round(p.lon * 1e5) / 1e5 };
  const road = !s.fuzz && s.delay_s === 0 ? cleanText(b.road, 40)?.trim() || null : null;
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO presence_samples (user_id, lat, lon, road) SELECT ?1, ?2, ?3, ?4
      WHERE NOT EXISTS (SELECT 1 FROM presence_samples WHERE user_id = ?1 AND at > datetime('now', '-${MIN_GAP_S} seconds'))`).bind(v.id, at.lat, at.lon, road),
    // keep only what the delay needs: the newest sample older than the delay, and everything newer
    env.DB.prepare(`DELETE FROM presence_samples WHERE user_id = ?1 AND at < COALESCE((SELECT MAX(at) FROM presence_samples
      WHERE user_id = ?1 AND at <= datetime('now', '-' || ?2 || ' seconds')), '0000')`).bind(v.id, s.delay_s),
  ]);
}

/** GET /api/presence: the people sharing with you (crew-mates for "crew", accepted friends for "friends"), each at their
 *  newest sample that is at least their delay old and not stale; never anyone blocked either way. */
export async function presenceView(env: Env, v: Viewer) {
  const rows = (await env.DB.prepare(
    `SELECT u.handle, u.photo_id, s.delay_s, s.fuzz, p.lat, p.lon, p.road, p.at
       FROM presence_settings s JOIN users u ON u.id = s.user_id
       JOIN presence_samples p ON p.user_id = s.user_id
        AND p.at = (SELECT MAX(at) FROM presence_samples q WHERE q.user_id = s.user_id AND q.at <= datetime('now', '-' || s.delay_s || ' seconds'))
      WHERE s.user_id != ?1 AND u.handle IS NOT NULL
        AND p.at > datetime('now', '-' || (s.delay_s + ${STALE_AFTER_S}) || ' seconds')
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ?1 AND b.blocked = s.user_id) OR (b.blocker = s.user_id AND b.blocked = ?1))
        AND ( (s.audience = 'friends' AND EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted' AND f.user_a = MIN(s.user_id, ?1) AND f.user_b = MAX(s.user_id, ?1)))
           OR (s.audience = 'crew' AND EXISTS (SELECT 1 FROM crew_members a JOIN crew_members c ON c.crew_id = a.crew_id WHERE a.user_id = ?1 AND c.user_id = s.user_id)) )
      LIMIT 200`).bind(v.id).all<{ handle: string; photo_id: string | null; delay_s: number; fuzz: number; lat: number; lon: number; road: string | null; at: string }>()).results;
  return rows.map((r) => ({ ...r, fuzz: !!r.fuzz, at: r.at.replace(" ", "T") + "Z" }));
}
