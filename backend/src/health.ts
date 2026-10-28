// App health counts (IDEAS Y-03, web/health.js): each phone sends yesterday's totals of a few named events once a day,
// anonymously (no session is read, nothing about the phone or a place is stored), when its Settings switch is on. They add
// up per day, app and metric in health_counts, with how many reports added to each, so the owner reads rates: routing
// failures per route asked, road uploads that failed, how long the mount takes to calibrate. Owner view: GET /api/ops/health.
import { Env, HttpError, body } from "./util";

/** The only metrics accepted; anything else in a report is ignored. Keep in step with web/health.js. */
export const METRICS = ["drives", "route_ok", "route_fail", "route_fallback", "road_upload_ok", "road_upload_fail",
  "hazard_queued", "hazard_sent_late", "calib_locked", "calib_lock_s", "directions_said", "crash_asked"] as const;
const MAX_N = 100_000, MAX_AGE_DAYS = 7, KEEP_DAYS = 90;

export async function healthReport(req: Request, env: Env): Promise<void> {
  const b = await body<{ day?: unknown; app?: unknown; counts?: unknown }>(req);
  if (b.app !== "ios" && b.app !== "web") throw new HttpError(400, "bad_app");
  if (typeof b.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.day)) throw new HttpError(400, "bad_day");
  const age = (Date.now() - Date.parse(b.day + "T00:00:00Z")) / 86400_000;
  if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_DAYS + 1) throw new HttpError(400, "bad_day");    // a finished day, not too old
  if (!b.counts || typeof b.counts !== "object" || Array.isArray(b.counts)) throw new HttpError(400, "bad_counts");
  const counts = b.counts as Record<string, unknown>;
  const rows = METRICS.filter((m) => counts[m] !== undefined).map((m) => {
    const n = counts[m];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MAX_N) throw new HttpError(400, "bad_counts");
    return [m, n] as const;
  }).filter(([, n]) => n > 0);
  if (!rows.length) return;
  await env.DB.batch(rows.map(([m, n]) => env.DB.prepare(
    `INSERT INTO health_counts (day, app, metric, n, reports) VALUES (?, ?, ?, ?, 1)
     ON CONFLICT (day, app, metric) DO UPDATE SET n = n + excluded.n, reports = reports + 1`).bind(b.day, b.app, m, n)));
}

/** { days, rows: [{ metric, app, n, reports }] } over the last `days` (1–30), totals per metric and app. */
export async function healthSummary(env: Env, url: URL) {
  const days = Math.min(30, Math.max(1, Math.floor(Number(url.searchParams.get("days") ?? 7)) || 7));
  const rows = (await env.DB.prepare(
    `SELECT metric, app, SUM(n) AS n, SUM(reports) AS reports FROM health_counts WHERE day >= date('now', ?)
      GROUP BY metric, app ORDER BY metric, app`).bind(`-${days} days`).all<{ metric: string; app: string; n: number; reports: number }>()).results;
  return { days, rows };
}

export const HEALTH_SWEEP = `DELETE FROM health_counts WHERE day < date('now', '-${KEEP_DAYS} days')`;
