// Duels (docs/SOCIAL.md 2.7, migration 0047): a friend challenges a friend on one of their stages for a few days, and the
// higher Vetta Score on it wins. Scores only: technique, never a time or a speed (IDEAS guardrails). A duel reads the
// runs each driver already publishes to the other (board_entries, behind their own Scores grant), so accepting one
// shares nothing by itself; each side sees whether the other's Scores reach them. Challenging also shares the stage
// itself (segment_shares), so the friend can drive it from their Stages list.
import type { Viewer } from "./auth";
import { Env, HttpError, body, int, str } from "./util";
import { isAcceptedFriend } from "./social";

export const DAYS = [3, 7, 14] as const, MAX_OPEN = 10, PER_DAY = 10, KEEP_DAYS = 60;
const first = <T>(env: Env, sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a).first<T>();
const all = async <T>(env: Env, sql: string, ...a: unknown[]) => (await env.DB.prepare(sql).bind(...a).all<T>()).results;
const NO_BLOCK = (a: string, b: string) => `NOT EXISTS (SELECT 1 FROM blocks k WHERE (k.blocker = ${a} AND k.blocked = ${b}) OR (k.blocker = ${b} AND k.blocked = ${a}))`;
const FRIENDS = (a: string, b: string) => `EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted' AND f.user_a = MIN(${a}, ${b}) AND f.user_b = MAX(${a}, ${b}))`;

/** Open duels a member is in (waiting or on), to cap them. */
const OPEN = `(status = 'pending' OR (status = 'on' AND ends_on >= date('now')))`;

export async function duelCreate(env: Env, v: Viewer, req: Request) {
  const b = await body<{ handle?: unknown; segment_id?: unknown; days?: unknown }>(req);
  const handle = str(b.handle, "handle", 3, 21).replace(/^@/, "").toLowerCase();
  const days = int(b.days, "days", 1, 14);
  if (!(DAYS as readonly number[]).includes(days)) throw new HttpError(400, "bad_days");
  const seg = await first<{ id: string; canon: string; name: string }>(env,
    "SELECT id, COALESCE(origin_id, id) AS canon, name FROM segments WHERE id = ? AND owner = ?", str(b.segment_id, "segment_id", 1, 64), v.id);
  if (!seg) throw new HttpError(404, "no_segment");
  const other = await first<{ id: string }>(env, `SELECT u.id FROM users u WHERE u.handle = ?2 AND u.id != ?1 AND ${FRIENDS("u.id", "?1")} AND ${NO_BLOCK("u.id", "?1")}`, v.id, handle);
  if (!other) throw new HttpError(404, "no_friend");                // a stranger and an unknown handle answer alike
  const open = await first<{ n: number; same: number }>(env,
    `SELECT COUNT(*) AS n, SUM(canon_id = ?2 AND (challenger = ?3 OR opponent = ?3)) AS same FROM duels WHERE (challenger = ?1 OR opponent = ?1) AND ${OPEN}`, v.id, seg.canon, other.id);
  if (open?.same) throw new HttpError(409, "duel_exists");
  if ((open?.n ?? 0) >= MAX_OPEN) throw new HttpError(429, "too_many_duels");
  const today = await first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM duels WHERE challenger = ? AND created_at > datetime('now', '-1 day')", v.id);
  if ((today?.n ?? 0) >= PER_DAY) throw new HttpError(429, "daily_limit");
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO duels (id, challenger, opponent, canon_id, stage, days) VALUES (?, ?, ?, ?, ?, ?)").bind(id, v.id, other.id, seg.canon, seg.name, days),
    env.DB.prepare("INSERT OR IGNORE INTO segment_shares (segment_id, audience_type, audience_id) VALUES (?, 'friend', ?)").bind(seg.id, other.id),
  ]);
  return { id };
}

async function mine(env: Env, v: Viewer, id: string) {
  const d = await first<{ id: string; challenger: string; opponent: string; canon_id: string; status: string; days: number }>(env,
    `SELECT id, challenger, opponent, canon_id, status, days FROM duels WHERE id = ?2 AND (challenger = ?1 OR opponent = ?1)
        AND ${NO_BLOCK("challenger", "opponent")}`, v.id, id);
  if (!d) throw new HttpError(404, "no_duel");
  return d;
}

