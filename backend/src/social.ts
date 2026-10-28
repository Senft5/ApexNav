// Friends, blocks, crews, grants and boards. Every function takes the verified viewer; there is no endpoint that
// takes a user id for "whose data to read". Privacy rules (docs/BACKEND.md section 11) are enforced here and tested.
import { Env, HANDLE_RE, HttpError, body, num, pair, randomToken, sha256hex, sqlTime, str } from "./util";
import type { Viewer } from "./auth";
import { reportedSql } from "./safety";

const run = (env: Env, sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).run();
const all = async <T>(env: Env, sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;
const first = <T>(env: Env, sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).first<T>();

export async function isAcceptedFriend(env: Env, a: string, b: string): Promise<boolean> {
  const [x, y] = pair(a, b);
  return !!(await first(env, "SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ? AND status = 'accepted'", x, y));
}
export const isCrewMember = async (env: Env, crewId: string, userId: string) =>
  !!(await first(env, "SELECT 1 FROM crew_members WHERE crew_id = ? AND user_id = ?", crewId, userId));
const isBlocked = async (env: Env, a: string, b: string) =>
  !!(await first(env, "SELECT 1 FROM blocks WHERE (blocker = ?1 AND blocked = ?2) OR (blocker = ?2 AND blocked = ?1)", a, b));

// ---- handle --------------------------------------------------------------------------------------
export async function setHandle(env: Env, v: Viewer, req: Request): Promise<void> {
  const { handle } = await body<{ handle?: string }>(req);
  const h = str(handle, "handle", 3, 20).toLowerCase();
  if (!HANDLE_RE.test(h)) throw new HttpError(400, "bad_handle");
  try {
    await run(env, "UPDATE users SET handle = ? WHERE id = ?", h, v.id);
  } catch {
    throw new HttpError(409, "handle_taken");
  }
}

// ---- friends -------------------------------------------------------------------------------------
/** Same answer whether or not the handle exists, so handles cannot be enumerated. */
export async function friendRequest(env: Env, v: Viewer, req: Request): Promise<void> {
  const { handle } = await body<{ handle?: string }>(req);
  const h = str(handle, "handle", 3, 20).toLowerCase();
  const target = await first<{ id: string }>(env,
    "SELECT u.id FROM users u JOIN members m ON m.user_id = u.id WHERE u.handle = ? AND u.id != ?", h, v.id);
  if (!target || (await isBlocked(env, v.id, target.id))) return;
  const [a, b] = pair(v.id, target.id);
  const existing = await first<{ status: string; requested_by: string }>(env,
    "SELECT status, requested_by FROM friendships WHERE user_a = ? AND user_b = ?", a, b);
  if (!existing) {
    await run(env, "INSERT INTO friendships (user_a, user_b, status, requested_by) VALUES (?, ?, 'pending', ?)", a, b, v.id);
  } else if (existing.status === "pending" && existing.requested_by !== v.id) {
    await run(env, "UPDATE friendships SET status = 'accepted' WHERE user_a = ? AND user_b = ?", a, b);   // they asked first: mutual
  }
}

export async function friendList(env: Env, v: Viewer) {
  return all<{ id: string; handle: string | null; name: string | null; status: string; incoming: number }>(env,
    `SELECT u.id, u.handle, u.display_name AS name, f.status, (f.requested_by != ?1) AS incoming
       FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_a = ?1 THEN f.user_b ELSE f.user_a END
      WHERE f.user_a = ?1 OR f.user_b = ?1 ORDER BY u.handle`, v.id);
}

export async function friendAccept(env: Env, v: Viewer, req: Request): Promise<void> {
  const { user_id } = await body<{ user_id?: string }>(req);
  const [a, b] = pair(v.id, str(user_id, "user_id", 1, 64));
  const r = await run(env,
    "UPDATE friendships SET status = 'accepted' WHERE user_a = ? AND user_b = ? AND status = 'pending' AND requested_by != ?", a, b, v.id);
  if (!r.meta.changes) throw new HttpError(404, "no_request");
}

/** Unfriend / decline / cancel / block: the friendship goes, and with it every grant and published entry between the two. */
export async function removePair(env: Env, me: string, other: string): Promise<void> {
  const [a, b] = pair(me, other);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM friendships WHERE user_a = ? AND user_b = ?").bind(a, b),
    env.DB.prepare("DELETE FROM grants WHERE audience_type = 'friend' AND ((user_id = ?1 AND audience_id = ?2) OR (user_id = ?2 AND audience_id = ?1))").bind(me, other),
    env.DB.prepare("DELETE FROM board_entries WHERE audience_type = 'friend' AND ((user_id = ?1 AND audience_id = ?2) OR (user_id = ?2 AND audience_id = ?1))").bind(me, other),
    env.DB.prepare("DELETE FROM segment_shares WHERE audience_type = 'friend' AND segment_id IN (SELECT id FROM segments WHERE owner = ?1) AND audience_id = ?2").bind(me, other),
    env.DB.prepare("DELETE FROM segment_shares WHERE audience_type = 'friend' AND segment_id IN (SELECT id FROM segments WHERE owner = ?2) AND audience_id = ?1").bind(me, other),
  ]);
}

