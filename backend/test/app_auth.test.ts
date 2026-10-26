// The iOS shell: pages at apexnav://app call the Worker cross-origin with a bearer session token, and sign in
// through ASWebAuthenticationSession + a one-time code (PKCE-bound) instead of the session cookie.
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { APP_ORIGIN } from "../src/auth";
import { sha256b64url, sha256hex } from "../src/util";
import { ORIGIN, api, freshDb, makeUser } from "./helpers";

beforeEach(freshDb);

const appFetch = (method: string, path: string, opts: { token?: string; body?: unknown; origin?: string } = {}) => {
  const headers: Record<string, string> = { origin: opts.origin ?? APP_ORIGIN, "x-apexnav": "1", "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  return exports.default.fetch(new Request(ORIGIN + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }));
};

async function issueCode(userId: string, verifier: string, expiresSql = "datetime('now', '+2 minutes')"): Promise<string> {
  const code = `code-${crypto.randomUUID()}`;
  await env.DB.prepare(`INSERT INTO app_auth_codes (code_hash, user_id, challenge, expires_at) VALUES (?, ?, ?, ${expiresSql})`)
    .bind(await sha256hex(code), userId, await sha256b64url(verifier)).run();
  return code;
}
const VERIFIER = "v".repeat(43);

describe("bearer sessions from the app", () => {
  it("a bearer token signs the app in; a wrong one does not", async () => {
    const a = await makeUser("alice");
    const me = (await (await appFetch("GET", "/api/me", { token: a.token })).json()) as { signed_in: boolean; handle: string };
    expect(me).toMatchObject({ signed_in: true, handle: "alice" });
    const anon = (await (await appFetch("GET", "/api/me", { token: "x".repeat(40) })).json()) as { signed_in: boolean };
    expect(anon.signed_in).toBe(false);
  });

  it("writes from the app origin need the bearer token; a cookie alone is refused (no CSRF)", async () => {
    const a = await makeUser("alice");
    expect((await appFetch("PUT", "/api/me/handle", { body: { handle: "alice2" } })).status).toBe(403);
    expect((await api(a, "PUT", "/api/me/handle", { handle: "alice2" }, { origin: APP_ORIGIN })).status).toBe(403);
    expect((await appFetch("PUT", "/api/me/handle", { token: a.token, body: { handle: "alice2" } })).status).toBeLessThan(300);
  });

  it("logout with a bearer token ends that session", async () => {
    const a = await makeUser("alice");
    expect((await appFetch("POST", "/api/auth/logout", { token: a.token })).status).toBe(204);
    const me = (await (await appFetch("GET", "/api/me", { token: a.token })).json()) as { signed_in: boolean };
    expect(me.signed_in).toBe(false);
  });
});

describe("CORS", () => {
  it("answers the app's preflight and tags app responses; other origins get no CORS headers", async () => {
    const pre = await exports.default.fetch(new Request(`${ORIGIN}/api/friends`, { method: "OPTIONS", headers: { origin: APP_ORIGIN } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
    expect(pre.headers.get("access-control-allow-headers")).toContain("authorization");
    expect(pre.headers.get("access-control-allow-credentials")).toBeNull();
    const evil = await exports.default.fetch(new Request(`${ORIGIN}/api/friends`, { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    const a = await makeUser("alice");
    expect((await appFetch("GET", "/api/me", { token: a.token })).headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
    expect((await appFetch("GET", "/api/me", { origin: "https://evil.example" })).headers.get("access-control-allow-origin")).toBeNull();
    expect((await api(a, "GET", "/api/me")).headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("app sign-in", () => {
  it("start with an app challenge keeps it in the short-lived oauth cookie; a malformed one is refused", async () => {
    const ch = await sha256b64url(VERIFIER);
    const r = await exports.default.fetch(new Request(`${ORIGIN}/api/auth/google/start?app_challenge=${ch}`, { redirect: "manual" }));
    expect(r.status).toBe(302);
    expect(r.headers.get("set-cookie")).toContain(`.${ch}`);
    const bad = await exports.default.fetch(new Request(`${ORIGIN}/api/auth/google/start?app_challenge=short`, { redirect: "manual" }));
    expect(bad.status).toBe(400);
  });

  it("a code plus the right verifier gives a working token, once", async () => {
    const a = await makeUser("alice");
    const code = await issueCode(a.id, VERIFIER);
    const r = await appFetch("POST", "/api/auth/app/exchange", { body: { code, verifier: VERIFIER } });
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
    const { token } = (await r.json()) as { token: string };
    const me = (await (await appFetch("GET", "/api/me", { token })).json()) as { signed_in: boolean; handle: string };
    expect(me).toMatchObject({ signed_in: true, handle: "alice" });
    expect((await appFetch("POST", "/api/auth/app/exchange", { body: { code, verifier: VERIFIER } })).status).toBe(401);
  });

  it("a wrong verifier fails and burns the code; an expired code fails", async () => {
    const a = await makeUser("alice");
    const code = await issueCode(a.id, VERIFIER);
    expect((await appFetch("POST", "/api/auth/app/exchange", { body: { code, verifier: "w".repeat(43) } })).status).toBe(401);
    expect((await appFetch("POST", "/api/auth/app/exchange", { body: { code, verifier: VERIFIER } })).status).toBe(401);
    const old = await issueCode(a.id, VERIFIER, "datetime('now', '-1 minute')");
    expect((await appFetch("POST", "/api/auth/app/exchange", { body: { code: old, verifier: VERIFIER } })).status).toBe(401);
  });
});