/** The friend says yes: the clock starts today and the stage is copied into their list (linked, so the boards line up). */
export async function duelAccept(env: Env, v: Viewer, id: string) {
  const d = await mine(env, v, id);
  if (d.opponent !== v.id || d.status !== "pending") throw new HttpError(409, "not_pending");
  if (!(await isAcceptedFriend(env, d.challenger, d.opponent))) throw new HttpError(404, "no_duel");
  const src = await first<{ name: string; length_m: number; geom: string; start_lat: number; start_lon: number; end_lat: number; end_lon: number }>(env,
    "SELECT name, length_m, geom, start_lat, start_lon, end_lat, end_lon FROM segments WHERE owner = ? AND COALESCE(origin_id, id) = ? LIMIT 1", d.challenger, d.canon_id);
  const have = await first(env, "SELECT 1 FROM segments WHERE owner = ?1 AND (origin_id = ?2 OR id = ?2)", v.id, d.canon_id);
  await env.DB.batch([
    env.DB.prepare(`UPDATE duels SET status = 'on', starts_on = date('now'), ends_on = date('now', '+' || (days - 1) || ' days') WHERE id = ?`).bind(id),
    ...(src && !have ? [env.DB.prepare("INSERT INTO segments (id, owner, name, length_m, geom, start_lat, start_lon, end_lat, end_lon, origin_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), v.id, src.name, src.length_m, src.geom, src.start_lat, src.start_lon, src.end_lat, src.end_lon, d.canon_id)] : []),
  ]);
  return { stage_added: !!(src && !have) };
}

/** No thanks (the friend), or taken back (either side, before or during). Kept as declined / withdrawn so it can be listed. */
export async function duelEnd(env: Env, v: Viewer, id: string) {
  const d = await mine(env, v, id);
  if (d.status !== "pending" && d.status !== "on") throw new HttpError(409, "closed");
  const s = d.status === "pending" && d.opponent === v.id ? "declined" : "withdrawn";
  await env.DB.prepare("UPDATE duels SET status = ? WHERE id = ?").bind(s, id).run();
  return { status: s };
}

/**
 * Your duels: waiting on you, waiting on them, on, and finished in the last KEEP_DAYS. Each side's best Score on the stage
 * within the duel's days, from runs that side publishes to the other (null when none, or when their Scores don't reach
 * the other: `you_share` / `they_share` say which). Never a time.
 */
export async function duelList(env: Env, v: Viewer) {
  const rows = await all<{ id: string; challenger: string; opponent: string; canon_id: string; stage: string; days: number; status: string;
    starts_on: string | null; ends_on: string | null; created_at: string; other_id: string; other: string | null; today: string; have_stage: number }>(env,
    `SELECT d.*, CASE WHEN d.challenger = ?1 THEN d.opponent ELSE d.challenger END AS other_id, u.handle AS other, date('now') AS today,
            EXISTS (SELECT 1 FROM segments s WHERE s.owner = ?1 AND COALESCE(s.origin_id, s.id) = d.canon_id) AS have_stage
       FROM duels d JOIN users u ON u.id = CASE WHEN d.challenger = ?1 THEN d.opponent ELSE d.challenger END
      WHERE (d.challenger = ?1 OR d.opponent = ?1) AND ${NO_BLOCK("d.challenger", "d.opponent")}
        AND (${FRIENDS("d.challenger", "d.opponent")} OR d.status IN ('declined', 'withdrawn'))
        AND d.created_at > datetime('now', '-${KEEP_DAYS} days')
      ORDER BY d.created_at DESC, d.rowid DESC LIMIT 50`, v.id);
  const best = (who: string, to: string, d: typeof rows[number]) => d.status === "pending" || !d.starts_on ? Promise.resolve(null) : first<{ s: number | null; on: string | null }>(env,
    `SELECT MAX(be.driver_score) AS s, (SELECT b2.driven_on FROM board_entries b2 WHERE b2.user_id = ?1 AND b2.canon_id = ?3 AND b2.audience_type = 'friend' AND b2.audience_id = ?2
         AND b2.driven_on BETWEEN ?4 AND ?5 ORDER BY b2.driver_score DESC, b2.driven_on LIMIT 1) AS "on"
       FROM board_entries be WHERE be.user_id = ?1 AND be.canon_id = ?3 AND be.audience_type = 'friend' AND be.audience_id = ?2
        AND be.driven_on BETWEEN ?4 AND ?5
        AND EXISTS (SELECT 1 FROM grants g WHERE g.user_id = ?1 AND g.audience_type = 'friend' AND g.audience_id = ?2 AND g.share_scores = 1)`,
    who, to, d.canon_id, d.starts_on, d.ends_on).then((r) => (r && r.s != null ? { score: r.s, on: r.on } : null));
  const shares = (who: string, to: string) => first(env, "SELECT 1 FROM grants WHERE user_id = ? AND audience_type = 'friend' AND audience_id = ? AND share_scores = 1", who, to).then((r) => !!r);
  const out = [];
  for (const d of rows) {
    const [mineBest, theirs, youShare, theyShare] = await Promise.all([best(v.id, d.other_id, d), best(d.other_id, v.id, d), shares(v.id, d.other_id), shares(d.other_id, v.id)]);
    const over = d.status === "on" && d.ends_on! < d.today;
    out.push({ id: d.id, stage: d.stage, canon_id: d.canon_id, days: d.days, with: d.other, with_id: d.other_id, challenger: d.challenger === v.id,
      status: over ? "over" : d.status, starts_on: d.starts_on, ends_on: d.ends_on, today: d.today, have_stage: !!d.have_stage,
      you: mineBest, them: theirs, you_share: youShare, they_share: theyShare, created_at: d.created_at });
  }
  return out;
}

export const DUELS_SWEEP = `DELETE FROM duels WHERE created_at <= datetime('now', '-${KEEP_DAYS} days')
  AND (ends_on IS NULL OR ends_on <= date('now', '-${KEEP_DAYS} days'))`;
