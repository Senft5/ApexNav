// Weekly time attack (docs/SOCIAL.md 2.9, migration 0049; the owner, 2026-11-11: "a weekly time attack circuit per area").
// An area is a 1-degree square (about 110 by 90 km). Members put one of their own stages up for the area it starts in; each
// Monday (UTC) one stage is picked per area, the first time anyone there looks, and kept for the week. Entering copies the
// stage into your Stages; your quickest time on it that week (the Log times stage runs on the phone, as for boards) goes on a
// board every member can see, by handle, with that run's Vetta Score. Leaving the week takes your time off. Blocks hide
// people both ways; a stage put up is reportable (kind `circuit`). Times only from runs the phone timed; an average speed
// no car on a public road could hold is refused rather than ranked.
import type { Viewer } from "./auth";
import { Env, HttpError, body, int, num, str, DATE_RE } from "./util";
import { removedSql, reportedSql } from "./reports_sql";

export const MIN_M = 1000, MAX_M = 25000, MAX_PUT_UP = 3, BOARD_SIZE = 50, KEEP_WEEKS = 8;
/** Faster than this on average over a whole stage (60 m/s, 216 km/h) is not a run, it's a bad clock or a fake. */
export const MAX_AVG_MS = 60;

const first = <T>(env: Env, sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).first<T>();
const all = async <T>(env: Env, sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;
const NO_BLOCK = (a: string, b: string) => `NOT EXISTS (SELECT 1 FROM blocks k WHERE (k.blocker = ${a} AND k.blocked = ${b}) OR (k.blocker = ${b} AND k.blocked = ${a}))`;
/** The Monday (UTC) that starts this week, and the Sunday that ends it. */
const WEEK = "date('now', '-6 days', 'weekday 1')";

/** The area a point is in: the 1-degree square, south-west corner, as 'lat,lon'. */
export const cellOf = (lat: number, lon: number) => `${Math.floor(lat)},${Math.floor(lon)}`;
const cellParam = (u: URL) => cellOf(num(Number(u.searchParams.get("lat")), "lat", -85, 85), num(Number(u.searchParams.get("lon")), "lon", -180, 180));
const cellBody = (c: unknown) => {
  const m = /^(-?\d{1,2}),(-?\d{1,3})$/.exec(String(c ?? ""));
  if (!m || Math.abs(+m[1]) > 85 || Math.abs(+m[2]) > 180) throw new HttpError(400, "bad_cell");
  return `${+m[1]},${+m[2]}`;
};
/** A stable pick from a list for a week and an area (FNV-1a over the key): every phone that asks gets the same stage. */
export function pick<T extends { segment_id: string }>(list: T[], key: string): T | null {
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => (a.segment_id < b.segment_id ? -1 : 1));
  let h = 0x811c9dc5;
  for (const ch of key) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return sorted[h % sorted.length];
}

// ---- putting a stage up ------------------------------------------------------------------------
/** POST /api/timeattack/pool {segment_id}: one of your own stages (not a copy), 1 to 25 km, for the area it starts in. */
export async function poolAdd(env: Env, v: Viewer, req: Request) {
  if (!v.handle) throw new HttpError(409, "handle_required");       // the board names people by handle
  const b = await body<{ segment_id?: unknown }>(req);
  const seg = await first<{ id: string; length_m: number; start_lat: number; start_lon: number }>(env,
    "SELECT id, length_m, start_lat, start_lon FROM segments WHERE id = ? AND owner = ? AND origin_id IS NULL", str(b.segment_id, "segment_id", 1, 64), v.id);
  if (!seg) throw new HttpError(404, "no_segment");
  if (seg.length_m < MIN_M || seg.length_m > MAX_M) throw new HttpError(400, "bad_length");
  if (await first(env, `SELECT 1 WHERE ${removedSql("circuit", "?1")}`, seg.id)) throw new HttpError(403, "removed_by_moderator");
  const n = await first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM ta_pool WHERE owner = ? AND segment_id != ?", v.id, seg.id);
  if ((n?.n ?? 0) >= MAX_PUT_UP) throw new HttpError(429, "too_many");
  const cell = cellOf(seg.start_lat, seg.start_lon);
  await env.DB.prepare("INSERT OR IGNORE INTO ta_pool (segment_id, owner, cell) VALUES (?, ?, ?)").bind(seg.id, v.id, cell).run();
  return { cell };
}
export async function poolRemove(env: Env, v: Viewer, segmentId: string) {
  await env.DB.prepare("DELETE FROM ta_pool WHERE segment_id = ? AND owner = ?").bind(segmentId, v.id).run();
}
export const poolMine = (env: Env, v: Viewer) => all<{ segment_id: string; name: string; cell: string }>(env,
  "SELECT p.segment_id, s.name, p.cell FROM ta_pool p JOIN segments s ON s.id = p.segment_id WHERE p.owner = ? ORDER BY p.created_at", v.id);

