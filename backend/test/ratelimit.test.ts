// Abuse floor (src/ratelimit.ts): writes per session or IP, sign-in per IP, reads never limited, 429 says when to retry.
import { env } from "cloudflare:workers";
import worker from "../src/index";
import { beforeEach, describe, expect, it } from "vitest";
import { ORIGIN, freshDb, makeUser } from "./helpers";

beforeEach(freshDb);

/** A stand-in for the rate limiting binding: allows `allow` calls per key, records the keys it saw. */
function limiter(allow: number) {
  const seen: string[] = [], n = new Map<string, number>();
  return { seen, limit: async ({ key }: { key: string }) => { seen.push(key); n.set(key, (n.get(key) ?? 0) + 1); return { success: n.get(key)! <= allow }; } };
}
const call = (bindings: Record<string, unknown>, method: string, path: string, token?: string, ip = "203.0.113.7") => {
  const headers: Record<string, string> = { origin: ORIGIN, "x-apexnav": "1", "content-type": "application/json", "cf-connecting-ip": ip };
  if (token) headers.cookie = `__Host-ax_session=${token}`;
  const body = method === "GET" ? undefined : JSON.stringify({ name: `Crew ${crypto.randomUUID().slice(0, 6)}` });
  return worker.fetch(new Request(ORIGIN + path, { method, headers, body }), { ...env, ...bindings } as typeof env);
};

describe("rate limits", () => {
  it("limits writes per session, with retry-after, and never touches reads", async () => {
    const a = await makeUser("alice"), b = await makeUser("bobby");
    const w = limiter(2);
    expect((await call({ WRITE_LIMIT: w }, "POST", "/api/crews", a.token)).status).toBe(201);
    expect((await call({ WRITE_LIMIT: w }, "POST", "/api/crews", a.token)).status).toBe(201);
    const third = await call({ WRITE_LIMIT: w }, "POST", "/api/crews", a.token);
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBe("60");
    expect(await third.json()).toEqual({ error: "rate_limited" });
    expect((await call({ WRITE_LIMIT: w }, "POST", "/api/crews", b.token)).status).toBe(201);   // another person is not affected
    for (let i = 0; i < 5; i++) expect((await call({ WRITE_LIMIT: w }, "GET", "/api/crews", a.token)).status).toBe(200);
    expect(w.seen.every((k) => k.startsWith("s:") && !k.includes(a.token))).toBe(true);        // keyed by the session hash, not the token
  });

  it("limits signed-out writes and sign-in per IP", async () => {
    const w = limiter(1), au = limiter(1);
    await call({ WRITE_LIMIT: w }, "POST", "/api/crews");
    expect((await call({ WRITE_LIMIT: w }, "POST", "/api/crews")).status).toBe(429);
    expect(w.seen).toEqual(["ip:203.0.113.7", "ip:203.0.113.7"]);
    expect((await call({ AUTH_LIMIT: au }, "GET", "/api/auth/google/start")).status).not.toBe(429);
    expect((await call({ AUTH_LIMIT: au }, "GET", "/api/auth/google/start")).status).toBe(429);
    expect((await call({ AUTH_LIMIT: au }, "GET", "/api/auth/google/start", undefined, "198.51.100.9")).status).not.toBe(429);
    // the Google callback and logout are never limited: a 429 there loses a sign-in or leaves a session alive
    expect((await call({ AUTH_LIMIT: au }, "GET", "/api/auth/google/callback")).status).not.toBe(429);
    expect((await call({ AUTH_LIMIT: au }, "POST", "/api/auth/logout")).status).not.toBe(429);
  });

  it("does nothing without the binding (local dev)", async () => {
    const a = await makeUser("alice");
    for (let i = 0; i < 3; i++) expect((await call({ WRITE_LIMIT: undefined, AUTH_LIMIT: undefined }, "POST", "/api/crews", a.token)).status).toBe(201);
  });
});
