// Crew drives (IDEAS S-06): a planned drive for one crew. Any member plans one (a time, a meeting point, an optional route
// already shared with the crew, a line of notes); members say going / maybe / no and see who's going by handle. The one who
// planned it or the crew's owner cancels it. On the day the app offers the planner a convoy with the people going.
// Members of that crew only; a drive hidden by reports or removed by the owner (moderation) shows to no one.
import type { Viewer } from "./auth";
import { Env, HttpError, body, num, randomToken } from "./util";
import { cleanText } from "./convoy";
import { isCrewMember } from "./social";
import { reportedSql } from "./reports_sql";
import { atLeast, tierOf } from "./livery";

export const MAX_UPCOMING = 10, MAX_AHEAD_DAYS = 30, SHOW_AFTER_START_H = 6, KEEP_AFTER_START_DAYS = 7, MAX_REGROUP = 5;
export const ROLES = ["lead", "sweep"] as const;
const ID_RE = /^[A-Za-z0-9_-]{16}$/;
const STATUSES = ["going", "maybe", "no"] as const;

/** ISO time (with zone) → D1's UTC 'YYYY-MM-DD HH:MM:SS'; from the next 10 minutes to MAX_AHEAD_DAYS out. */
function startsAt(v: unknown, now = Date.now()): string {
  if (typeof v !== "string" || v.length > 40) throw new HttpError(400, "bad_starts_at");
  const t = Date.parse(v);
  if (!Number.isFinite(t) || !/[zZ]|[+-]\d\d:?\d\d$/.test(v)) throw new HttpError(400, "bad_starts_at");   // a zone, or the time is a guess
  if (t < now + 10 * 60_000 || t > now + MAX_AHEAD_DAYS * 86400_000) throw new HttpError(400, "bad_starts_at");
  return new Date(t).toISOString().slice(0, 19).replace("T", " ");
}

/** Regroup points (roadmap 21): at most MAX_REGROUP, each a short name and a place. */
function regroupPoints(v: unknown): { name: string; lat: number; lon: number }[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > MAX_REGROUP) throw new HttpError(400, "bad_regroup");
  return v.map((p) => {
    if (!p || typeof p !== "object") throw new HttpError(400, "bad_regroup");
    const o = p as { name?: unknown; lat?: unknown; lon?: unknown };
    const name = cleanText(o.name, 40)?.trim();
    if (!name) throw new HttpError(400, "bad_regroup");
    return { name, lat: Math.round(num(o.lat, "regroup", -85, 85) * 1e5) / 1e5, lon: Math.round(num(o.lon, "regroup", -180, 180) * 1e5) / 1e5 };
  });
}
/** A member of the crew by handle, for a role; null when none was asked. */
async function roleHolder(env: Env, crewId: string, handle: unknown): Promise<string | null> {
  if (handle === undefined || handle === null || handle === "") return null;
  if (typeof handle !== "string" || handle.length > 20) throw new HttpError(400, "bad_role");
  const u = await env.DB.prepare("SELECT u.id FROM users u JOIN crew_members m ON m.user_id = u.id AND m.crew_id = ? WHERE u.handle = ?")
    .bind(crewId, handle.toLowerCase()).first<{ id: string }>();
  if (!u) throw new HttpError(400, "bad_role");
  return u.id;
}

const VISIBLE = (e: string) => `${e}.cancelled = 0 AND NOT ${reportedSql("event", `${e}.id`)}`;

