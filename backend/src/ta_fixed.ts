// Fixed time attacks (migration 0057; the owner, 2026-11-12: "time attacks should just be static best roads maybe changing
// every few months or something or rotating highlighted time attacks, with a leaderboard that you can view by week; month;
// year; all time"). An area (time_attack.ts cellOf: a quarter degree, near you) has up to SLOTS loops for a season, a
// calendar quarter. Each is built as the weekly loop was: the server can't route, so the first phone in the area asks, is
// handed a slot's seed (`make`), builds the area's best loop from the seed's start with Vetta's router (web/time_attack.js
// makeLoop, `best`: the router's top loop, through roads, no estate streets) and posts it; the server checks it and keeps
// the first. Loops start at least APART_M apart, so the three are three different drives. One is featured each week, in
// turn. Entering is the opt-in (ta_entered); your quickest time each day you drive one goes in ta_times, and its board is
// read for this week, this month, this year or all time (the circuit's whole season). Leaving takes every time of yours on
// it away. Blocks hide people both ways; a loop is reportable (kind `circuit`), and one taken down is built again in its
// slot from the next seed. Times only from runs the phone timed; an average speed no road car could hold is refused.
// The weekly endpoints (time_attack.ts) stay for builds that still ask for them.
import type { Viewer } from "./auth";
import { Env, HttpError, body, int, str, DATE_RE } from "./util";
import { establishedSql, reportedSql } from "./reports_sql";
import { requireOnRoads } from "./loop_check";
import { BOARD_SIZE, LOOP_KM, MAX_AVG_MS, NO_BLOCK, cellBody, cellParam, checkLoop, hav, nameOf } from "./time_attack";

export const SLOTS = 3;
/** Loops in one area start at least this far apart (a second loop from the same junction is the same drive). */
export const APART_M = 3000;
export const PERIODS = ["week", "month", "year", "all"] as const;
export type Period = typeof PERIODS[number];

