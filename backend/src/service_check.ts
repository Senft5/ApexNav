// Service check (web/service_check.js; the owner, 2026-11-12): the owner's phone asks every service the app leans on and
// sends what it saw here. Owner only (isModerator): nobody else can send or read one. Each result is counted per day in
// error_counts (no migration: kind 'service', message "<id>: <up|slow|down>", stack = the latest run's JSON for it), so an
// agent with D1 access reads the phone's view with
//   SELECT day, source, message, n, stack, last_at FROM error_counts WHERE kind = 'service' ORDER BY last_at DESC
// The Worker's own side (GET /api/ops/service-check/server) says which bindings and secrets are set and asks the upstreams
// it relays (GitHub's graph-data branch, the Overpass mirrors) from Cloudflare, so a phone-side failure can be told apart
// from a server-side one. Nothing here names a person or a place but the fixed test one.
import { MIRRORS, MIRROR_MS, UA, query as osmQuery } from "./osm_relay";
import { RAW } from "./graph";
import { Env, HttpError, body } from "./util";
import { scrub } from "./errors";

const STATES = new Set(["up", "slow", "down", "skip"]);
const ID = /^[a-z][a-z0-9_]{1,31}$/;
const MAX_RESULTS = 60;
export const KIND = "service";

export interface CheckResult { id: string; state: string; http: number | null; ms: number; detail: string }

/** The phone's report, validated: { app, version, build, online, results }. Throws 400 on anything malformed. */
export function parseReport(b: Record<string, unknown>) {
  if (b.app !== "ios" && b.app !== "web") throw new HttpError(400, "bad_app");
  const str = (v: unknown, max: number) => (typeof v === "string" ? scrub(v, max) : "");
  if (!Array.isArray(b.results) || !b.results.length || b.results.length > MAX_RESULTS) throw new HttpError(400, "bad_results");
  const results: CheckResult[] = b.results.map((x) => {
    const r = (x ?? {}) as Record<string, unknown>;
    if (typeof r.id !== "string" || !ID.test(r.id) || typeof r.state !== "string" || !STATES.has(r.state)) throw new HttpError(400, "bad_results");
    const http = typeof r.http === "number" && Number.isInteger(r.http) && r.http >= 0 && r.http < 1000 ? r.http : null;
    const ms = typeof r.ms === "number" && Number.isFinite(r.ms) ? Math.max(0, Math.min(600_000, Math.round(r.ms))) : 0;
    return { id: r.id, state: r.state, http, ms, detail: str(r.detail, 160) };
  });
  return { app: b.app as "ios" | "web", version: str(b.version, 16), build: str(b.build, 16), online: b.online !== false, results };
}

/** POST /api/ops/service-check: keeps each result (today's row per service and state, the latest detail in `stack`). */
export async function serviceReport(req: Request, env: Env) {
  const r = parseReport(await body<Record<string, unknown>>(req));
  const day = new Date().toISOString().slice(0, 10), at = new Date().toISOString();
  console.log(JSON.stringify({ event: "service_check", app: r.app, version: r.version, build: r.build, online: r.online,
    down: r.results.filter((x) => x.state === "down").map((x) => x.id) }));
  await env.DB.batch(r.results.map((x) => env.DB.prepare(
    `INSERT INTO error_counts (day, source, kind, message, page, stack) VALUES (?, ?, ?, ?, '', ?)
     ON CONFLICT DO UPDATE SET n = n + 1, last_at = datetime('now'), stack = excluded.stack`)
    .bind(day, r.app, KIND, `${x.id}: ${x.state}`, JSON.stringify({ http: x.http, ms: x.ms, detail: x.detail, at, version: r.version, build: r.build, online: r.online }))));
  return { kept: r.results.length };
}

/** GET /api/ops/service-check?days=: the last few days' results, newest first, per service and state. */
export async function serviceHistory(env: Env, url: URL) {
  const days = Math.min(30, Math.max(1, Math.floor(Number(url.searchParams.get("days") ?? 3)) || 3));
  const rows = (await env.DB.prepare(
    `SELECT day, source AS app, message, n, stack, last_at FROM error_counts WHERE kind = ? AND day >= date('now', ?)
      ORDER BY last_at DESC LIMIT 400`).bind(KIND, `-${days - 1} days`).all<{ day: string; app: string; message: string; n: number; stack: string; last_at: string }>()).results;
  return { days, rows: rows.map((x) => {
    const [id, state] = x.message.split(": ");
    let last: unknown = null;
    try { last = JSON.parse(x.stack); } catch { last = null; }
    return { day: x.day, app: x.app, id, state, n: x.n, last_at: x.last_at, last };
  }) };
}

async function timed(fn: () => Promise<Response>, ms: number) {
  const t0 = Date.now();
  try {
    const r = await Promise.race([fn(), new Promise<never>((_, no) => setTimeout(() => no(new Error("timed out")), ms))]);
    const text = await r.text();
    return { http: r.status, ok: r.ok, ms: Date.now() - t0, text };
  } catch (e) { return { http: null, ok: false, ms: Date.now() - t0, text: "", error: String((e as Error)?.message || e).slice(0, 80) }; }
}

/** GET /api/ops/service-check/server: the Worker's config (set or not, never a value) and its upstreams, from Cloudflare. */
export async function serverSide(env: Env, fetcher: typeof fetch = fetch) {
  const set = (v: unknown) => !!v;
  const config = {
    db: set(env.DB), owner_email: set(env.OWNER_EMAIL), pepper: set(env.PEPPER), google: set(env.GOOGLE_CLIENT_ID) && set(env.GOOGLE_CLIENT_SECRET),
    ctx_keys: set(env.CTX_KEYS), nrel_key: set(env.NREL_API_KEY), osm_kv: set(env.OSM), ctx_kv: set(env.CTX), photos_kv: set(env.PHOTOS),
    backups_kv: set(env.BACKUPS), flags: set(env.FLAGS), write_limit: set(env.WRITE_LIMIT), convoy: set(env.CONVOY),
  };
  let db = false;
  try { db = !!(await env.DB.prepare("SELECT 1 AS one").first()); } catch { db = false; }
  const q = osmQuery(["782_-1691"]);
  const [graph, ...mirrors] = await Promise.all([
    timed(() => fetcher(RAW + "index.json"), 10_000),
    ...MIRRORS.map((url) => timed(() => fetcher(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA } }), MIRROR_MS)),
  ]);
  let tiles: number | null = null;
  try { tiles = graph.ok ? Object.keys((JSON.parse(graph.text) as { tiles?: object }).tiles || {}).length : null; } catch { tiles = null; }
  const elements = (t: string) => { try { const j = JSON.parse(t) as { elements?: unknown[] }; return Array.isArray(j.elements) ? j.elements.length : null; } catch { return null; } };
  return {
    at: new Date().toISOString(), config, db,
    graph_data: { http: graph.http, ms: graph.ms, tiles, ...(graph.error ? { error: graph.error } : {}) },
    overpass: MIRRORS.map((url, i) => ({ host: new URL(url).host, http: mirrors[i].http, ms: mirrors[i].ms, elements: mirrors[i].ok ? elements(mirrors[i].text) : null,
      ...(mirrors[i].error ? { error: mirrors[i].error } : {}) })),
  };
}