// ---- the week's circuit ------------------------------------------------------------------------
type Circuit = { week: string; ends_on: string; cell: string; segment_id: string; name: string; length_m: number; geom: string; by: string | null };
/** This week's circuit for an area, picked now if nobody has asked yet this week (never last week's again while there's another). */
async function current(env: Env, cell: string): Promise<{ week: string; ends_on: string; today: string; circuit: Circuit | null }> {
  const w = (await first<{ week: string; ends_on: string; today: string; last: string }>(env,
    `SELECT ${WEEK} AS week, date(${WEEK}, '+6 days') AS ends_on, date('now') AS today, date(${WEEK}, '-7 days') AS last`))!;
  let row = await first<{ segment_id: string }>(env, "SELECT segment_id FROM ta_weeks WHERE week = ? AND cell = ?", w.week, cell);
  if (!row) {
    const pool = await all<{ segment_id: string }>(env,
      `SELECT p.segment_id FROM ta_pool p JOIN users u ON u.id = p.owner JOIN members m ON m.user_id = p.owner
        WHERE p.cell = ? AND u.handle IS NOT NULL AND NOT ${reportedSql("circuit", "p.segment_id")} LIMIT 200`, cell);
    const lastPick = await first<{ segment_id: string }>(env, "SELECT segment_id FROM ta_weeks WHERE week = ? AND cell = ?", w.last, cell);
    const fresh = pool.filter((p) => p.segment_id !== lastPick?.segment_id);
    const chosen = pick(fresh.length ? fresh : pool, `${w.week}|${cell}`);
    if (chosen) {
      await env.DB.prepare("INSERT OR IGNORE INTO ta_weeks (week, cell, segment_id) VALUES (?, ?, ?)").bind(w.week, cell, chosen.segment_id).run();
      row = await first<{ segment_id: string }>(env, "SELECT segment_id FROM ta_weeks WHERE week = ? AND cell = ?", w.week, cell);
    }
  }
  const c = row ? await first<Omit<Circuit, "week" | "ends_on" | "cell">>(env,
    `SELECT s.id AS segment_id, s.name, s.length_m, s.geom, u.handle AS by FROM segments s JOIN users u ON u.id = s.owner
      WHERE s.id = ? AND NOT ${reportedSql("circuit", "s.id")}`, row.segment_id) : null;
  return { week: w.week, ends_on: w.ends_on, today: w.today, circuit: c ? { ...c, week: w.week, ends_on: w.ends_on, cell } : null };
}

/** GET /api/timeattack?lat&lon: the area's circuit this week, its board (quickest first), your place, and last week's podium. */
export async function timeAttack(env: Env, v: Viewer, url: URL) {
  const cell = cellParam(url);
  const { week, ends_on, today, circuit } = await current(env, cell);
  const rows = await all<{ user_id: string; handle: string | null; time_s: number; driver_score: number | null; driven_on: string }>(env,
    `SELECT e.user_id, u.handle, e.time_s, e.driver_score, e.driven_on FROM ta_entries e JOIN users u ON u.id = e.user_id
      WHERE e.week = ?1 AND e.cell = ?2 AND (e.user_id = ?3 OR ${NO_BLOCK("e.user_id", "?3")})
      ORDER BY e.time_s, e.updated_at, u.handle LIMIT 500`, week, cell, v.id);
  const best = rows.length ? rows[0].time_s : null;
  const placed = rows.map((r, i) => ({ place: i && rows[i - 1].time_s === r.time_s ? -1 : i + 1, r }))
    .map((x, i, a) => ({ ...x, place: x.place > 0 ? x.place : a.slice(0, i).reverse().find((y) => y.place > 0)!.place }));
  const out = (x: typeof placed[number]) => ({ place: x.place, handle: x.r.handle || "?", time_s: x.r.time_s, gap_s: best == null ? null : x.r.time_s - best,
    score: x.r.driver_score, driven_on: x.r.driven_on, mine: x.r.user_id === v.id });
  const me = placed.find((x) => x.r.user_id === v.id);
  const entered = circuit ? !!(await first(env, "SELECT 1 FROM segments WHERE owner = ?1 AND (id = ?2 OR origin_id = ?2)", v.id, circuit.segment_id)) : false;
  const last = await first<{ segment_id: string; name: string | null }>(env,
    `SELECT w.segment_id, s.name FROM ta_weeks w LEFT JOIN segments s ON s.id = w.segment_id WHERE w.week = date(?1, '-7 days') AND w.cell = ?2`, week, cell);
  const podium = last ? await all<{ handle: string | null; time_s: number }>(env,
    `SELECT u.handle, e.time_s FROM ta_entries e JOIN users u ON u.id = e.user_id WHERE e.week = date(?1, '-7 days') AND e.cell = ?2
      AND (e.user_id = ?3 OR ${NO_BLOCK("e.user_id", "?3")}) ORDER BY e.time_s, e.updated_at, u.handle LIMIT 3`, week, cell, v.id) : [];
  const pool = await first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM ta_pool WHERE cell = ?", cell);
  return { week, ends_on, today, cell, circuit, entered, entrants: rows.length,
    board: placed.slice(0, BOARD_SIZE).map(out), you: me ? out(me) : null,
    last: last ? { name: last.name || "A stage", podium: podium.map((p) => ({ handle: p.handle || "?", time_s: p.time_s })) } : null,
    pool: pool?.n ?? 0 };
}