const first = <T>(env: Env, sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).first<T>();
const all = async <T>(env: Env, sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;
/** The first day of this quarter (UTC), and its last. */
const SEASON = "date('now', 'start of month', '-' || ((CAST(strftime('%m', 'now') AS INTEGER) - 1) % 3) || ' months')";
const WEEK = "date('now', '-6 days', 'weekday 1')";
/** The first day a period's board counts from (SQL); `all` is the circuit's whole life. */
const FROM: Record<Period, string> = { week: WEEK, month: "date('now', 'start of month')", year: "date('now', 'start of year')", all: "'0000-01-01'" };

/** The seed a phone builds a slot's loop from: the same for every phone in the area, a new one after a take-down. */
export const seedFor = (season: string, cell: string, slot: number, tries: number) => `${season}|${cell}|${slot}|${tries}`;
/** The circuit featured this week: the shown ones in slot order, one a week in turn from the season's first Monday. */
export function featuredOf<T>(shown: T[], season: string, week: string): T | null {
  if (!shown.length) return null;
  const n = Math.floor((Date.parse(week + "T00:00:00Z") - Date.parse(season + "T00:00:00Z")) / (7 * 86400000));
  return shown[(((Number.isFinite(n) ? n : 0) % shown.length) + shown.length) % shown.length];
}

type Row = { id: string; slot: number; name: string; length_m: number; geom: string; tries: number; removed: number };
type Now = { season: string; ends_on: string; week: string; today: string; shown: Row[]; make: { slot: number; seed: string; km: typeof LOOP_KM; best: true; avoid: [number, number][] } | null };
/** The area's circuits this season (taken down and reported ones left out), and the next slot to build, if any. */
async function season(env: Env, cell: string): Promise<Now> {
  const s = (await first<{ season: string; ends_on: string; week: string; today: string }>(env,
    `SELECT ${SEASON} AS season, date(${SEASON}, '+3 months', '-1 day') AS ends_on, ${WEEK} AS week, date('now') AS today`))!;
  const rows = await all<Row>(env, "SELECT id, slot, name, length_m, geom, tries, removed FROM ta_circuits WHERE season = ? AND cell = ? ORDER BY slot", s.season, cell);
  const hidden = new Set<string>();
  for (const r of rows) if (!r.removed && (await first(env, `SELECT 1 WHERE ${reportedSql("circuit", "?1")}`, r.id))) hidden.add(r.id);
  const shown = rows.filter((r) => !r.removed && !hidden.has(r.id));
  // the lowest slot with no loop (or one taken down); a loop hidden by reports waits for a moderator, it isn't rebuilt
  let make: Now["make"] = null;
  for (let slot = 0; slot < SLOTS && !make; slot++) {
    const r = rows.find((x) => x.slot === slot);
    if (r && !r.removed) continue;
    make = { slot, seed: seedFor(s.season, cell, slot, r ? r.tries : 0), km: LOOP_KM, best: true,
      avoid: rows.filter((x) => !x.removed).map((x) => (JSON.parse(x.geom) as [number, number][])[0]) };
  }
  return { ...s, shown, make };
}

const established = async (env: Env, v: Viewer) => !!(await first(env, `SELECT 1 WHERE ${establishedSql("?1")}`, v.id));

const periodOf = (u: URL): Period => { const p = u.searchParams.get("period") || "week"; if (!(PERIODS as readonly string[]).includes(p)) throw new HttpError(400, "bad_period"); return p as Period; };

/** A circuit's board for a period: each entrant's quickest time in it, quickest first (ties share a place). */
type BoardRow = { user_id: string; handle: string | null; time_s: number; driver_score: number | null; driven_on: string };
const boardStmt = (env: Env, v: Viewer, id: string, period: Period) => env.DB.prepare(
  `SELECT t.user_id, u.handle, MIN(t.time_s) AS time_s, t.driver_score, t.driven_on FROM ta_times t JOIN users u ON u.id = t.user_id
    WHERE t.circuit_id = ?1 AND t.driven_on >= ${FROM[period]} AND (t.user_id = ?2 OR ${NO_BLOCK("t.user_id", "?2")})
    GROUP BY t.user_id ORDER BY time_s, t.updated_at, u.handle LIMIT 500`).bind(id, v.id);
async function board(env: Env, v: Viewer, id: string, period: Period) {
  return boardOf(v, period, (await boardStmt(env, v, id, period).all<BoardRow>()).results);
}
function boardOf(v: Viewer, period: Period, rows: BoardRow[]) {
  const best = rows.length ? rows[0].time_s : null;
  let place = 0;
  const placed = rows.map((r, i) => { if (!i || rows[i - 1].time_s !== r.time_s) place = i + 1; return { place, r }; });
  const out = (x: typeof placed[number]) => ({ place: x.place, handle: x.r.handle || "?", time_s: x.r.time_s, gap_s: best == null ? null : x.r.time_s - best,
    score: x.r.driver_score, driven_on: x.r.driven_on, mine: x.r.user_id === v.id });
  const me = placed.find((x) => x.r.user_id === v.id);
  return { period, entrants: rows.length, rows: placed.slice(0, BOARD_SIZE).map(out), you: me ? out(me) : null };
}

/**
 * GET /api/ta?lat&lon[&id][&period]: the area's circuits this season (the featured one first marked), the slot to build if
 * one is missing, and one circuit's board (`id`, else the featured one) for `period` (week, the default; month; year; all).
 */
export async function fixedArea(env: Env, v: Viewer, url: URL) {
  const cell = cellParam(url), period = periodOf(url);
  const now = await season(env, cell);
  // only an established member's phone is asked to build a missing loop (fixedMake): a new account can't set the area's season
  if (now.make && !(await established(env, v))) now.make = null;
  const feat = featuredOf(now.shown, now.season, now.week);
  const entered = new Set((await all<{ circuit_id: string }>(env,
    `SELECT circuit_id FROM ta_entered WHERE user_id = ? AND circuit_id IN (${now.shown.map(() => "?").join(",") || "''"})`, v.id, ...now.shown.map((r) => r.id))).map((r) => r.circuit_id));
  const circuits = now.shown.map((r) => ({ id: r.id, slot: r.slot, name: r.name, length_m: r.length_m, geom: r.geom, featured: r === feat, entered: entered.has(r.id) }));
  const want = url.searchParams.get("id");
  const pick = want ? now.shown.find((r) => r.id === want) : feat;
  if (want && !pick) throw new HttpError(404, "no_circuit");
  return { season: now.season, ends_on: now.ends_on, week: now.week, today: now.today, cell, circuits, make: now.make,
    board: pick ? { id: pick.id, ...(await board(env, v, pick.id, period)) } : null };
}

/**
 * POST /api/ta/circuit {cell, slot, seed, name, geom}: the loop a phone built for a slot. The first that checks out is kept
 * for the season (a race answers with the one kept); a seed that isn't the slot's now is a 409, a start within APART_M of
 * another loop's a 400.
 */
export async function fixedMake(env: Env, v: Viewer, req: Request) {
  const b = await body<{ cell?: unknown; slot?: unknown; seed?: unknown; name?: unknown; geom?: unknown }>(req);
  const cell = cellBody(b.cell), slot = int(b.slot, "slot", 0, SLOTS - 1);
  const now = await season(env, cell);
  // The server can't route, so it can't tell a loop built from the seed from one drawn by hand through a neighbourhood: a loop
  // stays a whole season, so only a member who was invited or has been one a week may set it (as for reports that count).
  if (!now.shown.some((r) => r.slot === slot) && !(await established(env, v))) throw new HttpError(403, "not_yet");
  const had = now.shown.find((r) => r.slot === slot);
  if (had) return { circuit: { id: had.id, slot, name: had.name, length_m: had.length_m, geom: had.geom }, kept: false };
  if (!now.make || now.make.slot !== slot || b.seed !== now.make.seed) throw new HttpError(409, "stale_seed");
  const loop = checkLoop(b.geom, cell);
  await requireOnRoads(env, loop.geom);
  if (now.make.avoid.some((p) => hav(p, loop.geom[0]) < APART_M)) throw new HttpError(400, "too_close");
  const id = "ta-" + crypto.randomUUID(), tries = Number(String(now.make.seed).split("|")[3]) || 0;
  const name = typeof b.name === "string" && b.name.trim() ? nameOf(b.name) : "Local loop";
  // the slot's first loop this season, or in place of one taken down (its times and entries go with it: a new loop starts empty)
  const old = await first<{ id: string }>(env, "SELECT id FROM ta_circuits WHERE season = ? AND cell = ? AND slot = ? AND removed = 1", now.season, cell, slot);
  const ins = env.DB.prepare(`INSERT INTO ta_circuits (id, season, cell, slot, name, length_m, geom, tries) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT (season, cell, slot) DO UPDATE SET id = ?1, name = ?5, length_m = ?6, geom = ?7, tries = ?8, removed = 0, created_at = datetime('now')
     WHERE ta_circuits.removed = 1`).bind(id, now.season, cell, slot, name, loop.length_m, JSON.stringify(loop.geom), tries);
  const res = old ? (await env.DB.batch([
    env.DB.prepare("DELETE FROM ta_times WHERE circuit_id = ?").bind(old.id),
    env.DB.prepare("DELETE FROM ta_entered WHERE circuit_id = ?").bind(old.id), ins]))[2] : await ins.run();
  const kept = await first<Row>(env, "SELECT id, slot, name, length_m, geom FROM ta_circuits WHERE season = ? AND cell = ? AND slot = ? AND removed = 0", now.season, cell, slot);
  return { circuit: kept ? { id: kept.id, slot, name: kept.name, length_m: kept.length_m, geom: kept.geom } : null, kept: !!res.meta.changes };
}

/** A circuit this season, shown (not taken down, not hidden by reports), or a 404. */
async function live(env: Env, id: string) {
  const c = await first<Row & { cell: string }>(env,
    `SELECT id, cell, slot, name, length_m, geom FROM ta_circuits WHERE id = ?1 AND season = ${SEASON} AND removed = 0 AND NOT ${reportedSql("circuit", "?1")}`, id);
  if (!c) throw new HttpError(404, "no_circuit");
  return c;
}

/** POST /api/ta/enter {id}: entered (your times count from now), and the loop in your Stages (a linked copy). */
export async function fixedEnter(env: Env, v: Viewer, req: Request) {
  if (!v.handle) throw new HttpError(409, "handle_required");
  const c = await live(env, str((await body<{ id?: unknown }>(req)).id, "id", 1, 64));
  await env.DB.prepare("INSERT OR IGNORE INTO ta_entered (circuit_id, user_id) VALUES (?, ?)").bind(c.id, v.id).run();
  const have = await first<{ id: string }>(env, "SELECT id FROM segments WHERE owner = ?1 AND origin_id = ?2", v.id, c.id);
  if (have) return { segment_id: have.id, added: false };
  const g = JSON.parse(c.geom) as [number, number][], [a, z] = [g[0], g[g.length - 1]];
  const sid = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO segments (id, owner, name, length_m, geom, start_lat, start_lon, end_lat, end_lon, origin_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(sid, v.id, c.name, c.length_m, c.geom, a[0], a[1], z[0], z[1], c.id).run();
  return { segment_id: sid, added: true };
}

/** GET /api/ta/entered: the circuits this season you entered, so the phone sends times only for those. */
export async function fixedEntered(env: Env, v: Viewer) {
  const s = (await first<{ season: string; ends_on: string }>(env, `SELECT ${SEASON} AS season, date(${SEASON}, '+3 months', '-1 day') AS ends_on`))!;
  return { ...s, circuits: await all<{ id: string; cell: string; name: string; since: string }>(env,
    `SELECT c.id, c.cell, c.name, date(e.created_at) AS since FROM ta_entered e JOIN ta_circuits c ON c.id = e.circuit_id
      WHERE e.user_id = ? AND c.season = ? AND c.removed = 0`, v.id, s.season) };
}

/**
 * POST /api/ta/runs {runs: [{segment_id, time_s, driver_score?, driven_on}]}: your timed runs on stages you have. A run counts
 * when its stage is (a copy of) a circuit you entered, driven this season, not before you entered, and not in the future; your
 * quickest each day stays. A run no road car could set is skipped. → { accepted, refused, places: your place this week }.
 */
export async function fixedRuns(env: Env, v: Viewer, req: Request, beat?: { id: string; name: string; was: number | null }[]) {
  if (!v.handle) throw new HttpError(409, "handle_required");
  const b = await body<{ runs?: unknown }>(req);
  if (!Array.isArray(b.runs) || b.runs.length > 20) throw new HttpError(400, "bad_runs");
  // three batches whatever the count (a batch is one of Workers Free's 50 D1 queries per invocation; two queries per run and
  // a board per circuit went past it): every run's circuit, then the times that count, then your place on each board
  const want = (b.runs as Record<string, unknown>[]).map((raw) => {
    const segId = str(raw && raw.segment_id, "segment_id", 1, 64), time = int(raw.time_s, "time_s", 10, 36000);
    const score = raw.driver_score == null ? null : int(raw.driver_score, "driver_score", 0, 1000);
    const day = str(raw.driven_on, "driven_on", 10, 10);
    if (!DATE_RE.test(day)) throw new HttpError(400, "bad_driven_on");
    return { segId, time, score, day };
  });
  if (!want.length) return { accepted: 0, refused: 0, places: [] };
  const found = await env.DB.batch<{ id: string; name: string; length_m: number; was: number | null }>(want.map((r) => env.DB.prepare(
    // `was`: your quickest this week before these runs (push.ts afterPassed tells whoever you just went past)
    `SELECT c.id, c.name, c.length_m, (SELECT MIN(t.time_s) FROM ta_times t WHERE t.circuit_id = c.id AND t.user_id = ?2 AND t.driven_on >= ${WEEK}) AS was FROM segments s JOIN ta_circuits c ON c.id = s.origin_id AND c.season = ${SEASON} AND c.removed = 0
      JOIN ta_entered e ON e.circuit_id = c.id AND e.user_id = ?2
      WHERE s.id = ?1 AND s.owner = ?2 AND ?3 >= c.season AND ?3 >= date(e.created_at, '-1 day') AND ?3 <= date('now', '+1 day')`).bind(r.segId, v.id, r.day)));
  let accepted = 0, refused = 0;
  const hit = new Map<string, string>();
  const stmts: D1PreparedStatement[] = [];
  for (const [i, r] of want.entries()) {
    const c = found[i].results[0];
    if (!c) continue;
    if (c.length_m / r.time > MAX_AVG_MS) { refused++; continue; }
    stmts.push(env.DB.prepare(`INSERT INTO ta_times (circuit_id, user_id, driven_on, time_s, driver_score) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (circuit_id, user_id, driven_on) DO UPDATE SET time_s = ?4, driver_score = ?5, updated_at = datetime('now') WHERE ?4 < ta_times.time_s`)
      .bind(c.id, v.id, r.day, r.time, r.score));
    accepted++;
    if (beat && !hit.has(c.id)) beat.push({ id: c.id, name: c.name, was: c.was });
    hit.set(c.id, c.name);
  }
  if (stmts.length) await env.DB.batch(stmts);
  const ids = [...hit.keys()];
  const boards = ids.length ? await env.DB.batch<BoardRow>(ids.map((id) => boardStmt(env, v, id, "week"))) : [];
  const places = [];
  for (const [k, id] of ids.entries()) {
    const w = boardOf(v, "week", boards[k].results);
    if (w.you) places.push({ id, name: hit.get(id)!, place: w.you.place, of: w.entrants, time_s: w.you.time_s, gap_s: w.you.gap_s });
  }
  return { accepted, refused, places };
}

/** DELETE /api/ta/entry?id: every time of yours on that circuit off its boards, and out of it. Enter again to come back. */
export async function fixedLeave(env: Env, v: Viewer, url: URL) {
  const id = str(url.searchParams.get("id"), "id", 1, 64);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM ta_times WHERE user_id = ? AND circuit_id = ?").bind(v.id, id),
    env.DB.prepare("DELETE FROM ta_entered WHERE user_id = ? AND circuit_id = ?").bind(v.id, id),
  ]);
}

/** Seasons are kept two years, then go with their times. */
export const TA_FIXED_SWEEP = {
  ta_circuits: "DELETE FROM ta_circuits WHERE season < date('now', '-2 years')",
};
