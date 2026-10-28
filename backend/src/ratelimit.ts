// Abuse protection on every write and every sign-in endpoint (docs/IDEAS.md Y-10). Cloudflare's rate limiting binding:
// free, no database writes, counted per Cloudflare location (approximate by design, which is fine for abuse, not billing).
// Reads are not limited here: they are member-only and cheap. Per-feature caps (uploads per hour, crews, highlights per day)
// stay where they are; this is the floor under all of them.
import { Env, HttpError } from "./util";
import { sessionHash } from "./auth";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Throws 429 when this request is over its limit. A missing binding (local dev) never limits. */
export async function rateCheck(req: Request, env: Env, path: string): Promise<void> {
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  if (path.startsWith("/api/auth/")) {
    if (env.AUTH_LIMIT && !(await env.AUTH_LIMIT.limit({ key: `ip:${ip}` })).success) throw new HttpError(429, "rate_limited");
    return;
  }
  if (!WRITE_METHODS.has(req.method) || !env.WRITE_LIMIT) return;
  const session = await sessionHash(req);
  if (!(await env.WRITE_LIMIT.limit({ key: session ? `s:${session}` : `ip:${ip}` })).success) throw new HttpError(429, "rate_limited");
}