export async function eventCreate(env: Env, v: Viewer, crewId: string, req: Request) {
  if (!(await isCrewMember(env, crewId, v.id))) throw new HttpError(404, "no_crew");
  const b = await body<{ title?: unknown; starts_at?: unknown; meet?: { name?: unknown; lat?: unknown; lon?: unknown }; route_id?: unknown; notes?: unknown; public?: unknown;
    lead?: unknown; sweep?: unknown; regroup?: unknown }>(req);
  const title = cleanText(b.title, 60)?.trim();
  if (!title) throw new HttpError(400, "bad_title");
  const when = startsAt(b.starts_at);
  const meet = b.meet && typeof b.meet === "object" ? b.meet : {};
  const lat = num(meet.lat, "meet", -85, 85), lon = num(meet.lon, "meet", -180, 180);
  const meetName = meet.name === undefined || meet.name === null || meet.name === "" ? null : cleanText(meet.name, 60)?.trim() || null;
  if (meet.name && !meetName) throw new HttpError(400, "bad_meet");
  const notes = b.notes === undefined || b.notes === null || b.notes === "" ? null : cleanText(b.notes, 280)?.trim() || null;
  if (b.notes && !notes) throw new HttpError(400, "bad_notes");
  let routeId: string | null = null;
  if (b.route_id !== undefined && b.route_id !== null) {
    // a route the planner shared with this crew (S-05), so every member can open it
    if (typeof b.route_id !== "string" || !ID_RE.test(b.route_id)) throw new HttpError(400, "bad_route");
    const ok = await env.DB.prepare(`SELECT 1 AS ok FROM shared_routes r JOIN shared_route_audience a ON a.route_id = r.id
      WHERE r.id = ? AND r.owner = ? AND a.audience_type = 'crew' AND a.audience_id = ?`).bind(b.route_id, v.id, crewId).first();
    if (!ok) throw new HttpError(400, "bad_route");
    routeId = b.route_id;
  }
  // listed for everyone nearby (S-13): only a public crew's drive
  if (b.public !== undefined && typeof b.public !== "boolean") throw new HttpError(400, "bad_public");
  const listed = b.public === true;
  if (listed) {
    const c = await env.DB.prepare("SELECT visibility FROM crews WHERE id = ?").bind(crewId).first<{ visibility: string }>();
    if (!c || c.visibility !== "public") throw new HttpError(400, "not_public_crew");
  }
  const regroup = regroupPoints(b.regroup);
  // the planner leads unless they name someone; nobody sweeps until someone is named or volunteers
  const lead = b.lead === undefined ? v.id : await roleHolder(env, crewId, b.lead), sweep = await roleHolder(env, crewId, b.sweep);
  if (lead && lead === sweep) throw new HttpError(400, "bad_role");
  const upcoming = await env.DB.prepare("SELECT COUNT(*) AS n FROM crew_events WHERE crew_id = ? AND cancelled = 0 AND starts_at > datetime('now')")
    .bind(crewId).first<{ n: number }>();
  if ((upcoming?.n ?? 0) >= MAX_UPCOMING) throw new HttpError(429, "too_many_events");
  const id = randomToken(12);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO crew_events (id, crew_id, created_by, title, starts_at, meet_name, meet_lat, meet_lon, route_id, notes, public, lead_id, sweep_id, regroup)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, crewId, v.id, title, when, meetName, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, routeId, notes, listed ? 1 : 0,
      lead, sweep, JSON.stringify(regroup)),
    env.DB.prepare("INSERT INTO crew_event_rsvps (event_id, user_id, status) VALUES (?, ?, 'going')").bind(id, v.id),
  ]);
  return { id };
}

interface EventRow { id: string; crew_id: string; crew_name: string; title: string; starts_at: string; meet_name: string | null; meet_lat: number; meet_lon: number;
  route_id: string | null; notes: string | null; public: number; by_handle: string | null; mine: number; can_cancel: number; my_rsvp: string | null; going: string; maybe: number;
  lead: string | null; sweep: string | null; regroup: string; call_sign: string | null }

