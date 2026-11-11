// Crew drives (IDEAS S-06): a planned drive for one crew. Any member plans one (a time, a meeting point, an optional route
// already shared with the crew, a line of notes); members say going / maybe / no and see who's going by handle. The one who
// planned it or the crew's owner cancels it. On the day the app offers the planner a convoy with the people going.
// Members of that crew only; a drive hidden by reports or removed by the owner (moderation) shows to no one.
import type { Viewer } from "./auth";
import { CELL_COVER_KM, Env, HttpError, body, nearCell, num, randomToken } from "./util";
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

export const REPEATS = [1, 2, 4] as const, ROLL_MAX = 50;
/** repeat_weeks from a request: 1, 2 or 4 weeks, or null (once). */
function repeatOf(x: unknown): number | null {
  if (x === undefined || x === null || x === 0) return null;
  if (!(REPEATS as readonly unknown[]).includes(x)) throw new HttpError(400, "bad_repeat");
  return x as number;
}
/** The next date of a series: the same UTC time, `weeks` later, stepped on until it is in the future. Pure. */
export function nextStart(startsAt: string, weeks: number, nowMs: number): string {
  let t = Date.parse(startsAt.replace(" ", "T") + "Z");
  const step = weeks * 7 * 86400000;
  do t += step; while (t <= nowMs);
  return new Date(t).toISOString().slice(0, 19).replace("T", " ");
}
/**
 * Recurring meets (S-13): each series' latest drive that has started plans the next one (same crew, planner, title, meet,
 * route, notes, listing and regroup; the planner going, no other answers or roles carried) and hands it the repeat.
 * Never while the planner has left the crew, nor for a cancelled or reported drive. Run on read and in the daily sweep;
 * a guard on series_id means two at once plan it once.
 */
export async function rollRepeats(env: Env): Promise<number> {
  const due = (await env.DB.prepare(
    `SELECT e.id, e.crew_id, e.created_by, e.title, e.starts_at, e.meet_name, e.meet_lat, e.meet_lon, e.route_id, e.notes, e.public, e.regroup, e.repeat_weeks, COALESCE(e.series_id, e.id) AS series
       FROM crew_events e WHERE e.repeat_weeks IS NOT NULL AND e.starts_at <= datetime('now') AND ${VISIBLE("e")}
        AND EXISTS (SELECT 1 FROM crew_members m WHERE m.crew_id = e.crew_id AND m.user_id = e.created_by) LIMIT ${ROLL_MAX}`)
    .all<{ id: string; crew_id: string; created_by: string; title: string; starts_at: string; meet_name: string | null; meet_lat: number; meet_lon: number; route_id: string | null;
      notes: string | null; public: number; regroup: string; repeat_weeks: number; series: string }>()).results;
  let n = 0;
  for (const e of due) {
    const claim = await env.DB.prepare("UPDATE crew_events SET repeat_weeks = NULL, series_id = ? WHERE id = ? AND repeat_weeks IS NOT NULL").bind(e.series, e.id).run();
    if (!claim.meta.changes) continue;                               // another request planned it
    const id = randomToken(12);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO crew_events (id, crew_id, created_by, title, starts_at, meet_name, meet_lat, meet_lon, route_id, notes, public, lead_id, regroup, repeat_weeks, series_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, e.crew_id, e.created_by, e.title, nextStart(e.starts_at, e.repeat_weeks, Date.now()), e.meet_name, e.meet_lat, e.meet_lon,
        e.route_id, e.notes, e.public, e.created_by, e.regroup, e.repeat_weeks, e.series),
      env.DB.prepare("INSERT INTO crew_event_rsvps (event_id, user_id, status) VALUES (?, ?, 'going')").bind(id, e.created_by),
    ]);
    n++;
  }
  return n;
}

