// Abuse protection on every write and every sign-in endpoint (docs/IDEAS.md Y-10). Cloudflare's rate limiting binding:
// free, no database writes, counted per Cloudflare location (approximate by design, which is fine for abuse, not billing).
// Reads: the relays (RELAYS) need no account and ask a public service (Overpass, Valhalla, a state feed) on a miss, so they
// are limited per IP so nobody scrapes those through us. A signed-in read is limited per session and a signed-out one per IP (READ_LIMIT, generous:
// a phone polls a handful of endpoints a minute), so one account can't walk the API to scrape people, crews or spots; the
// static map tiles (TILE_PREFIXES) are left out, a plan reads many. Per-feature caps (uploads per hour, crews, highlights
// per day) stay where they are; this is the floor under all of them.
import { Env, HttpError } from "./util";
import { sessionHash } from "./auth";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Sign-in steps limited per IP: starting one, and the app's code exchange. Not the Google callback (many people can share a
// carrier-NAT address, and a 429 there loses a sign-in the person already consented to) and not logout (it must always work).
const AUTH_LIMITED = new Set(["/api/auth/google/start", "/api/auth/app/exchange", "/api/auth/apple"]);

// The relays a signed-out phone uses while planning; a plan asks a few dozen tiles, so the limit (wrangler.jsonc) is generous.
export const RELAYS = new Set(["/api/ctx/osm", "/api/ctx/trace", "/api/ctx/workzones"]);

export const TILE_PREFIXES = ["/api/graph/", "/api/ctx/v1/"];

/** Throws 429 when this request is over its limit. Without a binding (a test env without it) nothing is limited. */
export async function rateCheck(req: Request, env: Env, path: string): Promise<void> {
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  if (path.startsWith("/api/auth/")) {
    if (!AUTH_LIMITED.has(path)) return;
    if (env.AUTH_LIMIT && !(await env.AUTH_LIMIT.limit({ key: `ip:${ip}` })).success) throw new HttpError(429, "rate_limited");
    return;
  }
  if (RELAYS.has(path)) {
    if (env.RELAY_LIMIT && !(await env.RELAY_LIMIT.limit({ key: `ip:${ip}` })).success) throw new HttpError(429, "rate_limited");
    return;
  }
  if (!WRITE_METHODS.has(req.method)) {
    if (!env.READ_LIMIT || TILE_PREFIXES.some((p) => path.startsWith(p))) return;
    // signed out, per IP: the public reads (road books near a point, a shared ETA, flags) are D1 reads like any other.
    // A made-up token is charged per IP as well, where auth.ts viewer() finds no session for it.
    const s = await sessionHash(req);
    if (!(await env.READ_LIMIT.limit({ key: s ? `s:${s}` : `ip:${ip}` })).success) throw new HttpError(429, "rate_limited");
    return;
  }
  if (!env.WRITE_LIMIT) return;
  // Keyed per session only when the session is real: a made-up bearer token or cookie would otherwise get a fresh key on
  // every request and slip past the per-IP limit on the signed-out writes (/api/errors, /api/app-health, /api/feedback).
  const session = await sessionHash(req);
  const live = session && await env.DB.prepare("SELECT 1 FROM sessions WHERE id_hash = ? AND expires_at > datetime('now')")
    .bind(session).first();
  if (!(await env.WRITE_LIMIT.limit({ key: live ? `s:${session}` : `ip:${ip}` })).success) throw new HttpError(429, "rate_limited");
}
