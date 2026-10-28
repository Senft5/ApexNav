// Client crash and error reports (docs/IDEAS.md Y-02, web/errors.js) and the Worker's own 500s. Anonymous: no session is read.
// A report is validated, scrubbed again (the client may be old or hostile) and written as one structured log line, which Workers
// Logs keeps (wrangler.jsonc observability). It is also counted per day in error_counts (migration 0010): the same scrubbed text
// and nothing that identifies a person, so a crash can be triaged with D1 access alone. Owner view: GET /api/ops/errors.
import { Env, HttpError, body, int } from "./util";

/** Same rules as web/errors.js scrub(): URLs lose query and fragment, e-mails, precise numbers and token-like strings go. */
export function scrub(text: string, max: number): string {
  let s = text;
  s = s.replace(/\bdata:[^\s)'"]+/g, "data:[…]");
  s = s.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s)'"]+/gi, (u) => u.replace(/[?#].*?((?::\d+){1,2})?$/, "$1"));
  s = s.replace(/[\w.+-]+(?:@|%40)[\w-]+(\.[\w-]+)+/gi, "[email]");
  s = s.replace(/-?\d{1,3}\.\d{3,}/g, "[num]");
  s = s.replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g, "[token]");
  return s.length > max ? s.slice(0, max) : s;
}

const KINDS = new Set(["error", "rejection"]);
const APPS = new Set(["ios", "web"]);
const text = (v: unknown, field: string, max: number): string => {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string" || v.length > max * 2) throw new HttpError(400, `bad_${field}`);
  return scrub(v, max);
};

// Distinct rows per day before new errors fold into one overflow row: a flood of unique junk can't grow the table without bound.
export const DAY_CAP = 500;
const KEEP_DAYS = 30;

interface Counted { source: "ios" | "web" | "server"; kind: string; message: string; page: string; stack: string }

/** Adds one to today's count for this error. Never throws: counting must not turn a report or a 500 into another failure. */
export async function countError(env: Env, e: Counted): Promise<void> {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const bump = (msg: string, page: string) => env.DB.prepare(
      "UPDATE error_counts SET n = n + 1, last_at = datetime('now') WHERE day = ? AND source = ? AND kind = ? AND message = ? AND page = ?")
      .bind(day, e.source, e.kind, msg, page).run();
    if ((await bump(e.message, e.page)).meta.changes) return;
    const ins = await env.DB.prepare(
      `INSERT INTO error_counts (day, source, kind, message, page, stack) SELECT ?1, ?2, ?3, ?4, ?5, ?6
        WHERE (SELECT COUNT(*) FROM error_counts WHERE day = ?1) < ?7 ON CONFLICT DO UPDATE SET n = n + 1, last_at = datetime('now')`)
      .bind(day, e.source, e.kind, e.message, e.page, e.stack, DAY_CAP).run();
    if (!ins.meta.changes) {
      await env.DB.prepare(`INSERT INTO error_counts (day, source, kind, message, page) VALUES (?, ?, ?, '[over daily cap]', '')
                            ON CONFLICT DO UPDATE SET n = n + 1, last_at = datetime('now')`).bind(day, e.source, e.kind).run();
      return;
    }
    await env.DB.prepare("DELETE FROM error_counts WHERE day < date('now', ?)").bind(`-${KEEP_DAYS} days`).run();   // new row: prune
  } catch (err) {
    console.error("error_counts", err);
  }
}

/** An unexpected exception in a route: counted under the route's pattern (never the concrete path, which can hold ids). */
export async function serverError(env: Env, route: string, err: unknown): Promise<void> {
  const name = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const stack = err instanceof Error && err.stack ? err.stack : "";
  await countError(env, { source: "server", kind: route, message: scrub(name, 300) || "(no message)", page: "", stack: scrub(stack, 2000) });
}

/** Owner only (checked by the caller): the last few days' counts, most frequent first. */
export async function errorSummary(env: Env, url: URL) {
  const days = url.searchParams.has("days") ? int(Number(url.searchParams.get("days")), "days", 1, KEEP_DAYS) : 7;
  const rows = (await env.DB.prepare(
    `SELECT source, kind, message, page, SUM(n) AS n, COUNT(*) AS days, MIN(day) AS first_day, MAX(last_at) AS last_at,
            (SELECT stack FROM error_counts s WHERE s.source = e.source AND s.kind = e.kind AND s.message = e.message AND s.page = e.page
              ORDER BY day DESC LIMIT 1) AS stack
       FROM error_counts e WHERE day >= date('now', ?) GROUP BY source, kind, message, page ORDER BY n DESC LIMIT 200`)
    .bind(`-${days - 1} days`).all()).results;
  return { days, errors: rows };
}

export async function clientError(req: Request, env: Env): Promise<void> {
  const b = await body<Record<string, unknown>>(req);
  if (typeof b.kind !== "string" || !KINDS.has(b.kind)) throw new HttpError(400, "bad_kind");
  if (typeof b.app !== "string" || !APPS.has(b.app)) throw new HttpError(400, "bad_app");
  const report = { event: "client_error", kind: b.kind, app: b.app, message: text(b.message, "message", 300),
                   stack: text(b.stack, "stack", 2000), page: text(b.page, "page", 80) };
  if (!report.message) throw new HttpError(400, "bad_message");
  console.log(JSON.stringify(report));
  await countError(env, { source: report.app as "ios" | "web", kind: report.kind, message: report.message, page: report.page, stack: report.stack });
}