export async function eventCreate(env: Env, v: Viewer, crewId: string, req: Request) {
  if (!(await isCrewMember(env, crewId, v.id))) throw new HttpError(404, "no_crew");
  const b = await body<{ title?: unknown; starts_at?: unknown; meet?: { name?: unknown; lat?: unknown; lon?: unknown }; route_id?: unknown; notes?: unknown; public?: unknown;
    lead?: unknown; sweep?: unknown; regroup?: unknown; repeat_weeks?: unknown }>(req);
  const repeat = repeatOf(b.repeat_weeks);
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
    env.DB.prepare(`INSERT INTO crew_events (id, crew_id, created_by, title, starts_at, meet_name, meet_lat, meet_lon, route_id, notes, public, lead_id, sweep_id, regroup, repeat_weeks, series_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, crewId, v.id, title, when, meetName, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, routeId, notes, listed ? 1 : 0,
      lead, sweep, JSON.stringify(regroup), repeat, repeat ? id : null),
    env.DB.prepare("INSERT INTO crew_event_rsvps (event_id, user_id, status) VALUES (?, ?, 'going')").bind(id, v.id),
  ]);
  return { id };
}

interface EventRow { id: string; crew_id: string; crew_name: string; title: string; starts_at: string; meet_name: string | null; meet_lat: number; meet_lon: number;
  route_id: string | null; notes: string | null; public: number; by_handle: string | null; mine: number; can_cancel: number; my_rsvp: string | null; going: string; maybe: number;
  lead: string | null; sweep: string | null; regroup: string; call_sign: string | null; repeat_weeks: number | null; series_id: string | null }

/** Upcoming drives (from SHOW_AFTER_START_H ago) in one crew, or in all your crews; each with who's going (handles). */
export async function eventsList(env: Env, v: Viewer, crewId: string | null) {
  if (crewId && !(await isCrewMember(env, crewId, v.id))) throw new HttpError(404, "no_crew");
  await rollRepeats(env);
  const rows = (await env.DB.prepare(
    `SELECT e.id, e.crew_id, c.name AS crew_name, e.title, e.starts_at, e.meet_name, e.meet_lat, e.meet_lon, e.route_id, e.notes, e.public,
            u.handle AS by_handle, (e.created_by = ?1) AS mine, e.regroup, c.call_sign, e.repeat_weeks, e.series_id,
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
  const { lat, lon } = nearCell(url);                                     // VI-1: the 0.1-degree cell, never the point
  await rollRepeats(env);
  const reach = NEAR_KM + CELL_COVER_KM;
  const dLat = reach / 111.2, dLon = reach / (111.32 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  const rows = (await env.DB.prepare(
    `SELECT e.id, e.crew_id, c.name AS crew_name, e.title, e.starts_at, e.meet_name, e.meet_lat, e.meet_lon, e.notes, e.repeat_weeks,
            (SELECT COUNT(*) FROM crew_event_rsvps g JOIN crew_members gm ON gm.crew_id = e.crew_id AND gm.user_id = g.user_id
              WHERE g.event_id = e.id AND g.status = 'going') AS going,
            EXISTS (SELECT 1 FROM crew_members me WHERE me.crew_id = e.crew_id AND me.user_id = ?1) AS member
       FROM crew_events e JOIN crews c ON c.id = e.crew_id
      WHERE e.public = 1 AND ${VISIBLE("e")} AND c.visibility = 'public' AND NOT ${reportedSql("crew", "c.id")}
        AND e.starts_at > datetime('now') AND e.meet_lat BETWEEN ?2 AND ?3 AND e.meet_lon BETWEEN ?4 AND ?5
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ?1 AND b.blocked = e.created_by) OR (b.blocker = e.created_by AND b.blocked = ?1))
      ORDER BY e.starts_at LIMIT 100`).bind(v.id, lat - dLat, lat + dLat, lon - dLon, lon + dLon)
    .all<{ id: string; crew_id: string; crew_name: string; title: string; starts_at: string; meet_name: string | null; meet_lat: number; meet_lon: number; notes: string | null; repeat_weeks: number | null; going: number; member: number }>()).results;
  const km = (r: { meet_lat: number; meet_lon: number }) => Math.hypot((r.meet_lat - lat) * 111.2, (r.meet_lon - lon) * 111.32 * Math.cos(lat * Math.PI / 180));
  return rows.map((r) => ({ ...r, member: !!r.member, starts_at: r.starts_at.replace(" ", "T") + "Z", km: Math.round(km(r)) }))
    .filter((r) => r.km <= reach).slice(0, 20);
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

/** PUT /api/events/:id { notes?, regroup?, public?, lead?, sweep? } (REVIEW_PEOPLE.md P-10): what the plan form no longer
 *  asks up front, set on the planned drive's card afterwards by the planner or the crew's owner. A key left out is kept;
 *  null clears notes or a role. */
export async function eventUpdate(env: Env, v: Viewer, id: string, req: Request): Promise<void> {
  const e = await visibleEvent(env, v, id);
  if (e.created_by !== v.id && e.owner !== v.id) throw new HttpError(403, "not_yours");
  const b = await body<{ notes?: unknown; regroup?: unknown; public?: unknown; lead?: unknown; sweep?: unknown; repeat_weeks?: unknown }>(req);
  const sets: string[] = [], args: unknown[] = [];
  // repeat: set or stopped on the series' latest drive (it is the one that plans the next)
  if (b.repeat_weeks !== undefined && await env.DB.prepare(`SELECT 1 FROM crew_events l JOIN crew_events e ON e.id = ?1
      WHERE l.series_id = COALESCE(e.series_id, e.id) AND l.id != e.id AND l.starts_at > e.starts_at AND l.cancelled = 0`).bind(id).first()) throw new HttpError(409, "not_latest");
  if (b.repeat_weeks !== undefined) { const r = repeatOf(b.repeat_weeks); sets.push("repeat_weeks = ?", "series_id = COALESCE(series_id, CASE WHEN ? IS NOT NULL THEN id END)"); args.push(r, r); }
  if (b.notes !== undefined) {
    const notes = b.notes === null || b.notes === "" ? null : cleanText(b.notes, 280)?.trim() || null;
    if (b.notes && !notes) throw new HttpError(400, "bad_notes");
    sets.push("notes = ?"); args.push(notes);
  }
  if (b.regroup !== undefined) { sets.push("regroup = ?"); args.push(JSON.stringify(regroupPoints(b.regroup))); }
  if (b.public !== undefined) {
    if (typeof b.public !== "boolean") throw new HttpError(400, "bad_public");
    if (b.public) {
      const c = await env.DB.prepare("SELECT visibility FROM crews WHERE id = ?").bind(e.crew_id).first<{ visibility: string }>();
      if (!c || c.visibility !== "public") throw new HttpError(400, "not_public_crew");
    }
    sets.push("public = ?"); args.push(b.public ? 1 : 0);
  }
  const cur = await env.DB.prepare("SELECT lead_id, sweep_id FROM crew_events WHERE id = ?").bind(id).first<{ lead_id: string | null; sweep_id: string | null }>();
  let lead = cur?.lead_id ?? null, sweep = cur?.sweep_id ?? null;
  if (b.lead !== undefined) { lead = await roleHolder(env, e.crew_id, b.lead); sets.push("lead_id = ?"); args.push(lead); }
  if (b.sweep !== undefined) { sweep = await roleHolder(env, e.crew_id, b.sweep); sets.push("sweep_id = ?"); args.push(sweep); }
  if (lead && lead === sweep) throw new HttpError(400, "bad_role");
  if (!sets.length) return;
  // someone named to a role is going, as taking it would make them
  const named = [b.lead !== undefined ? lead : null, b.sweep !== undefined ? sweep : null].filter((x): x is string => !!x);
  await env.DB.batch([
    env.DB.prepare(`UPDATE crew_events SET ${sets.join(", ")} WHERE id = ?`).bind(...args, id),
    ...named.map((uid) => env.DB.prepare(`INSERT INTO crew_event_rsvps (event_id, user_id, status) VALUES (?, ?, 'going')
      ON CONFLICT (event_id, user_id) DO UPDATE SET status = 'going', updated_at = datetime('now')`).bind(id, uid)),
  ]);
}

/** "I came" can be said from 12 hours before a drive starts (its convoy, the morning of) until the drive is swept. */
export const CAME_BEFORE_H = 12;

/** POST /api/events/:id/came (P-03): you came. The card sends it when you start or join the drive's convoy from it, or say
 *  "I was there" afterwards; DELETE takes it back. Only the fact, never a position. */
export async function eventCame(env: Env, v: Viewer, id: string, came: boolean): Promise<void> {
  await visibleEvent(env, v, id);
  if (!came) { await env.DB.prepare("DELETE FROM crew_event_attendance WHERE event_id = ? AND user_id = ?").bind(id, v.id).run(); return; }
  const r = await env.DB.prepare(`INSERT INTO crew_event_attendance (event_id, user_id)
      SELECT ?1, ?2 FROM crew_events WHERE id = ?1 AND starts_at <= datetime('now', '+${CAME_BEFORE_H} hours') AND starts_at > datetime('now', '-${KEEP_AFTER_START_DAYS} days')
      ON CONFLICT (event_id, user_id) DO NOTHING`).bind(id, v.id).run();
  if (r.meta.changes) return;
  const had = await env.DB.prepare("SELECT 1 AS ok FROM crew_event_attendance WHERE event_id = ? AND user_id = ?").bind(id, v.id).first();
  if (!had) throw new HttpError(400, "not_now");
}

/**
 * GET /api/events/:id/record (P-03, roadmap 2): the run remembered. Who came (from the convoy and "I was there"), who had
 * said going, and the best Vetta Score a crew-mate published to the crew from the drive's day, among those who came (or,
 * when nobody marked it, those going). Only Scores shared with the crew; a block either way hides the person. Members only.
 */
export async function eventRecord(env: Env, v: Viewer, id: string) {
  await visibleEvent(env, v, id);
  const e = await env.DB.prepare("SELECT e.id, e.crew_id, c.name AS crew_name, e.title, e.starts_at, e.meet_name FROM crew_events e JOIN crews c ON c.id = e.crew_id WHERE e.id = ?")
    .bind(id).first<{ id: string; crew_id: string; crew_name: string; title: string; starts_at: string; meet_name: string | null }>();
  if (!e) throw new HttpError(404, "no_event");
  const seen = (who: string) => `(${who} = ?2 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ?2 AND b.blocked = ${who}) OR (b.blocker = ${who} AND b.blocked = ?2)))`;
  const handles = async (sql: string) => (await env.DB.prepare(sql).bind(id, v.id, e.crew_id).all<{ handle: string | null }>()).results.map((r) => r.handle || "?");
  const came = await handles(`SELECT u.handle FROM crew_event_attendance a JOIN users u ON u.id = a.user_id
      JOIN crew_members m ON m.crew_id = ?3 AND m.user_id = a.user_id WHERE a.event_id = ?1 AND ${seen("a.user_id")} ORDER BY a.created_at, u.handle`);
  const going = await handles(`SELECT u.handle FROM crew_event_rsvps r JOIN users u ON u.id = r.user_id
      JOIN crew_members m ON m.crew_id = ?3 AND m.user_id = r.user_id WHERE r.event_id = ?1 AND r.status = 'going' AND ${seen("r.user_id")} ORDER BY r.updated_at`);
  const iCame = !!(await env.DB.prepare("SELECT 1 AS ok FROM crew_event_attendance WHERE event_id = ? AND user_id = ?").bind(id, v.id).first());
  // the drive's day wherever it was driven: a board day is the driver's own date, so a window around the UTC start
  const pool = came.length ? "EXISTS (SELECT 1 FROM crew_event_attendance a WHERE a.event_id = ?1 AND a.user_id = be.user_id)"
    : "EXISTS (SELECT 1 FROM crew_event_rsvps r WHERE r.event_id = ?1 AND r.user_id = be.user_id AND r.status = 'going')";
  const best = await env.DB.prepare(`SELECT u.handle, be.driver_score AS score, s.name AS stage FROM board_entries be JOIN users u ON u.id = be.user_id
      JOIN segments s ON s.id = be.segment_id JOIN crew_members m ON m.crew_id = ?3 AND m.user_id = be.user_id
     WHERE be.audience_type = 'crew' AND be.audience_id = ?3 AND ${pool}
       AND be.driven_on BETWEEN date(?4, '-12 hours') AND date(?4, '+14 hours')
       AND EXISTS (SELECT 1 FROM grants g WHERE g.user_id = be.user_id AND g.audience_type = 'crew' AND g.audience_id = ?3 AND g.share_scores = 1)
       AND ${seen("be.user_id")}
     ORDER BY be.driver_score DESC LIMIT 1`).bind(id, v.id, e.crew_id, e.starts_at).first<{ handle: string | null; score: number; stage: string | null }>();
  // The results sheet (IDEAS S-25): each stage of the day with every driver's best Score on it, and the overall, rally
  // style. Same pool, same window, same rules as `best`: only Scores shared with the crew, and a time beside one only
  // while that driver shares times with the crew too (share_times; the owner, 2026-11-10: share stage times).
  const runs = (await env.DB.prepare(`SELECT COALESCE(be.canon_id, s.origin_id, s.id) AS canon, MAX(be.driver_score) AS score, u.handle, be.user_id AS uid,
        CASE WHEN EXISTS (SELECT 1 FROM grants g WHERE g.user_id = be.user_id AND g.audience_type = 'crew' AND g.audience_id = ?3 AND g.share_times = 1)
             THEN MIN(be.time_s) END AS time_s,
        COALESCE((SELECT c.name FROM segments c WHERE c.id = COALESCE(be.canon_id, s.origin_id, s.id)), MIN(s.name)) AS stage
      FROM board_entries be JOIN users u ON u.id = be.user_id
      JOIN segments s ON s.id = be.segment_id JOIN crew_members m ON m.crew_id = ?3 AND m.user_id = be.user_id
     WHERE be.audience_type = 'crew' AND be.audience_id = ?3 AND ${pool}
       AND be.driven_on BETWEEN date(?4, '-12 hours') AND date(?4, '+14 hours')
       AND EXISTS (SELECT 1 FROM grants g WHERE g.user_id = be.user_id AND g.audience_type = 'crew' AND g.audience_id = ?3 AND g.share_scores = 1)
       AND ${seen("be.user_id")}
     GROUP BY canon, be.user_id LIMIT ${RESULTS_MAX_RUNS}`).bind(id, v.id, e.crew_id, e.starts_at)
    .all<{ canon: string; score: number; handle: string | null; uid: string; time_s: number | null; stage: string | null }>()).results;
  return { id: e.id, crew_id: e.crew_id, crew_name: e.crew_name, title: e.title, starts_at: e.starts_at.replace(" ", "T") + "Z", meet_name: e.meet_name,
    came, going, i_came: iCame, best: best ? { handle: best.handle || "?", score: best.score, stage: best.stage } : null,
    results: resultsSheet(runs.map((r) => ({ stage_id: r.canon, stage: r.stage || "A stage", who: r.uid, handle: r.handle || "?", score: r.score, time_s: r.time_s ?? null }))) };
}

export const RESULTS_MAX_STAGES = 12, RESULTS_MAX_RUNS = 400;
type Run = { stage_id: string; stage: string; who: string; handle: string; score: number; time_s?: number | null };   // who: kept on the server
/**
 * A crew drive's results sheet from each driver's best Score (and best shared time) per stage. Stages are ordered by how
 * many drove them, then by name; each stage ranks its drivers by Score (equal Scores share a place), with each shared
 * time's gap to the stage's quickest shared time (`gap_s`). The overall ranks first by stages driven (a driver who did
 * them all is classified ahead of one who missed some, as in a rally), then by the mean Score over the stages they
 * drove, rounded; `time_s` is the total of their times when they drove every stage with a time shared, with `gap_s` to
 * the quickest such total. A time is never guessed: unknown stays null. Pure; tests in backend/test/events.test.ts.
 */
export function resultsSheet(runs: Run[]) {
  const byStage = new Map<string, { id: string; name: string; rows: { who: string; handle: string; score: number; time_s: number | null }[] }>();
  for (const r of runs) {
    const st = byStage.get(r.stage_id) ?? { id: r.stage_id, name: r.stage, rows: [] };
    st.rows.push({ who: r.who, handle: r.handle, score: r.score, time_s: r.time_s ?? null });
    byStage.set(r.stage_id, st);
  }
  // 1, 2, 2, 4: equal keys share a place
  const placed = <T,>(rows: T[], same: (x: T, y: T) => boolean) => {
    const out: (T & { place: number })[] = [];
    rows.forEach((r, i) => out.push({ ...r, place: i && same(rows[i - 1], r) ? out[i - 1].place : i + 1 }));
    return out;
  };
  const gaps = <T extends { time_s: number | null }>(rows: T[]) => {
    const best = Math.min(...rows.map((r) => r.time_s ?? Infinity));
    return rows.map((r) => ({ ...r, gap_s: r.time_s != null && Number.isFinite(best) ? r.time_s - best : null }));
  };
  const stages = [...byStage.values()].sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name)).slice(0, RESULTS_MAX_STAGES)
    .map((s) => ({ id: s.id, name: s.name,
      rows: gaps(placed(s.rows.sort((a, b) => b.score - a.score || a.handle.localeCompare(b.handle)), (x, y) => x.score === y.score)) }));
  const per = new Map<string, { handle: string; xs: number[]; ts: (number | null)[] }>();
  for (const s of stages) for (const r of s.rows) {
    const p = per.get(r.who) ?? { handle: r.handle, xs: [], ts: [] };
    p.xs.push(r.score); p.ts.push(r.time_s); per.set(r.who, p);
  }
  const overall = gaps(placed([...per.values()]
    .map(({ handle, xs, ts }) => {
      const full = xs.length === stages.length;
      return { handle, stages: xs.length, score: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length), full,
        time_s: full && ts.every((t) => t != null) ? (ts as number[]).reduce((a, b) => a + b, 0) : null };
    })
    .sort((a, b) => b.stages - a.stages || b.score - a.score || a.handle.localeCompare(b.handle)), (x, y) => x.stages === y.stages && x.score === y.score));
  return { stages: stages.map((s) => ({ ...s, rows: s.rows.map(({ who: _, ...r }) => r) })), overall };
}

/** The crew's last drive (P-03): the most recent one that started RECORD_AFTER_H or more ago and is still kept, for the crew
 *  page's "what it was" (its record is GET /api/events/:id/record). null when there is none. */
export const RECORD_AFTER_H = 4;
export async function lastEvent(env: Env, crewId: string) {
  const r = await env.DB.prepare(`SELECT e.id, e.title, e.starts_at, e.meet_name FROM crew_events e
      WHERE e.crew_id = ?1 AND ${VISIBLE("e")} AND e.starts_at <= datetime('now', '-${RECORD_AFTER_H} hours') AND e.starts_at > datetime('now', '-${KEEP_AFTER_START_DAYS} days')
      ORDER BY e.starts_at DESC LIMIT 1`).bind(crewId).first<{ id: string; title: string; starts_at: string; meet_name: string | null }>();
  return r ? { ...r, starts_at: r.starts_at.replace(" ", "T") + "Z" } : null;
}
