// Points ("Octane") totals. Points are written when a contribution is merged (contribute.ts); this module only reads them.
import { Env } from "./util";

/** ISO week label like 2026-W43 for a timestamp (UTC). */
export function isoWeek(ms: number): string {
  const d = new Date(ms); d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Totals only: mine, and a board of handle + total. Who was first is never exposed. */
export async function pointsFor(env: Env, userId: string) {
  const mine = await env.DB.prepare("SELECT iso_week AS week, ROUND(octane, 2) AS octane FROM points_ledger WHERE user_id = ? ORDER BY iso_week DESC LIMIT 26").bind(userId).all<{ week: string; octane: number }>();
  const board = await env.DB.prepare(
    `SELECT u.handle, ROUND(SUM(p.octane), 2) AS total FROM points_ledger p JOIN users u ON u.id = p.user_id JOIN members m ON m.user_id = u.id
      WHERE u.handle IS NOT NULL GROUP BY p.user_id ORDER BY total DESC LIMIT 50`).all<{ handle: string; total: number }>();
  const total = mine.results.reduce((s, r) => s + r.octane, 0);
  // your own pioneer badges (IDEAS S-09): roads you were first or second to map; never anyone else's
  const badges = await env.DB.prepare("SELECT pioneer_firsts AS firsts, pioneer_seconds AS seconds FROM members WHERE user_id = ?").bind(userId).first<{ firsts: number; seconds: number }>();
  return { total: Math.round(total * 100) / 100, weeks: mine.results, board: board.results, pioneer: { firsts: badges?.firsts ?? 0, seconds: badges?.seconds ?? 0 } };
}