/** POST /api/timeattack/enter {cell}: the week's circuit goes into your Stages (a linked copy, as when a friend shares one). */
export async function enter(env: Env, v: Viewer, req: Request) {
  if (!v.handle) throw new HttpError(409, "handle_required");
  const { circuit } = await current(env, cellBody((await body<{ cell?: unknown }>(req)).cell));
  if (!circuit) throw new HttpError(404, "no_circuit");
  const have = await first<{ id: string }>(env, "SELECT id FROM segments WHERE owner = ?1 AND (id = ?2 OR origin_id = ?2)", v.id, circuit.segment_id);
  if (have) return { segment_id: have.id, added: false };
  const src = (await first<{ name: string; length_m: number; geom: string; start_lat: number; start_lon: number; end_lat: number; end_lon: number }>(env,
    "SELECT name, length_m, geom, start_lat, start_lon, end_lat, end_lon FROM segments WHERE id = ?", circuit.segment_id))!;
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO segments (id, owner, name, length_m, geom, start_lat, start_lon, end_lat, end_lon, origin_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, v.id, src.name, src.length_m, src.geom, src.start_lat, src.start_lon, src.end_lat, src.end_lon, circuit.segment_id).run();
  return { segment_id: id, added: true };
}

/** GET /api/timeattack/circuits: this week's circuits (their stage ids), so the phone sends times only for those. */
export async function circuitsNow(env: Env) {
  const w = (await first<{ week: string; ends_on: string }>(env, `SELECT ${WEEK} AS week, date(${WEEK}, '+6 days') AS ends_on`))!;
  return { ...w, circuits: await all<{ segment_id: string; cell: string }>(env, "SELECT segment_id, cell FROM ta_weeks WHERE week = ?", w.week) };
}

/**
 * POST /api/timeattack/runs {runs: [{segment_id, time_s, driver_score?, driven_on}]}: your timed runs on stages you have.
 * A run counts when its stage is a circuit this week and it was driven this week; your quickest stays. → { accepted }.
 */
export async function runs(env: Env, v: Viewer, req: Request) {
  if (!v.handle) throw new HttpError(409, "handle_required");
  const b = await body<{ runs?: unknown }>(req);
  if (!Array.isArray(b.runs) || b.runs.length > 20) throw new HttpError(400, "bad_runs");
  let accepted = 0;
  for (const raw of b.runs as Record<string, unknown>[]) {
    const segId = str(raw && raw.segment_id, "segment_id", 1, 64), time = int(raw.time_s, "time_s", 10, 36000);
    const score = raw.driver_score == null ? null : int(raw.driver_score, "driver_score", 0, 1000);
    const day = str(raw.driven_on, "driven_on", 10, 10);
    if (!DATE_RE.test(day)) throw new HttpError(400, "bad_driven_on");
    const c = await first<{ cell: string; week: string; length_m: number }>(env,
      `SELECT w.cell, w.week, s.length_m FROM segments s JOIN ta_weeks w ON w.segment_id = COALESCE(s.origin_id, s.id) AND w.week = ${WEEK}
        WHERE s.id = ?1 AND s.owner = ?2 AND ?3 BETWEEN w.week AND date(w.week, '+6 days') AND ?3 <= date('now', '+1 day')`, segId, v.id, day);
    if (!c) continue;
    if (c.length_m / time > MAX_AVG_MS) throw new HttpError(400, "implausible_time");
    await env.DB.prepare(`INSERT INTO ta_entries (week, cell, user_id, time_s, driver_score, driven_on) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (week, cell, user_id) DO UPDATE SET time_s = ?4, driver_score = ?5, driven_on = ?6, updated_at = datetime('now') WHERE ?4 < ta_entries.time_s`)
      .bind(c.week, c.cell, v.id, time, score, day).run();
    accepted++;
  }
  return { accepted };
}

/** DELETE /api/timeattack/entry?lat&lon: your time off this week's board for that area. */
export async function leave(env: Env, v: Viewer, url: URL) {
  await env.DB.prepare(`DELETE FROM ta_entries WHERE user_id = ? AND cell = ? AND week = ${WEEK}`).bind(v.id, cellParam(url)).run();
}

export const TA_SWEEP = {
  ta_entries: `DELETE FROM ta_entries WHERE week < date('now', '-${KEEP_WEEKS * 7} days')`,
  ta_weeks: `DELETE FROM ta_weeks WHERE week < date('now', '-${KEEP_WEEKS * 7} days')`,
};