// ---- crews ---------------------------------------------------------------------------------------
// ---- crews: like groups. Private (the default) = invite link only. Public = listed for people nearby by its area, which the
// owner picks (a name and a point rounded to 0.1 degree, about 11 km); non-members see name, about, area and member count only.
const AREA_STEP = 0.1;
const roundArea = (x: number) => Math.round(x / AREA_STEP) * AREA_STEP;
interface CrewBody { name?: unknown; visibility?: unknown; about?: unknown; area?: { name?: unknown; lat?: unknown; lon?: unknown } | null }
interface CrewSettings { visibility: "private" | "public"; about: string | null; area_name: string | null; area_lat: number | null; area_lon: number | null }
function crewSettings(b: CrewBody): CrewSettings {
  const visibility = b.visibility === "public" ? "public" : b.visibility === undefined || b.visibility === "private" ? "private" : null;
  if (!visibility) throw new HttpError(400, "bad_visibility");
  const about = b.about === undefined || b.about === null || b.about === "" ? null : str(b.about, "about", 1, 200);
  if (visibility === "private") return { visibility, about, area_name: null, area_lat: null, area_lon: null };
  if (!b.area || typeof b.area !== "object") throw new HttpError(400, "public_needs_area");
  return { visibility, about, area_name: str(b.area.name, "area.name", 2, 60),
           area_lat: roundArea(num(b.area.lat, "area.lat", -85, 85)), area_lon: roundArea(num(b.area.lon, "area.lon", -180, 180)) };
}

export async function crewCreate(env: Env, v: Viewer, req: Request): Promise<{ id: string }> {
  const b = await body<CrewBody>(req);
  const name = str(b.name, "name", 2, 40), set = crewSettings(b);
  const n = await first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM crew_members WHERE user_id = ?", v.id);
  if ((n?.n ?? 0) >= 10) throw new HttpError(429, "too_many_crews");
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO crews (id, name, owner, visibility, about, area_name, area_lat, area_lon) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, name, v.id, set.visibility, set.about, set.area_name, set.area_lat, set.area_lon),
    env.DB.prepare("INSERT INTO crew_members (crew_id, user_id, role) VALUES (?, ?, 'owner')").bind(id, v.id),
  ]);
  return { id };
}

/** Owner only: rename, describe, or switch between private and public (with an area). */
export async function crewUpdate(env: Env, v: Viewer, crewId: string, req: Request): Promise<void> {
  const crew = await first<{ owner: string; name: string }>(env, "SELECT owner, name FROM crews WHERE id = ?", crewId);
  if (!crew || crew.owner !== v.id) throw new HttpError(404, "no_crew");
  const b = await body<CrewBody>(req);
  const set = crewSettings(b), name = b.name === undefined ? crew.name : str(b.name, "name", 2, 40);
  await run(env, "UPDATE crews SET name = ?, visibility = ?, about = ?, area_name = ?, area_lat = ?, area_lon = ? WHERE id = ?",
    name, set.visibility, set.about, set.area_name, set.area_lat, set.area_lon, crewId);
}

