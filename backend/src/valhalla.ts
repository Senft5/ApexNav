// Our own Valhalla router (2026-11-15, Nate: "why don't we just do those"): the Quick route, the drive-time matrix and
// the map matching the phone used to ask only of the public FOSSGIS server (valhalla1.openstreetmap.de), which has no
// uptime promise for an app. It runs in a Cloudflare Container (router/Dockerfile) behind one Durable Object,
// ValhallaRouter, with tiles for the region our tiles are built for (.github/workflows/valhalla-tiles.yml, R2 keys
// valhalla/v1/...). The phone asks POST /api/valhalla/<action> first and the public server when we answer anything but
// 200 (web/route_loading.js valhalla()): outside the region, while the container starts, or when it is off.
//
// Nothing is kept: no route, point or answer is logged or stored, the same as the relays (docs/APP_REVIEW.md).
// Production only: previews have no container (wrangler.jsonc), so there the binding is missing and every call is 503.
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { decode6 } from "./trace_relay";
import { Env, HttpError, json } from "./util";
import { REGION_RINGS } from "./valhalla_region";

export const ACTIONS = new Set(["route", "sources_to_targets", "trace_attributes", "trace_route", "locate", "optimized_route"]);
export const PATHS = [...ACTIONS].map((a) => `/api/valhalla/${a}`);
export const MAX_BODY = 1_000_000, MAX_POINTS = 5000, TIMEOUT_MS = 12_000;
const PORT = 8002, IDLE_MS = 6 * 3600_000, PROBE_MS = 1000;
// a container fetches the tiles when it starts: one that has run past a week is restarted, so it picks up the weekly build
export const MAX_AGE_MS = 8 * 86400_000;
export const TILES_HOST = "tiles.vetta";   // the container's only way out: ValhallaTiles below, reading R2
export const TILE_KEY = /^valhalla\/v1\/(index\.json|b\/[\w.:-]{1,64}\/part-\d{3})$/;

