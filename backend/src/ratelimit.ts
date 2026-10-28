// Abuse protection on every write and every sign-in endpoint (docs/IDEAS.md Y-10). Cloudflare's rate limiting binding:
// free, no database writes, counted per Cloudflare location (approximate by design, which is fine for abuse, not billing).
// Reads are not limited here: they are member-only and cheap. Per-feature caps (uploads per hour, crews, highlights per day)
// stay where they are; this is the floor under all of them.
import { Env, HttpError } from "./util";
import { sessionHash } from "./auth";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Sign-in steps limited per IP: starting one, and the app's code exchange. Not the Google callback (many people can share a
// carrier-NAT address, and a 429 there loses a sign-in the person already consented to) and not logout (it must always work).
const AUTH_LIMITED = new Set(["/api/auth/google/start", "/api/auth/app/exchange"]);

/** Throws 429 when this request is over its limit. Without a binding (a test env without it) nothing is limited. */
export async function rateCheck(req: Request, env: Env, path: string): Promise<void> {
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  if (path.startsWith("/api/auth/")) {
    if (!AUTH_LIMITED.has(path)) return;
    if (env.AUTH_LIMIT && !(await env.AUTH_LIMIT.limit({ key: `ip:${ip}` })).success) throw new HttpError(429, "rate_limited");
    return;
  }
  if (!WRITE_METHODS.has(req.method) || !env.WRITE_LIMIT) return;
  const session = await sessionHash(req);
  if (!(await env.WRITE_LIMIT.limit({ key: session ? `s:${session}` : `ip:${ip}` })).success) throw new HttpError(429, "rate_limited");
}