export const crewList = (env: Env, v: Viewer) => all<{ id: string; name: string; role: string; members: number; visibility: string; about: string | null; area_name: string | null }>(env,
  `SELECT c.id, c.name, m.role, c.visibility, c.about, c.area_name, (SELECT COUNT(*) FROM crew_members x WHERE x.crew_id = c.id) AS members
     FROM crews c JOIN crew_members m ON m.crew_id = c.id WHERE m.user_id = ? ORDER BY c.name`, v.id);

/** Public crews near a point (about 55 km), nearest first; not ones you are in, none whose owner you blocked or who blocked you. */
export async function crewDiscover(env: Env, v: Viewer, url: URL) {
  const lat = num(Number(url.searchParams.get("lat")), "lat", -85, 85), lon = num(Number(url.searchParams.get("lon")), "lon", -180, 180);
  const dLat = 0.5, dLon = 0.5 / Math.max(0.2, Math.cos(lat * Math.PI / 180));
  const rows = await all<{ id: string; name: string; about: string | null; area_name: string; area_lat: number; area_lon: number; members: number }>(env,
    `SELECT c.id, c.name, c.about, c.area_name, c.area_lat, c.area_lon, (SELECT COUNT(*) FROM crew_members x WHERE x.crew_id = c.id) AS members
       FROM crews c
      WHERE c.visibility = 'public' AND c.area_lat BETWEEN ?1 AND ?2 AND c.area_lon BETWEEN ?3 AND ?4
        AND NOT EXISTS (SELECT 1 FROM crew_members m WHERE m.crew_id = c.id AND m.user_id = ?5)
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ?5 AND b.blocked = c.owner) OR (b.blocker = c.owner AND b.blocked = ?5))
        AND NOT ${reportedSql("crew", "c.id")}                       -- reported by several people: off the list until the owner looks
      LIMIT 50`, lat - dLat, lat + dLat, lon - dLon, lon + dLon, v.id);
  const km = (r: { area_lat: number; area_lon: number }) => Math.hypot((r.area_lat - lat) * 111.2, (r.area_lon - lon) * 111.32 * Math.cos(lat * Math.PI / 180));
  return rows.map((r) => ({ id: r.id, name: r.name, about: r.about, area_name: r.area_name, members: r.members, km: Math.round(km(r)) }))
    .sort((a, b) => a.km - b.km).slice(0, 12);
}

/** Join a public crew without an invite (a private one still needs its link). */
export async function crewJoinPublic(env: Env, v: Viewer, crewId: string): Promise<{ id: string }> {
  const crew = await first<{ visibility: string; owner: string }>(env, "SELECT visibility, owner FROM crews WHERE id = ?", crewId);
  if (!crew || crew.visibility !== "public" || (await first(env, `SELECT 1 WHERE ${reportedSql("crew", "?1")}`, crewId))) throw new HttpError(404, "no_crew");
  if (await first(env, "SELECT 1 FROM blocks WHERE (blocker = ?1 AND blocked = ?2) OR (blocker = ?2 AND blocked = ?1)", v.id, crew.owner)) throw new HttpError(404, "no_crew");
  const n = await first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM crew_members WHERE user_id = ?", v.id);
  if ((n?.n ?? 0) >= 10) throw new HttpError(429, "too_many_crews");
  await run(env, "INSERT OR IGNORE INTO crew_members (crew_id, user_id) VALUES (?, ?)", crewId, v.id);
  return { id: crewId };
}

export async function crewMembers(env: Env, v: Viewer, crewId: string) {
  if (!(await isCrewMember(env, crewId, v.id))) throw new HttpError(404, "no_crew");
  return all<{ handle: string | null; name: string | null; role: string; mine: number }>(env,
    `SELECT u.handle, u.display_name AS name, m.role, (m.user_id = ?2) AS mine
       FROM crew_members m JOIN users u ON u.id = m.user_id
      WHERE m.crew_id = ?1
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ?2 AND b.blocked = m.user_id) OR (b.blocker = m.user_id AND b.blocked = ?2))
      ORDER BY m.role DESC, u.handle`, crewId, v.id);
}

