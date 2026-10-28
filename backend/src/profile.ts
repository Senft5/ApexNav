// A friend's profile (IDEAS S-15). See friendProfile.
import { Env, HttpError, pair } from "./util";
import type { Viewer } from "./auth";
import { reportedSql } from "./reports_sql";
import { PUBLIC_COLS } from "./garage";
import { VISIBLE_FROM_OTHERS, isAcceptedFriend, isBlocked } from "./social";

const first = <T>(env: Env, sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a).first<T>();
const all = async <T>(env: Env, sql: string, ...a: unknown[]) => (await env.DB.prepare(sql).bind(...a).all<T>()).results;

/**
 * A friend's profile (IDEAS S-15): only for accepted friends, never across a block. Private by default: it is made only of
 * what they already show you: their name, the cars they show friends, the crews you share, and the stages whose scores
 * they publish to you (best Driver Score and days driven this month, never times). Totals are over those stages only.
 */
export async function friendProfile(env: Env, v: Viewer, friendId: string) {
  if (friendId === v.id || !(await isAcceptedFriend(env, v.id, friendId)) || (await isBlocked(env, v.id, friendId))) throw new HttpError(404, "not_found");
  const [x, y] = pair(v.id, friendId);
  const who = await first<{ handle: string | null; name: string | null; since: string }>(env,
    `SELECT u.handle, u.display_name AS name, f.created_at AS since FROM users u JOIN friendships f ON f.user_a = ?2 AND f.user_b = ?3 WHERE u.id = ?1`, friendId, x, y);
  if (!who) throw new HttpError(404, "not_found");
  const cars = await all<Record<string, unknown>>(env,
    `SELECT ${PUBLIC_COLS} FROM cars c WHERE c.owner = ? AND c.shared = 1 AND NOT ${reportedSql("car", "c.id")} ORDER BY c.is_primary DESC, c.created_at LIMIT 10`, friendId);
  const crews = await all<{ name: string }>(env,
    `SELECT cr.name FROM crews cr JOIN crew_members a ON a.crew_id = cr.id AND a.user_id = ?1 JOIN crew_members b ON b.crew_id = cr.id AND b.user_id = ?2
      ORDER BY cr.name LIMIT 20`, v.id, friendId);
  // only stages the viewer has too (named as the viewer named them): a friend's private stage names never show
  const stages = await all<{ stage: string; best: number; days_month: number }>(env,
    `SELECT MIN(s.name) AS stage, MAX(be.driver_score) AS best,
            COUNT(DISTINCT CASE WHEN be.driven_on >= date('now', 'start of month') THEN be.driven_on END) AS days_month
       FROM board_entries be JOIN segments s ON s.owner = ?1 AND COALESCE(s.origin_id, s.id) = be.canon_id
      WHERE be.user_id = ?2 AND (${VISIBLE_FROM_OTHERS})
      GROUP BY be.canon_id ORDER BY days_month DESC, best DESC LIMIT 50`, v.id, friendId);
  return {
    handle: who.handle, name: who.name, friends_since: who.since.slice(0, 10), cars, crews: crews.map((c) => c.name),
    stages: stages.slice(0, 5),
    totals: { stages: stages.length, days_month: stages.reduce((n, s) => n + s.days_month, 0), best: stages.length ? Math.max(...stages.map((s) => s.best)) : null },
  };
}
