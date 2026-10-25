import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { checkClaims, upsertGoogleUser } from "../src/auth";
import { ORIGIN, api, freshDb, makeUser } from "./helpers";

beforeEach(freshDb);

describe("Google sign-in", () => {
  it("start redirects to Google with PKCE, state and nonce and sets a short-lived cookie", async () => {
    const r = await exports.default.fetch(new Request(`${ORIGIN}/api/auth/google/start`, { redirect: "manual" }));
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    for (const k of ["state", "nonce", "code_challenge"]) expect(loc.searchParams.get(k)).toBeTruthy();
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
    expect(loc.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/google/callback`);
    const c = r.headers.get("set-cookie")!;
    expect(c).toContain("__Host-ax_oauth=");
    expect(c).toMatch(/HttpOnly/); expect(c).toMatch(/Secure/); expect(c).toMatch(/SameSite=Lax/);
  });

  it("the callback refuses a missing or mismatched state", async () => {
    const bad = await exports.default.fetch(new Request(`${ORIGIN}/api/auth/google/callback?code=x&state=nope`));
    expect(bad.status).toBe(400);
  });

  it("id_token claims are checked: audience, issuer, expiry, nonce, verified email", () => {
    const good = { iss: "https://accounts.google.com", aud: "cid", exp: 2_000_000_000, sub: "s", email: "a@b.c", email_verified: true, nonce: "n" };
    expect(() => checkClaims(good, "cid", "n", 1_900_000_000)).not.toThrow();
    for (const bad of [{ aud: "other" }, { iss: "https://evil.example" }, { exp: 1 }, { nonce: "x" }, { email_verified: false }, { sub: undefined }]) {
      expect(() => checkClaims({ ...good, ...bad }, "cid", "n", 1_900_000_000)).toThrow();
    }
  });

  it("only the owner address is let in automatically, and only while there are no members", async () => {
    const owner = await upsertGoogleUser(env, "g1", "Owner@Example.test", "Owner");
    expect(await env.DB.prepare("SELECT 1 FROM members WHERE user_id = ?").bind(owner).first()).toBeTruthy();
    const stranger = await upsertGoogleUser(env, "g2", "stranger@example.test", null);
    expect(await env.DB.prepare("SELECT 1 FROM members WHERE user_id = ?").bind(stranger).first()).toBeNull();
    await env.DB.prepare("DELETE FROM members").run();
    await env.DB.prepare("INSERT INTO members (user_id) VALUES (?)").bind(stranger).run();
    const again = await upsertGoogleUser(env, "g1", "owner@example.test", "Owner");
    expect(again).toBe(owner);                                                     // same person, same row
    expect(await env.DB.prepare("SELECT 1 FROM members WHERE user_id = ?").bind(owner).first()).toBeNull();   // not re-added once members exist
  });
});

describe("sessions", () => {
  it("/api/me reports signed-out, signed-in, and an unknown or expired cookie as signed out", async () => {
    const a = await makeUser("alice");
    expect(await (await api(null, "GET", "/api/me")).json()).toEqual({ signed_in: false });
    expect(await (await api({ ...a, token: "forged" }, "GET", "/api/me")).json()).toEqual({ signed_in: false });
    expect(await (await api(a, "GET", "/api/me")).json()).toMatchObject({ signed_in: true, handle: "alice", member: true });
    await env.DB.prepare("UPDATE sessions SET expires_at = datetime('now', '-1 minute')").run();
    expect(await (await api(a, "GET", "/api/me")).json()).toEqual({ signed_in: false });
  });

  it("logout ends the session server-side", async () => {
    const a = await makeUser("alice");
    expect((await api(a, "POST", "/api/auth/logout")).status).toBe(204);
    expect(await (await api(a, "GET", "/api/me")).json()).toEqual({ signed_in: false });
  });

  it("handles are unique, lower-case and validated", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    expect((await api(a, "PUT", "/api/me/handle", { handle: "Fast_Alice" })).status).toBe(204);
    expect((await api(b, "PUT", "/api/me/handle", { handle: "fast_alice" })).status).toBe(409);
    expect((await api(b, "PUT", "/api/me/handle", { handle: "no spaces!" })).status).toBe(400);
  });
});