export async function crewInvite(env: Env, v: Viewer, crewId: string): Promise<{ token: string }> {
  const crew = await first<{ owner: string }>(env, "SELECT owner FROM crews WHERE id = ?", crewId);
  if (!crew || crew.owner !== v.id) throw new HttpError(404, "no_crew");
  const token = randomToken(24);
  await run(env, "INSERT INTO crew_invites (token_hash, crew_id, created_by, expires_at) VALUES (?, ?, ?, ?)",
    await sha256hex(token), crewId, v.id, sqlTime(Date.now() + 7 * 86400_000));
  return { token };
}

export async function crewJoin(env: Env, v: Viewer, req: Request): Promise<{ id: string }> {
  const { token } = await body<{ token?: string }>(req);
  const inv = await first<{ crew_id: string }>(env,
    "SELECT crew_id FROM crew_invites WHERE token_hash = ? AND expires_at > datetime('now')", await sha256hex(str(token, "token", 10, 100)));
  if (!inv) throw new HttpError(400, "invalid_invite");
  await run(env, "INSERT OR IGNORE INTO crew_members (crew_id, user_id) VALUES (?, ?)", inv.crew_id, v.id);
  return { id: inv.crew_id };
}

/** Leaving removes your grants and published entries for that crew. The owner leaving dissolves the crew. */
export async function crewLeave(env: Env, v: Viewer, crewId: string): Promise<void> {
  const crew = await first<{ owner: string }>(env, "SELECT owner FROM crews WHERE id = ?", crewId);
  if (!crew || !(await isCrewMember(env, crewId, v.id))) throw new HttpError(404, "no_crew");
  const dissolve = crew.owner === v.id;
  await env.DB.batch([
    env.DB.prepare(dissolve ? "DELETE FROM grants WHERE audience_type = 'crew' AND audience_id = ?1" : "DELETE FROM grants WHERE audience_type = 'crew' AND audience_id = ?1 AND user_id = ?2").bind(...(dissolve ? [crewId] : [crewId, v.id])),
    env.DB.prepare(dissolve ? "DELETE FROM board_entries WHERE audience_type = 'crew' AND audience_id = ?1" : "DELETE FROM board_entries WHERE audience_type = 'crew' AND audience_id = ?1 AND user_id = ?2").bind(...(dissolve ? [crewId] : [crewId, v.id])),
    env.DB.prepare(dissolve ? "DELETE FROM segment_shares WHERE audience_type = 'crew' AND audience_id = ?1" : "DELETE FROM segment_shares WHERE audience_type = 'crew' AND audience_id = ?1 AND segment_id IN (SELECT id FROM segments WHERE owner = ?2)").bind(...(dissolve ? [crewId] : [crewId, v.id])),
    env.DB.prepare(dissolve ? "DELETE FROM crews WHERE id = ?1" : "DELETE FROM crew_members WHERE crew_id = ?1 AND user_id = ?2").bind(...(dissolve ? [crewId] : [crewId, v.id])),
  ]);
}

// ---- grants: opt-in, one row per friend or crew --------------------------------------------------
export async function setGrant(env: Env, v: Viewer, req: Request): Promise<void> {
  const b = await body<{ audience_type?: string; audience_id?: string; share_scores?: boolean; share_times?: boolean }>(req);
  const type = b.audience_type, id = str(b.audience_id, "audience_id", 1, 64);
  if (type !== "friend" && type !== "crew") throw new HttpError(400, "bad_audience_type");
  const allowed = type === "friend" ? await isAcceptedFriend(env, v.id, id) : await isCrewMember(env, id, v.id);
  if (!allowed) throw new HttpError(404, "no_audience");
  const times = b.share_times === true, scores = b.share_scores === true || times;   // sharing times implies sharing scores
  if (!scores) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM grants WHERE user_id = ? AND audience_type = ? AND audience_id = ?").bind(v.id, type, id),
      env.DB.prepare("DELETE FROM board_entries WHERE user_id = ? AND audience_type = ? AND audience_id = ?").bind(v.id, type, id),
    ]);
    return;
  }
  const stmts = [
    env.DB.prepare(
      `INSERT INTO grants (user_id, audience_type, audience_id, share_scores, share_times) VALUES (?1, ?2, ?3, 1, ?4)
       ON CONFLICT (user_id, audience_type, audience_id) DO UPDATE SET share_scores = 1, share_times = ?4`).bind(v.id, type, id, times ? 1 : 0),
  ];
  if (!times) stmts.push(env.DB.prepare("UPDATE board_entries SET time_s = NULL WHERE user_id = ? AND audience_type = ? AND audience_id = ?").bind(v.id, type, id));
  await env.DB.batch(stmts);
}

