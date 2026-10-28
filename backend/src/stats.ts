// Server latency and error rates (IDEAS Y-17): one row per day and API route in D1 (route_stats, migration 0021), so the
// owner (GET /api/ops/latency) and an agent with D1 access can read how the API is doing without the Cloudflare dashboard.
// Sampled 1 in STATS_SAMPLE and weighted back up; 5xx always counted exactly. Written after the response (waitUntil).
import { Env } from "./util";

export const STATS_SAMPLE = 10, KEEP_DAYS = 90;

/** Adds one request to today's row. `weight` is how many requests this sample stands for (0: count only the 5xx). Never throws. */
export async function recordStat(env: Env, route: string, status: number, ms: number, weight: number): Promise<void> {
  try {
    const day = new Date().toISOString().slice(0, 10), w = Math.max(0, Math.round(weight)), t = Math.max(0, Math.round(ms));
    const b = t < 100 ? "lt100" : t < 300 ? "lt300" : t < 1000 ? "lt1000" : "ge1000";
    await env.DB.prepare(
      `INSERT INTO route_stats (day, route, n, s4xx, s5xx, ms_sum, ${b}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?3)
       ON CONFLICT (day, route) DO UPDATE SET n = n + ?3, s4xx = s4xx + ?4, s5xx = s5xx + ?5, ms_sum = ms_sum + ?6, ${b} = ${b} + ?3`)
      .bind(day, route.slice(0, 80), w, status >= 400 && status < 500 ? w : 0, status >= 500 ? 1 : 0, t * w).run();
  } catch (e) {
    console.error("route_stats", e);
  }
}

/** Over the last `days` (1–30): per route, requests, error rates, mean and an estimated p95 from the buckets. */
export async function statsSummary(env: Env, url: URL) {
  const days = Math.min(30, Math.max(1, Math.floor(Number(url.searchParams.get("days") ?? 7)) || 7));
  const rows = (await env.DB.prepare(
    `SELECT route, SUM(n) AS n, SUM(s4xx) AS s4xx, SUM(s5xx) AS s5xx, SUM(ms_sum) AS ms_sum, SUM(lt100) AS lt100, SUM(lt300) AS lt300,
            SUM(lt1000) AS lt1000, SUM(ge1000) AS ge1000 FROM route_stats WHERE day >= date('now', ?) GROUP BY route ORDER BY n DESC LIMIT 60`)
    .bind(`-${days} days`).all<{ route: string; n: number; s4xx: number; s5xx: number; ms_sum: number; lt100: number; lt300: number; lt1000: number; ge1000: number }>()).results;
  return { days, rows: rows.map((r) => ({ route: r.route, n: r.n, s4xx: r.s4xx, s5xx: r.s5xx, mean_ms: r.n ? Math.round(r.ms_sum / r.n) : null, p95_ms: p95(r) })) };
}

/** The bucket's upper bound where 95% of requests are under (">1000" past the last). */
export function p95(r: { n: number; lt100: number; lt300: number; lt1000: number; ge1000: number }): string | null {
  if (!r.n) return null;
  const want = 0.95 * r.n;
  if (r.lt100 >= want) return "<100";
  if (r.lt100 + r.lt300 >= want) return "<300";
  if (r.lt100 + r.lt300 + r.lt1000 >= want) return "<1000";
  return ">1000";
}

export const STATS_SWEEP = `DELETE FROM route_stats WHERE day < date('now', '-${KEEP_DAYS} days')`;
