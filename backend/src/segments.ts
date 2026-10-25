import { Env, HttpError, body, num, str } from "./util";
import type { Viewer } from "./auth";
import { isAcceptedFriend, isCrewMember } from "./social";

const MAX_SEGMENTS = 200;
const first = <T>(env: Env, sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a).first<T>();
const all = async <T>(env: Env, sql: string, ...a: unknown[]) => (await env.DB.prepare(sql).bind(...a).all<T>()).results;

export async function segmentCreate(env: Env, v: Viewer, req: Request): Promise<{ id: string }> {
  const b = await body<Record<string, unknown>>(req);
  const n = await first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM segments WHERE owner = ?", v.id);
  if ((n?.n ?? 0) >= MAX_SEGMENTS) throw new HttpError(429, "too_many_segments");
  const id = typeof b.id === "string" && b.id.length <= 64 ? b.id : crypto.randomUUID();   // clients may supply their local id so sync is idempotent
  await env.DB.prepare(
    `INSERT INTO segments (id, owner, name, length_m, geom, start_lat, start_lon, end_lat, end_lon) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
  ).bind(id, v.id, str(b.name, "name", 1, 80), num(b.length_m, "length_m", 100, 200_000), str(b.geom, "geom", 2, 20_000),
    num(b.start_lat, "start_lat", -90, 90), num(b.start_lon, "start_lon", -180, 180), num(b.end_lat, "end_lat", -90, 90), num(b.end_lon, "end_lon", -180, 180)).run();
  // an id that already exists but belongs to someone else must not be silently accepted
  const mine = await first(env, "SELECT 1 FROM segments WHERE id = ? AND owner = ?", id, v.id);
  if (!mine) throw new HttpError(409, "id_taken");
  return { id };
}

export const segmentList = (env: Env, v: Viewer) => all(env,
  "SELECT id, name, length_m, geom, start_lat, start_lon, end_lat, end_lon, origin_id, created_at FROM segments WHERE owner = ? ORDER BY created_at DESC", v.id);

export async function segmentDelete(env: Env, v: Viewer, id: string): Promise<void> {
  const r = await env.DB.prepare("DELETE FROM segments WHERE id = ? AND owner = ?").bind(id, v.id).run();
  if (!r.meta.changes) throw new HttpError(404, "no_segment");
}

/** Share the stretch itself (its geometry and name) with a friend or crew so they can adopt it. Scores are separate (grants). */
export async function segmentShare(env: Env, v: Viewer, id: string, req: Request): Promise<void> {
  const b = await body<{ audience_type?: string; audience_id?: string }>(req);
  const type = b.audience_type, aud = str(b.audience_id, "audience_id", 1, 64);
  if (type !== "friend" && type !== "crew") throw new HttpError(400, "bad_audience_type");
  if (!(await first(env, "SELECT 1 FROM segments WHERE id = ? AND owner = ?", id, v.id))) throw new HttpError(404, "no_segment");
  const ok = type === "friend" ? await isAcceptedFriend(env, v.id, aud) : await isCrewMember(env, aud, v.id);
  if (!ok) throw new HttpError(404, "no_audience");
  await env.DB.prepare("INSERT OR IGNORE INTO segment_shares (segment_id, audience_type, audience_id) VALUES (?, ?, ?)").bind(id, type, aud).run();
}

/** Segments other people shared with me (still friends / still crew-mates). */
export const segmentsSharedWithMe = (env: Env, v: Viewer) => all(env,
  `SELECT s.id, COALESCE(s.origin_id, s.id) AS canon_id, s.name, s.length_m, s.geom, s.start_lat, s.start_lon, s.end_lat, s.end_lon,
          u.handle AS from_handle
     FROM segment_shares sh JOIN segments s ON s.id = sh.segment_id JOIN users u ON u.id = s.owner
    WHERE s.owner != ?1 AND (
          (sh.audience_type = 'friend' AND sh.audience_id = ?1 AND EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted'
                 AND f.user_a = MIN(s.owner, ?1) AND f.user_b = MAX(s.owner, ?1)))
       OR (sh.audience_type = 'crew' AND EXISTS (SELECT 1 FROM crew_members me WHERE me.crew_id = sh.audience_id AND me.user_id = ?1)))
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ?1 AND b.blocked = s.owner) OR (b.blocker = s.owner AND b.blocked = ?1))
    GROUP BY canon_id ORDER BY s.name`, v.id);

/** Copies a shared segment into my own list, linked by origin_id so boards line up. */
export async function segmentAdopt(env: Env, v: Viewer, req: Request): Promise<{ id: string }> {
  const { segment_id } = await body<{ segment_id?: string }>(req);
  const shared = (await segmentsSharedWithMe(env, v) as { id: string; canon_id: string; name: string; length_m: number; geom: string; start_lat: number; start_lon: number; end_lat: number; end_lon: number }[])
    .find((s) => s.id === segment_id || s.canon_id === segment_id);
  if (!shared) throw new HttpError(404, "no_segment");
  const have = await first<{ id: string }>(env, "SELECT id FROM segments WHERE owner = ? AND (origin_id = ? OR id = ?)", v.id, shared.canon_id, shared.canon_id);
  if (have) return { id: have.id };
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO segments (id, owner, name, length_m, geom, start_lat, start_lon, end_lat, end_lon, origin_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(id, v.id, shared.name, shared.length_m, shared.geom, shared.start_lat, shared.start_lon, shared.end_lat, shared.end_lon, shared.canon_id).run();
  return { id };
}