export const myGrants = (env: Env, v: Viewer) => all(env,
  "SELECT audience_type, audience_id, share_scores, share_times FROM grants WHERE user_id = ?", v.id);

// ---- boards --------------------------------------------------------------------------------------
/** Publishes one result to every audience the owner has opted into, and only those. */
export async function publish(env: Env, v: Viewer, req: Request): Promise<{ published: number }> {
  const b = await body<{ segment_id?: string; driver_score?: number; time_s?: number | null; driven_on?: string }>(req);
  const seg = await first<{ id: string; origin_id: string | null }>(env,
    "SELECT id, origin_id FROM segments WHERE id = ? AND owner = ?", str(b.segment_id, "segment_id", 1, 64), v.id);
  if (!seg) throw new HttpError(404, "no_segment");
  const score = b.driver_score;
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 1000) throw new HttpError(400, "bad_driver_score");
  const day = str(b.driven_on, "driven_on", 10, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, "bad_driven_on");
  const time = b.time_s == null ? null : b.time_s;
  if (time !== null && (!Number.isInteger(time) || time < 1 || time > 36000)) throw new HttpError(400, "bad_time_s");

  const grants = await all<{ audience_type: string; audience_id: string; share_times: number }>(env,
    "SELECT audience_type, audience_id, share_times FROM grants WHERE user_id = ? AND share_scores = 1", v.id);
  const stmts: D1PreparedStatement[] = [];
  for (const g of grants) {
    const ok = g.audience_type === "friend" ? await isAcceptedFriend(env, v.id, g.audience_id) : await isCrewMember(env, g.audience_id, v.id);
    if (!ok) continue;
    stmts.push(env.DB.prepare(
      `INSERT INTO board_entries (id, segment_id, canon_id, user_id, audience_type, audience_id, driver_score, time_s, driven_on)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT (segment_id, user_id, audience_type, audience_id, driven_on)
       DO UPDATE SET driver_score = ?7, time_s = ?8`,
    ).bind(crypto.randomUUID(), seg.id, seg.origin_id ?? seg.id, v.id, g.audience_type, g.audience_id, score, g.share_times ? time : null, day));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return { published: stmts.length };
}

/** Only entries published TO the viewer (by someone who is still their friend / crew-mate, grant still on), plus their own. */
export async function boardFor(env: Env, v: Viewer, canonId: string) {
  return all<{ user_id: string; handle: string | null; name: string | null; driver_score: number; time_s: number | null; driven_on: string; mine: number }>(env,
    `SELECT be.user_id, u.handle, u.display_name AS name, MAX(be.driver_score) AS driver_score, MIN(be.time_s) AS time_s,
            MAX(be.driven_on) AS driven_on, (be.user_id = ?1) AS mine
       FROM board_entries be JOIN users u ON u.id = be.user_id
      WHERE be.canon_id = ?2
        AND (be.user_id = ?1
          OR ( NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ?1 AND b.blocked = be.user_id) OR (b.blocker = be.user_id AND b.blocked = ?1))
               AND EXISTS (SELECT 1 FROM grants g WHERE g.user_id = be.user_id AND g.audience_type = be.audience_type AND g.audience_id = be.audience_id AND g.share_scores = 1)
               AND ( (be.audience_type = 'friend' AND be.audience_id = ?1
                      AND EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted'
                                   AND f.user_a = MIN(be.user_id, ?1) AND f.user_b = MAX(be.user_id, ?1)))
                  OR (be.audience_type = 'crew'
                      AND EXISTS (SELECT 1 FROM crew_members me WHERE me.crew_id = be.audience_id AND me.user_id = ?1)
                      AND EXISTS (SELECT 1 FROM crew_members th WHERE th.crew_id = be.audience_id AND th.user_id = be.user_id)) ) ))
      GROUP BY be.user_id ORDER BY driver_score DESC LIMIT 100`, v.id, canonId);
}
