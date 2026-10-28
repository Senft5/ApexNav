// ApexNav Pro on the server (docs/MONETIZATION.md §6): StoreKit 2 transactions verified against a pinned root, recorded per
// account, and the founding-driver grant. The chain is a throw-away one made with openssl (fixtures/storekit/chain.json);
// the test Worker pins its root instead of Apple's (wrangler.test.jsonc STOREKIT_ROOT_SHA256).
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import chainText from "./fixtures/storekit/chain.json?raw";
import appleText from "./fixtures/storekit/apple.json?raw";
import { api, freshDb, makeUser, ok } from "./helpers";
import { APPLE_ROOT_G3_SHA256, parseCert, signedBy, verifyTransaction } from "../src/storekit";
import { proStatus } from "../src/pro";
import { b64url } from "../src/util";

beforeEach(freshDb);
const chain = JSON.parse(chainText) as Record<string, string>;
const der = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
const DAY = 86400_000;

async function jws(payload: Record<string, unknown>, x5c = [chain.leaf, chain.int, chain.root], key = chain.leaf_pkcs8): Promise<string> {
  const k = await crypto.subtle.importKey("pkcs8", der(key), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = enc({ alg: "ES256", x5c }), body = enc(payload);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}
const tx = (over: Record<string, unknown> = {}) => ({
  transactionId: "2000000001", originalTransactionId: "2000000001", bundleId: "com.senft.ApexNav", productId: "com.senft.ApexNav.pro",
  purchaseDate: Date.now() - 1000, signedDate: Date.now(), environment: "Production", type: "Non-Consumable", ...over,
});

describe("StoreKit 2 transaction verification", () => {
  it("reads the test certificates", () => {
    const leaf = parseCert(der(chain.leaf)), inter = parseCert(der(chain.int));
    expect(leaf.extensions).toContain("1.2.840.113635.100.6.11.1");
    expect(inter.extensions).toContain("1.2.840.113635.100.6.2.1");
    expect(leaf.curve).toBe("1.2.840.10045.3.1.7");
    expect(leaf.notAfter).toBeGreaterThan(Date.now());
  });

  it("reads Apple's real root and intermediate: the pin is G3's, and G3 signed WWDR G6", async () => {
    const apple = JSON.parse(appleText) as Record<string, string>;
    const root = parseCert(der(apple.root_g3)), g6 = parseCert(der(apple.wwdr_g6));
    const h = [...new Uint8Array(await crypto.subtle.digest("SHA-256", root.der))].map((x) => x.toString(16).padStart(2, "0")).join("");
    expect(h).toBe(APPLE_ROOT_G3_SHA256);
    expect(root.curve).toBe("1.3.132.0.34");
    expect(g6.extensions).toContain("1.2.840.113635.100.6.2.1");
    expect(await signedBy(g6, root)).toBe(true);
    expect(await signedBy(root, g6)).toBe(false);
  });

  it("accepts a transaction signed through the pinned root", async () => {
    const p = await verifyTransaction(await jws(tx()), chain.root_sha256);
    expect(p.productId).toBe("com.senft.ApexNav.pro");
  });

  it("refuses everything that isn't Apple's chain or isn't signed by it", async () => {
    const no = (p: Promise<unknown>) => expect(p).rejects.toThrow("bad_transaction");
    await no(verifyTransaction(await jws(tx()), APPLE_ROOT_G3_SHA256));                                   // production pin: our test root is not Apple's
    await no(verifyTransaction(await jws(tx(), [chain.leaf, chain.evil_int, chain.evil]), chain.root_sha256)); // a stranger's root
    await no(verifyTransaction(await jws(tx(), [chain.evil_leaf, chain.int, chain.root]), chain.root_sha256)); // leaf not signed by the intermediate
    await no(verifyTransaction(await jws(tx(), [chain.leaf_nooid, chain.int, chain.root]), chain.root_sha256)); // no App Store marker
    const good = await jws(tx()), [h, , s] = good.split(".");
    await no(verifyTransaction(`${h}.${enc(tx({ productId: "com.senft.ApexNav.pro", purchaseDate: 1 }))}.${s}`, chain.root_sha256)); // payload swapped
    await no(verifyTransaction(await jws(tx({ signedDate: Date.UTC(1999, 0, 1) })), chain.root_sha256));     // before the certificates were valid
    await no(verifyTransaction("not.a.jws", chain.root_sha256));
  });
});

describe("Pro on the account", () => {
  it("a verified purchase makes the account Pro, in /api/me and the export", async () => {
    const a = await makeUser("alice");
    expect(((await (await ok(api(a, "GET", "/api/me"))).json()) as { pro: { active: boolean } }).pro.active).toBe(false);
    const s = await (await ok(api(a, "POST", "/api/pro/verify", { jws: await jws(tx()) }))).json();
    expect(s).toMatchObject({ active: true, source: "purchase", until: null });
    expect(((await (await ok(api(a, "GET", "/api/me"))).json()) as { pro: unknown }).pro).toMatchObject({ active: true });
    const ex = await (await ok(api(a, "GET", "/api/me/export"))).json() as { pro_purchases: { product: string }[] };
    expect(ex.pro_purchases.map((p) => p.product)).toEqual(["com.senft.ApexNav.pro"]);
  });

  it("works for a signed-in account that isn't a member yet, and needs sign-in", async () => {
    expect((await api(null, "POST", "/api/pro/verify", { jws: "x".repeat(200) })).status).toBe(401);
    const u = await makeUser("newbie", false);
    expect(await (await ok(api(u, "POST", "/api/pro/verify", { jws: await jws(tx()) }))).json()).toMatchObject({ active: true });
  });

  it("refuses another app's or an unknown product, and sandbox purchases", async () => {
    const a = await makeUser("alice");
    expect((await api(a, "POST", "/api/pro/verify", { jws: await jws(tx({ bundleId: "com.example.other" })) })).status).toBe(400);
    expect((await api(a, "POST", "/api/pro/verify", { jws: await jws(tx({ productId: "com.senft.ApexNav.coins" })) })).status).toBe(400);
    const r = await api(a, "POST", "/api/pro/verify", { jws: await jws(tx({ environment: "Sandbox" })) });
    expect(r.status).toBe(400);
    expect(await r.text()).toContain("sandbox_transaction");
    expect((await proStatus(env, a.id)).active).toBe(false);
  });

  it("a refund takes Pro away; a restore on another account moves it, never copies it", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob");
    await ok(api(a, "POST", "/api/pro/verify", { jws: await jws(tx()) }));
    await ok(api(b, "POST", "/api/pro/verify", { jws: await jws(tx()) }));
    expect((await proStatus(env, a.id)).active).toBe(false);
    expect((await proStatus(env, b.id)).active).toBe(true);
    await ok(api(b, "POST", "/api/pro/verify", { jws: await jws(tx({ revocationDate: Date.now() })) }));
    expect((await proStatus(env, b.id)).active).toBe(false);
  });

  it("the trial lasts 14 days from its start, then ends by itself", async () => {
    const a = await makeUser("alice");
    const start = Date.now() - 3 * DAY;
    const s = await (await ok(api(a, "POST", "/api/pro/verify", { jws: await jws(tx({ productId: "com.senft.ApexNav.pro.trial", originalTransactionId: "t1", purchaseDate: start })) }))).json() as { source: string; until: string };
    expect(s.source).toBe("trial");
    expect(Math.abs(Date.parse(s.until) - (start + 14 * DAY))).toBeLessThan(2000);
    expect((await proStatus(env, a.id, start + 15 * DAY))).toMatchObject({ active: false, trial_used: true });
  });

  it("founding drivers: members who joined before PRO_FOUNDING_BEFORE have Pro without buying", async () => {
    const a = await makeUser("alice"), late = await makeUser("late"), guest = await makeUser("guest", false);
    await env.DB.prepare("UPDATE members SET joined_at = '2026-10-01 12:00:00' WHERE user_id = ?").bind(a.id).run();
    await env.DB.prepare("UPDATE members SET joined_at = '2027-02-01 12:00:00' WHERE user_id = ?").bind(late.id).run();
    const e = { ...env, PRO_FOUNDING_BEFORE: "2027-01-15" };
    expect(await proStatus(e, a.id)).toMatchObject({ active: true, source: "founding" });
    expect((await proStatus(e, late.id)).active).toBe(false);
    expect((await proStatus(e, guest.id)).active).toBe(false);
    expect((await proStatus(env, a.id)).active).toBe(false);                     // not set: nobody is founding
  });

  it("deleting the account deletes its purchases (a restore brings them back)", async () => {
    const a = await makeUser("alice");
    await ok(api(a, "POST", "/api/pro/verify", { jws: await jws(tx()) }));
    await ok(api(a, "DELETE", "/api/me", { confirm: "DELETE" }));
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM pro_purchases").first<{ n: number }>())!.n).toBe(0);
  });
});
