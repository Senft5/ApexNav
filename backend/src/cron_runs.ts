// The cron jobs' own record (migration 0055): a failed weekly backup or daily sweep used to be one log line nobody reads.
// Each run now leaves its time in cron_runs, a failure is also counted with the Worker's 500s (GET /api/ops/errors), and
// GET /api/health says how old the last good run is, which the status workflow turns into an outage issue.
import { Env } from "./util";
import { scrub, serverError } from "./errors";

export type Job = "backup" | "sweep";
/** A job is late past one missed run plus slack: the backup is weekly (Mondays), the sweep daily. */
export const LATE_H: Record<Job, number> = { backup: 8 * 24 + 6, sweep: 2 * 24 + 6 };

/** Runs the job and records how it went. Never throws: the cron's own failure is recorded, not rethrown. */
export async function runCron(env: Env, job: Job, work: () => Promise<unknown>): Promise<boolean> {
  try {
    await work();
  } catch (e) {
    const reason = scrub(e instanceof Error ? `${e.name}: ${e.message}` : String(e), 300);
    console.error(JSON.stringify({ event: `${job}_failed`, reason }));
    await serverError(env, `cron ${job}`, e);
    await record(env, `INSERT INTO cron_runs (job, fail_at, reason) VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?2)
                       ON CONFLICT (job) DO UPDATE SET fail_at = excluded.fail_at, reason = excluded.reason`, job, reason);
    return false;
  }
  await record(env, `INSERT INTO cron_runs (job, ok_at) VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT (job) DO UPDATE SET ok_at = excluded.ok_at`, job);
  return true;
}

async function record(env: Env, sql: string, ...args: string[]): Promise<void> {
  try { await env.DB.prepare(sql).bind(...args).run(); } catch (e) { console.error("cron_runs", e); }
}

export interface CronState { age_h: number | null; failing: boolean; late: boolean }

/** Each job's hours since its last good run (null: never recorded here), whether its latest run failed, and whether it is
 *  late. One read; it also proves the database answers, which is what /api/health was for. */
export async function cronHealth(env: Env, now = Date.now()): Promise<Record<Job, CronState>> {
  const rows = (await env.DB.prepare("SELECT job, ok_at, fail_at FROM cron_runs").all<{ job: string; ok_at: string | null; fail_at: string | null }>()).results;
  // ok_at / fail_at are ISO with milliseconds (a run that fails just after one that finished must not tie); a time written
  // by hand as datetime('now') reads as UTC too
  const at = (s: string | null) => (s ? Date.parse(s.includes("T") ? s : s.replace(" ", "T") + "Z") : NaN);
  const out = {} as Record<Job, CronState>;
  for (const job of Object.keys(LATE_H) as Job[]) {
    const r = rows.find((x) => x.job === job), ok = at(r?.ok_at ?? null), fail = at(r?.fail_at ?? null);
    const age_h = Number.isFinite(ok) ? Math.round((now - ok) / 360_000) / 10 : null;
    const failing = Number.isFinite(fail) && !(ok >= fail);
    out[job] = { age_h, failing, late: age_h !== null && age_h > LATE_H[job] };
  }
  return out;
}