/** Point in the region (ray casting over each ring). */
export function inRegion(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  for (const r of REGION_RINGS) {
    let inside = false;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

type Loc = { lat?: unknown; lon?: unknown };
/** Every point a Valhalla request names (locations, sources, targets, shape, encoded_polyline), or null when it has none
 *  we can read. A request we can't read the points of is not ours to answer. */
export function requestPoints(body: Record<string, unknown>): [number, number][] | null {
  const pts: [number, number][] = [];
  for (const k of ["locations", "sources", "targets", "shape"]) {
    const v = body[k];
    if (v === undefined) continue;
    if (!Array.isArray(v)) return null;
    for (const p of v as Loc[]) {
      if (!p || typeof p.lat !== "number" || typeof p.lon !== "number") return null;
      pts.push([p.lat, p.lon]);
    }
  }
  if (body.encoded_polyline !== undefined) {
    if (typeof body.encoded_polyline !== "string") return null;
    const line = decode6(body.encoded_polyline);
    if (!line) return null;
    pts.push(...line);
  }
  return pts.length && pts.length <= MAX_POINTS ? pts : null;
}

const notOurs = (reason: string) => json({ error: "not_served", reason }, 503, { "cache-control": "no-store", "x-router": "none" });

/** POST /api/valhalla/:action → our container, or 503 (the phone then asks the public server). */
export async function valhallaProxy(req: Request, env: Env, action: string): Promise<Response> {
  if (!ACTIONS.has(action)) throw new HttpError(404, "not_found");
  if (!env.VALHALLA) return notOurs("off");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) throw new HttpError(413, "too_big");
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "too_big");
  let body: Record<string, unknown>;
  try { body = JSON.parse(text); } catch { throw new HttpError(400, "bad_json"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "bad_json");
  const pts = requestPoints(body);
  if (!pts) return notOurs("no_points");
  if (!pts.every(([la, lo]) => inRegion(la, lo))) return notOurs("outside_region");
  try {
    const r = await env.VALHALLA.getByName("router").fetch(`http://router/${action}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: text, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const h = new Headers({ "content-type": r.headers.get("content-type") ?? "application/json", "cache-control": "no-store", "x-router": r.headers.get("x-router") ?? "own" });
    return new Response(r.body, { status: r.status, headers: h });
  } catch {
    return notOurs("timeout");
  }
}

/** Our router's answer to one call made inside the Worker (the stage trace relay, trace_relay.ts), or null when it can't
 *  give one: off, a point outside the region, starting, or no answer in `ms`. The caller then asks the public server. */
export async function ownValhalla(env: Pick<Env, "VALHALLA">, action: string, body: string, pts: [number, number][], ms = TIMEOUT_MS): Promise<Record<string, unknown> | null> {
  if (!env.VALHALLA || !ACTIONS.has(action) || !pts.length || !pts.every(([la, lo]) => inRegion(la, lo))) return null;
  try {
    const r = await env.VALHALLA.getByName("router").fetch(`http://router/${action}`, {
      method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(ms) });
    if (!r.ok || r.headers.get("x-router") !== "own") { await r.body?.cancel(); return null; }
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** GET /api/valhalla/status: whether our router answers now (the service check, web/service_check.js). */
export async function valhallaStatus(env: Env): Promise<Response> {
  if (!env.VALHALLA) return json({ own: false, reason: "off" }, 200, { "cache-control": "no-store" });
  try {
    const r = await env.VALHALLA.getByName("router").fetch("http://router/status", { signal: AbortSignal.timeout(3000) });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return json({ own: r.ok, ...(r.ok ? { version: j.version ?? null } : { reason: j.reason ?? "starting" }) }, 200, { "cache-control": "no-store" });
  } catch {
    return json({ own: false, reason: "timeout" }, 200, { "cache-control": "no-store" });
  }
}

/** What the container may read: our tile tar's parts and index from R2, GET only. */
export async function tileRead(env: Pick<Env, "DATA">, req: Request): Promise<Response> {
  if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
  const key = new URL(req.url).pathname.slice(1);
  if (!TILE_KEY.test(key) || !env.DATA) return new Response("not found", { status: 404 });
  const o = await env.DATA.get(key);
  if (!o) return new Response("not found", { status: 404 });
  return new Response(o.body, { headers: { "content-length": String(o.size), "content-type": "application/octet-stream" } });
}

/** The container's outbound handler for http://tiles.vetta/<key> (its only way out: started with no Internet). */
export class ValhallaTiles extends WorkerEntrypoint<Env> {
  fetch(req: Request): Promise<Response> { return tileRead(this.env, req); }
}

type Exports = { ValhallaTiles: Fetcher };

/** One container running valhalla_service on PORT. Answers 503 while it starts (downloading the tiles takes a minute or
 *  two); the phone has asked the public server by then. Sleeps after IDLE_MS without a request. */
export class ValhallaRouter extends DurableObject<Env> {
  private ready = false;
  private starting: Promise<void> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const c = ctx.container;
    if (c?.running) { void ctx.blockConcurrencyWhile(() => c.setInactivityTimeout(IDLE_MS)); this.watch(); }
  }

  private watch(): void {
    const c = this.ctx.container;
    if (!c) return;
    this.ctx.waitUntil(c.monitor().catch((e) => console.error(JSON.stringify({ event: "valhalla_exit", error: String(e).slice(0, 200) })))
      .finally(() => { this.ready = false; }));
  }

  private async start(): Promise<void> {
    const c = this.ctx.container!;
    if (c.running) return;
    this.ready = false;
    await c.interceptOutboundHttp(TILES_HOST, (this.ctx.exports as unknown as Exports).ValhallaTiles);
    c.start({ enableInternet: false, env: { TILES_URL: `http://${TILES_HOST}` } });
    await this.ctx.storage.put("startedAt", Date.now());
    await c.setInactivityTimeout(IDLE_MS);
    console.log(JSON.stringify({ event: "valhalla_start" }));
    this.watch();
  }

  private async isReady(): Promise<boolean> {
    if (this.ready) return true;
    try {
      const r = await this.ctx.container!.getTcpPort(PORT).fetch("http://container/status", { signal: AbortSignal.timeout(PROBE_MS) });
      await r.body?.cancel();
      this.ready = r.ok;
    } catch { this.ready = false; }
    return this.ready;
  }

  async fetch(req: Request): Promise<Response> {
    const c = this.ctx.container;
    if (!c) return json({ error: "not_served", reason: "no_container" }, 503);
    if (!c.running) {
      this.starting ??= this.start().finally(() => { this.starting = undefined; });
      try { await this.starting; } catch (e) { console.error(JSON.stringify({ event: "valhalla_start_failed", error: String(e).slice(0, 200) })); }
      return json({ error: "not_served", reason: "starting" }, 503);
    }
    const startedAt = await this.ctx.storage.get<number>("startedAt");
    if (startedAt && Date.now() - startedAt > MAX_AGE_MS) {
      console.log(JSON.stringify({ event: "valhalla_refresh" }));
      this.ready = false;
      await c.destroy().catch(() => {});
      return json({ error: "not_served", reason: "starting" }, 503);
    }
    if (!(await this.isReady())) return json({ error: "not_served", reason: "starting" }, 503);
    const url = new URL(req.url);
    try {
      const r = await c.getTcpPort(PORT).fetch(`http://container${url.pathname}`, { method: req.method, headers: { "content-type": "application/json" }, body: req.method === "POST" ? req.body : undefined });
      if (url.pathname === "/status") {
        const j = await r.json().catch(() => ({})) as Record<string, unknown>;
        return json({ version: j.version ?? null }, r.ok ? 200 : 503);
      }
      return new Response(r.body, { status: r.status, headers: { "content-type": r.headers.get("content-type") ?? "application/json", "x-router": "own" } });
    } catch {
      this.ready = false;
      return json({ error: "not_served", reason: "unreachable" }, 503);
    }
  }
}
