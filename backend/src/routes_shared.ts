// Planned routes shared with friends and crews (IDEAS S-05, docs/SOCIAL.md 2.5): the route's shape and name, never a
// recorded drive. Recipients' apps rebuild the pace notes from the shape. Only accepted friends (no block either way) and
// crews you are in; a recipient sees it while that still holds. Routes expire after KEEP_DAYS (the daily sweep).
import type { Viewer } from "./auth";
import { Env, HttpError, body, randomToken } from "./util";
import { cleanText } from "./convoy";

export const MAX_POINTS = 1500, MAX_PER_DAY = 20, MAX_KEPT = 50, KEEP_DAYS = 30, MAX_TO = 15;
const ID_RE = /^[A-Za-z0-9_-]{16}$/;

/** [[lon, lat], …] with 2..MAX_POINTS finite points on Earth, rounded to 5 decimals (about a metre). */
function cleanGeom(g: unknown): number[][] {
  if (!Array.isArray(g) || g.length < 2 || g.length > MAX_POINTS) throw new HttpError(400, "bad_geom");
  return g.map((p) => {
    if (!Array.isArray(p) || p.length !== 2) throw new HttpError(400, "bad_geom");
    const [lon, lat] = p;
    if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 85 || Math.abs(lon) > 180) throw new HttpError(400, "bad_geom");
    return [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5];
  });
}

/** Who may see a route, as SQL on route `r` for viewer ?1: the owner, a friend it was shared to, a member of a crew it was shared to. */
const CAN_SEE = `(r.owner = ?1
  OR (EXISTS (SELECT 1 FROM shared_route_audience a WHERE a.route_id = r.id AND a.audience_type = 'friend' AND a.audience_id = ?1)
      AND EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted' AND f.user_a = MIN(r.owner, ?1) AND f.user_b = MAX(r.owner, ?1)))
  OR EXISTS (SELECT 1 FROM shared_route_audience a JOIN crew_members m ON m.crew_id = a.audience_id AND m.user_id = ?1
             WHERE a.route_id = r.id AND a.audience_type = 'crew'))
  AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ?1 AND b.blocked = r.owner) OR (b.blocker = r.owner AND b.blocked = ?1))
  AND r.created_at > datetime('now', '-${KEEP_DAYS} days')`;

export async function shareRoute(env: Env, v: Viewer, req: Request) {
  const b = await body<{ name?: unknown; geom?: unknown; friends?: unknown; crews?: unknown }>(req);
  const name = cleanText(b.name, 60);
  if (!name || !name.trim()) throw new HttpError(400, "bad_name");
  const geom = cleanGeom(b.geom);
  const friends = Array.isArray(b.friends) ? b.friends : [], crews = Array.isArray(b.crews) ? b.crews : [];
  if (!friends.length && !crews.length) throw new HttpError(400, "no_audience");
  if (friends.length + crews.length > MAX_TO || ![...friends, ...crews].every((x) => typeof x === "string" && x.length <= 64)) throw new HttpError(400, "bad_audience");
  const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM shared_routes WHERE owner = ? AND created_at > datetime('now', '-1 day')").bind(v.id).first<{ n: number }>();
  if ((today?.n ?? 0) >= MAX_PER_DAY) throw new HttpError(429, "too_many_shares");
  // friends by handle: accepted, no block either way; crews by id: ones you are in
  const handles = (friends as string[]).map((h) => h.replace(/^@/, "").toLowerCase());
  const friendIds = handles.length ? (await env.DB.prepare(
    `SELECT u.id FROM users u WHERE u.handle IN (${handles.map((_, i) => `?${i + 2}`).join(",")}) AND u.id != ?1
       AND EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted' AND f.user_a = MIN(u.id, ?1) AND f.user_b = MAX(u.id, ?1))
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ?1 AND b.blocked = u.id) OR (b.blocker = u.id AND b.blocked = ?1))`)
    .bind(v.id, ...handles).all<{ id: string }>()).results.map((r) => r.id) : [];
  const crewIds = crews.length ? (await env.DB.prepare(
    `SELECT crew_id AS id FROM crew_members WHERE user_id = ?1 AND crew_id IN (${(crews as string[]).map((_, i) => `?${i + 2}`).join(",")})`)
    .bind(v.id, ...(crews as string[])).all<{ id: string }>()).results.map((r) => r.id) : [];
  if (!friendIds.length && !crewIds.length) return { id: null, shared: 0 };
  const id = randomToken(12);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO shared_routes (id, owner, name, geom) VALUES (?, ?, ?, ?)").bind(id, v.id, name.trim(), JSON.stringify(geom)),
    ...friendIds.map((f) => env.DB.prepare("INSERT INTO shared_route_audience (route_id, audience_type, audience_id) VALUES (?, 'friend', ?)").bind(id, f)),
    ...crewIds.map((c) => env.DB.prepare("INSERT INTO shared_route_audience (route_id, audience_type, audience_id) VALUES (?, 'crew', ?)").bind(id, c)),
    // keep the newest MAX_KEPT per owner
    env.DB.prepare(`DELETE FROM shared_routes WHERE owner = ?1 AND id NOT IN (SELECT id FROM shared_routes WHERE owner = ?1 ORDER BY created_at DESC, rowid DESC LIMIT ${MAX_KEPT})`).bind(v.id),
  ]);
  return { id, shared: friendIds.length + crewIds.length };
}

/** Routes others shared with you (newest first): no shape here, just enough to pick one. */
export async function routesSharedWithMe(env: Env, v: Viewer) {
  return (await env.DB.prepare(
    `SELECT r.id, r.name, r.created_at, u.handle AS from_handle FROM shared_routes r JOIN users u ON u.id = r.owner
      WHERE r.owner != ?1 AND ${CAN_SEE} ORDER BY r.created_at DESC LIMIT 50`).bind(v.id).all()).results;
}

export async function routeGet(env: Env, v: Viewer, id: string) {
  if (!ID_RE.test(id)) throw new HttpError(404, "no_route");
  const r = await env.DB.prepare(`SELECT r.id, r.name, r.geom, r.created_at, u.handle AS from_handle FROM shared_routes r JOIN users u ON u.id = r.owner
    WHERE r.id = ?2 AND ${CAN_SEE}`).bind(v.id, id).first<{ id: string; name: string; geom: string; created_at: string; from_handle: string | null }>();
  if (!r) throw new HttpError(404, "no_route");
  return { ...r, geom: JSON.parse(r.geom) as number[][] };
}

export async function routeDelete(env: Env, v: Viewer, id: string) {
  await env.DB.prepare("DELETE FROM shared_routes WHERE id = ? AND owner = ?").bind(id, v.id).run();
  return { ok: true };
}
