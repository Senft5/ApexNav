// Sign in with Apple from the app (src/apple.ts, IDEAS O-05): the identity token's RS256 signature is checked against
// Apple's key set (a test key here), then iss, aud, exp and the nonce; the account is `apple:<sub>`, its name kept from
// the first sign-in, and bans apply to it like any other.
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APP_ORIGIN } from "../src/auth";
import { APPLE_ISS, setAppleKeysForTest } from "../src/apple";
import { sha256hex } from "../src/util";
import { ORIGIN, freshDb } from "./helpers";

beforeEach(freshDb);
afterEach(() => setAppleKeysForTest(null));

const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const json64 = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function keyPair(kid: string) {
  const kp = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey;
  return { kp, jwk: { kid, kty: "RSA", alg: "RS256", n: pub.n!, e: pub.e! } };
}
async function sign(kp: CryptoKeyPair, kid: string, claims: Record<string, unknown>) {
  const head = json64({ alg: "RS256", kid }), body = json64(claims);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}
const post = (body: unknown) => exports.default.fetch(new Request(`${ORIGIN}/api/auth/apple`, {
  method: "POST", headers: { origin: APP_ORIGIN, "x-apexnav": "1", "content-type": "application/json" }, body: JSON.stringify(body) }));
const NONCE = "n".repeat(32);
const claims = async (over: Record<string, unknown> = {}) => ({ iss: APPLE_ISS, aud: "com.senft.ApexNav", sub: "001234.abcd", email: "x@privaterelay.appleid.com",
  exp: Math.floor(Date.now() / 1000) + 300, nonce: await sha256hex(NONCE), ...over });

describe("Sign in with Apple", () => {
  it("a valid token gives a session; the name from the first sign-in is kept", async () => {
    const { kp, jwk } = await keyPair("k1");
    setAppleKeysForTest([jwk]);
    const r = await post({ id_token: await sign(kp, "k1", await claims()), nonce: NONCE, name: "Pat Driver" });
    expect(r.status).toBe(200);
    const { token } = (await r.json()) as { token: string };
    const me = await exports.default.fetch(new Request(`${ORIGIN}/api/me`, { headers: { origin: APP_ORIGIN, authorization: `Bearer ${token}` } }));
    expect(await me.json()).toMatchObject({ signed_in: true });
    // Second sign-in: Apple sends no name; the stored one stays, the same account comes back.
    const again = await post({ id_token: await sign(kp, "k1", await claims()), nonce: NONCE });
    expect(again.status).toBe(200);
    const rows = (await env.DB.prepare("SELECT google_sub, email, display_name FROM users").all()).results;
    expect(rows).toEqual([{ google_sub: "apple:001234.abcd", email: "x@privaterelay.appleid.com", display_name: "Pat Driver" }]);
  });

  it("refuses a forged signature, another app, an expired token, a wrong nonce and an unknown key", async () => {
    const { kp, jwk } = await keyPair("k1"), other = await keyPair("k1");
    setAppleKeysForTest([jwk]);
    const bad = [
      { id_token: await sign(other.kp, "k1", await claims()), nonce: NONCE },                          // signed by someone else
      { id_token: await sign(kp, "k1", await claims({ aud: "com.example.other" })), nonce: NONCE },
      { id_token: await sign(kp, "k1", await claims({ iss: "https://evil.example" })), nonce: NONCE },
      { id_token: await sign(kp, "k1", await claims({ exp: Math.floor(Date.now() / 1000) - 1 })), nonce: NONCE },
      { id_token: await sign(kp, "k1", await claims()), nonce: "m".repeat(32) },                       // replayed with another nonce
      { id_token: await sign(kp, "k2", await claims()), nonce: NONCE },                                 // a kid Apple doesn't have
      { id_token: "garbage!.not-json.signature-xx", nonce: NONCE },
    ];
    for (const b of bad) expect((await post(b)).status).toBe(401);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())!.n).toBe(0);
  });

  it("a banned Apple account can't sign back in as a member", async () => {
    const { kp, jwk } = await keyPair("k1");
    setAppleKeysForTest([jwk]);
    await env.DB.prepare("INSERT INTO bans (google_sub) VALUES ('apple:001234.abcd')").run();
    const r = await post({ id_token: await sign(kp, "k1", await claims()), nonce: NONCE });
    const { token } = (await r.json()) as { token: string };
    const me = (await (await exports.default.fetch(new Request(`${ORIGIN}/api/me`, { headers: { origin: APP_ORIGIN, authorization: `Bearer ${token}` } }))).json()) as { member?: boolean };
    expect(me.member).toBeFalsy();
  });

  it("only the app may call it signed out (a web page from another origin is refused)", async () => {
    const r = await exports.default.fetch(new Request(`${ORIGIN}/api/auth/apple`, {
      method: "POST", headers: { origin: "https://evil.example", "x-apexnav": "1", "content-type": "application/json" }, body: "{}" }));
    expect(r.status).toBe(403);
  });
});
