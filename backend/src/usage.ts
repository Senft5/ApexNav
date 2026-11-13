// Usage guard (the owner, 2026-11-13: "guard me up", Workers Paid at $5 a month and not a cent more). Cloudflare's Spend
// Management block covers Workers requests and CPU and Durable Objects only, not D1, KV or R2, so the Worker keeps its own
// count of those: each request's D1 rows read and written (from every result's meta, src/query_budget.ts) and its KV calls
// are summed per isolate and flushed every FLUSH_MS into error_counts (no migration: source 'server', kind 'usage',
// message = the metric, one row per day). Once this month's sum of any metric reaches SHED_AT of the plan's included
// amount, the heavy optional writes (road uploads, photos, the weekly backup) stop until the 1st with a plain 503 the app
// says once (web/sync.js 'apex:server-down'). Everything else keeps working. Owner view: the Service check's server side.
// The count is a floor, not the bill: an isolate that is evicted before it flushes loses its last few seconds, and the
// billing period may not start on the 1st, which is why the line is at 80% and not 100%.
import { Env } from "./util";

export const KIND = "usage";
/** Workers Paid's included amounts a month (developers.cloudflare.com/workers/platform/pricing, 2026-11). */
export const INCLUDED = { d1_read: 25e9, d1_written: 50e6, kv_read: 10e6, kv_write: 1e6 } as const;
export type Metric = keyof typeof INCLUDED;
export const SHED_AT = 0.8;
const FLUSH_MS = 30_000, CHECK_MS = 5 * 60_000;
/** Routes that stop near the limit: optional, heavy on writes, and the app keeps them for later (uploads queue, photos retry). */
export const SHED_ROUTES = new Set(["POST /api/contribute", "POST /api/photos"]);

const acc: Record<Metric, number> = { d1_read: 0, d1_written: 0, kv_read: 0, kv_write: 0 };
let lastFlush = Date.now();

/** Adds one D1 result's meta (rows_read / rows_written) to this isolate's count. */
export function noteD1(meta: unknown): void {
  const m = (meta ?? {}) as { rows_read?: unknown; rows_written?: unknown };
  if (typeof m.rows_read === "number" && m.rows_read > 0) acc.d1_read += m.rows_read;
  if (typeof m.rows_written === "number" && m.rows_written > 0) acc.d1_written += m.rows_written;
}

const KV_WRITES = new Set(["put", "delete", "list"]);   // list and delete bill like writes (1M a month each); counted with them
const KV_READS = new Set(["get", "getWithMetadata"]);
/** A KVNamespace that counts its calls (reads and writes) into this isolate's count. */
export function countedKv(kv: KVNamespace): KVNamespace {
  return new Proxy(kv, {
    get(t, k) {
      const v = Reflect.get(t, k, t);
      if (typeof v !== "function") return v;
      if (typeof k === "string" && KV_WRITES.has(k)) return (...a: unknown[]) => { acc.kv_write++; return v.apply(t, a); };
      if (typeof k === "string" && KV_READS.has(k)) return (...a: unknown[]) => { acc.kv_read++; return v.apply(t, a); };
      return v.bind(t);
    },
  });
}

/** Writes this isolate's count into today's rows when it is FLUSH_MS old (or `force`). Never throws. */
export async function flushUsage(env: Env, force = false, now = Date.now()): Promise<void> {
  if (!force && now - lastFlush < FLUSH_MS) return;
  const take = (Object.keys(acc) as Metric[]).filter((k) => acc[k] > 0).map((k) => [k, acc[k]] as const);
  lastFlush = now;
  if (!take.length) return;
  for (const [k] of take) acc[k] = 0;
  const day = new Date(now).toISOString().slice(0, 10);
  try {
    await env.DB.batch(take.map(([k, n]) => env.DB.prepare(
      `INSERT INTO error_counts (day, source, kind, message, page, n) VALUES (?, 'server', '${KIND}', ?, '', ?)
       ON CONFLICT DO UPDATE SET n = n + excluded.n, last_at = datetime('now')`).bind(day, k, Math.round(n))));
  } catch (err) {
    for (const [k, n] of take) acc[k] += n;   // the next flush tries again
    console.error("usage_flush", err);
  }
}

/** The first of next month (UTC), when the counts start again. */
export const nextMonthUtc = (now = Date.now()) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); };

export interface UsageState { month: string; used: Record<Metric, number>; share: Record<Metric, number>; shedding: boolean; until: string | null }

/** This month's sums so far, read from error_counts (one small query: a row per metric per day). */
export async function usageNow(env: Env, now = Date.now()): Promise<UsageState> {
  const month = new Date(now).toISOString().slice(0, 7);
  const rows = (await env.DB.prepare(
    `SELECT message, SUM(n) AS n FROM error_counts WHERE day >= ? AND source = 'server' AND kind = '${KIND}' GROUP BY message`)
    .bind(`${month}-01`).all<{ message: string; n: number }>()).results;
  const used = { d1_read: 0, d1_written: 0, kv_read: 0, kv_write: 0 } as Record<Metric, number>;
  for (const r of rows) if (r.message in INCLUDED) used[r.message as Metric] = Number(r.n) || 0;
  for (const k of Object.keys(acc) as Metric[]) used[k] += acc[k];   // what this isolate has not flushed yet
  const share = {} as Record<Metric, number>;
  for (const k of Object.keys(INCLUDED) as Metric[]) share[k] = Math.round((used[k] / INCLUDED[k]) * 1000) / 1000;
  const shedding = Object.values(share).some((s) => s >= SHED_AT);
  return { month, used, share, shedding, until: shedding ? new Date(nextMonthUtc(now)).toISOString() : null };
}

let cached: { at: number; state: UsageState } | null = null;
/** usageNow, read at most every CHECK_MS per isolate. A failed read sheds nothing: the guard must not take the app down. */
export async function usageState(env: Env, now = Date.now()): Promise<UsageState | null> {
  if (cached && now - cached.at < CHECK_MS) return cached.state;
  try {
    cached = { at: now, state: await usageNow(env, now) };
    return cached.state;
  } catch (err) {
    console.error("usage_state", err);
    return cached?.state ?? null;
  }
}

/** Tests only: start from nothing. */
export function resetUsageForTest(): void {
  for (const k of Object.keys(acc) as Metric[]) acc[k] = 0;
  cached = null;
  lastFlush = Date.now();
}