/** Upcoming drives (from SHOW_AFTER_START_H ago) in one crew, or in all your crews; each with who's going (handles). */
export async function eventsList(env: Env, v: Viewer, crewId: string | null) {
  if (crewId && !(await isCrewMember(env, crewId, v.id))) throw new HttpError(404, "no_crew");
  const rows = (await env.DB.prepare(
    `SELECT e.id, e.crew_id, c.name AS crew_name, e.title, e.starts_at, e.meet_name, e.meet_lat, e.meet_lon, e.route_id, e.notes, e.public,
            u.handle AS by_handle, (e.created_by = ?1) AS mine, e.regroup, c.call_sign,
            (SELECT lu.handle FROM users lu JOIN crew_members lm ON lm.user_id = lu.id AND lm.crew_id = e.crew_id WHERE lu.id = e.lead_id) AS lead,
            (SELECT su.handle FROM users su JOIN crew_members sm ON sm.user_id = su.id AND sm.crew_id = e.crew_id WHERE su.id = e.sweep_id) AS sweep, (e.created_by = ?1 OR c.owner = ?1) AS can_cancel,
            (SELECT status FROM crew_event_rsvps r WHERE r.event_id = e.id AND r.user_id = ?1) AS my_rsvp,
            (SELECT json_group_array(COALESCE(gu.handle, '?')) FROM crew_event_rsvps g JOIN users gu ON gu.id = g.user_id
               JOIN crew_members gm ON gm.crew_id = e.crew_id AND gm.user_id = g.user_id
              WHERE g.event_id = e.id AND g.status = 'going'
                AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ?1 AND b.blocked = g.user_id) OR (b.blocker = g.user_id AND b.blocked = ?1))) AS going,
            (SELECT COUNT(*) FROM crew_event_rsvps m JOIN crew_members mm ON mm.crew_id = e.crew_id AND mm.user_id = m.user_id WHERE m.event_id = e.id AND m.status = 'maybe') AS maybe
       FROM crew_events e JOIN crews c ON c.id = e.crew_id JOIN crew_members me ON me.crew_id = e.crew_id AND me.user_id = ?1
       LEFT JOIN users u ON u.id = e.created_by
      WHERE ${VISIBLE("e")} AND e.starts_at > datetime('now', '-${SHOW_AFTER_START_H} hours') ${crewId ? "AND e.crew_id = ?2" : ""}
      ORDER BY e.starts_at LIMIT 50`).bind(...(crewId ? [v.id, crewId] : [v.id])).all<EventRow>()).results;
  // the crew's convoy call sign is Works livery (REVIEW.md 5.1): shown only while the crew's tier reaches it
  const works = new Map<string, boolean>();
  for (const id of new Set(rows.filter((r) => r.call_sign).map((r) => r.crew_id))) works.set(id, atLeast(await tierOf(env, id), "works"));
  return rows.map((r) => ({ ...r, call_sign: r.call_sign && works.get(r.crew_id) ? r.call_sign : null, public: !!r.public, mine: !!r.mine, can_cancel: !!r.can_cancel, starts_at: r.starts_at.replace(" ", "T") + "Z", going: JSON.parse(r.going) as string[],
    regroup: JSON.parse(r.regroup || "[]") as { name: string; lat: number; lon: number }[] }));
}

export const NEAR_KM = 80;
/**
 * Meets near a point (S-13): public crews' listed drives coming up within NEAR_KM, nearest first, for any member. No handles
 * here (the crew's members are its own business): how many are going, and whether you're in the crew already. A crew
 * that goes private, a block either way with the planner, or enough reports takes it off.
 */
export async function eventsNear(env: Env, v: Viewer, url: URL) {
  const q = (k: string) => { const s = url.searchParams.get(k); return s === null || s.trim() === "" ? NaN : Number(s); };
  const lat = num(q("lat"), "lat", -85, 85), lon = num(q("lon"), "lon", -180, 180);
  const dLat = NEAR_KM / 111.2, dLon = NEAR_KM / (111.32 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  const rows = (await env.DB.prepare(
    `SELECT e.id, e.crew_id, c.name AS crew_name, e.title, e.starts_at, e.meet_name, e.meet_lat, e.meet_lon, e.notes,
            (SELECT COUNT(*) FROM crew_event_rsvps g JOIN crew_members gm ON gm.crew_id = e.crew_id AND gm.user_id = g.user_id
              WHERE g.event_id = e.id AND g.status = 'going') AS going,
            EXISTS (SELECT 1 FROM crew_members me WHERE me.crew_id = e.crew_id AND me.user_id = ?1) AS member
       FROM crew_events e JOIN crews c ON c.id = e.crew_id
      WHERE e.public = 1 AND ${VISIBLE("e")} AND c.visibility = 'public' AND NOT ${reportedSql("crew", "c.id")}
        AND e.starts_at > datetime('now') AND e.meet_lat BETWEEN ?2 AND ?3 AND e.meet_lon BETWEEN ?4 AND ?5
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ?1 AND b.blocked = e.created_by) OR (b.blocker = e.created_by AND b.blocked = ?1))
      ORDER BY e.starts_at LIMIT 100`).bind(v.id, lat - dLat, lat + dLat, lon - dLon, lon + dLon)
    .all<{ id: string; crew_id: string; crew_name: string; title: string; starts_at: string; meet_name: string | null; meet_lat: number; meet_lon: number; notes: string | null; going: number; member: number }>()).results;
  const km = (r: { meet_lat: number; meet_lon: number }) => Math.hypot((r.meet_lat - lat) * 111.2, (r.meet_lon - lon) * 111.32 * Math.cos(lat * Math.PI / 180));
  return rows.map((r) => ({ ...r, member: !!r.member, starts_at: r.starts_at.replace(" ", "T") + "Z", km: Math.round(km(r)) }))
    .filter((r) => r.km <= NEAR_KM).slice(0, 20);
}

async function visibleEvent(env: Env, v: Viewer, id: string) {
  if (!ID_RE.test(id)) throw new HttpError(404, "no_event");
  const e = await env.DB.prepare(`SELECT e.id, e.crew_id, e.created_by, c.owner FROM crew_events e JOIN crews c ON c.id = e.crew_id
      JOIN crew_members me ON me.crew_id = e.crew_id AND me.user_id = ?2 WHERE e.id = ?1 AND ${VISIBLE("e")}`)
    .bind(id, v.id).first<{ id: string; crew_id: string; created_by: string; owner: string }>();
  if (!e) throw new HttpError(404, "no_event");
  return e;
}

export async function eventRsvp(env: Env, v: Viewer, id: string, req: Request) {
  await visibleEvent(env, v, id);
  const { status } = await body<{ status?: unknown }>(req);
  const s = STATUSES.find((x) => x === status);
  if (!s) throw new HttpError(400, "bad_status");
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO crew_event_rsvps (event_id, user_id, status) VALUES (?, ?, ?)
      ON CONFLICT (event_id, user_id) DO UPDATE SET status = excluded.status, updated_at = datetime('now')`).bind(id, v.id, s),
    // not going any more: a role you held opens up for someone else
    ...(s === "going" ? [] : [env.DB.prepare(`UPDATE crew_events SET lead_id = CASE WHEN lead_id = ?2 THEN NULL ELSE lead_id END,
      sweep_id = CASE WHEN sweep_id = ?2 THEN NULL ELSE sweep_id END WHERE id = ?1`).bind(id, v.id)]),
  ]);
}

/** POST /api/events/:id/role { role: lead | sweep, take }: take an open role (you're going, then), or give yours up; the planner
 *  or the crew's owner may also clear anyone's. */
export async function eventRole(env: Env, v: Viewer, id: string, req: Request) {
  const e = await visibleEvent(env, v, id);
  const b = await body<{ role?: unknown; take?: unknown }>(req);
  const role = ROLES.find((r) => r === b.role);
  if (!role || typeof b.take !== "boolean") throw new HttpError(400, "bad_role");
  const col = role === "lead" ? "lead_id" : "sweep_id", other = role === "lead" ? "sweep_id" : "lead_id";
  if (b.take) {
    const r = await env.DB.prepare(`UPDATE crew_events SET ${col} = ?2 WHERE id = ?1 AND (${col} IS NULL OR ${col} NOT IN (SELECT user_id FROM crew_members WHERE crew_id = ?3))
        AND (${other} IS NULL OR ${other} != ?2)`).bind(id, v.id, e.crew_id).run();
    if (!r.meta.changes) throw new HttpError(409, "role_taken");
    await env.DB.prepare(`INSERT INTO crew_event_rsvps (event_id, user_id, status) VALUES (?, ?, 'going')
      ON CONFLICT (event_id, user_id) DO UPDATE SET status = 'going', updated_at = datetime('now')`).bind(id, v.id).run();
    return;
  }
  const boss = e.created_by === v.id || e.owner === v.id;
  const r = await env.DB.prepare(`UPDATE crew_events SET ${col} = NULL WHERE id = ?1 AND ${col} IS NOT NULL ${boss ? "" : `AND ${col} = ?2`}`).bind(...(boss ? [id] : [id, v.id])).run();
  if (!r.meta.changes) throw new HttpError(404, "not_yours");
}

/** The planner or the crew's owner. Kept (cancelled) until the sweep, so the members' lists just drop it. */
export async function eventCancel(env: Env, v: Viewer, id: string) {
  const e = await visibleEvent(env, v, id);
  if (e.created_by !== v.id && e.owner !== v.id) throw new HttpError(403, "not_yours");
  await env.DB.prepare("UPDATE crew_events SET cancelled = 1 WHERE id = ?").bind(id).run();
}
