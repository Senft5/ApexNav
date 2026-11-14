// Push notifications (src/push.ts): a phone's token is kept while signed in; a friend request, a new friend, kudos, a
// duel and a crew drive each reach the other side's phones; nothing to someone blocked; a gone token is dropped; nothing is
// sent (and nothing fails) until the owner's APNs secrets are set.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeLine } from "../src/drive_posts";
import { api, befriend, freshDb, makeSegment, makeUser, ok, type TestUser } from "./helpers";
import { setApnsFetchForTest as setPushFetchForTest } from "../src/apns";

beforeEach(freshDb);
const E = env as unknown as Record<string, unknown>;
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as any;
const tok = (n: number) => n.toString(16).padStart(64, "0");
const today = new Date().toISOString().slice(0, 10);

type Call = { host: string; token: string; body: any; headers: Record<string, string> };
const calls: Call[] = [];
let answer: (token: string) => Response = () => new Response(null, { status: 200 });
async function configure() {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey) as ArrayBuffer);
  Object.assign(E, { APPLE_TEAM_ID: "TEAM123456", APNS_KEY_ID: "APNSKEY123", APNS_KEY_P8: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n` });
  setPushFetchForTest((async (input: RequestInfo | URL, init?: RequestInit) => {
    const token = String(input).split("/3/device/")[1];
    calls.push({ host: new URL(String(input)).host, token, body: JSON.parse(String(init?.body)), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return answer(token);
  }) as typeof fetch);
  return kp.publicKey;
}
afterEach(() => { setPushFetchForTest(null); calls.length = 0; answer = () => new Response(null, { status: 200 }); for (const k of ["APPLE_TEAM_ID", "APNS_KEY_ID", "APNS_KEY_P8"]) delete E[k]; });
/** waitUntil runs after the answer: wait for the pushes to land. */
async function settle(n: number) { for (let i = 0; i < 100 && calls.length < n; i++) await new Promise((r) => setTimeout(r, 10)); await new Promise((r) => setTimeout(r, 30)); }
const phone = (u: TestUser, n: number) => ok(api(u, "POST", "/api/push/token", { token: tok(n) }));

describe("push notifications", () => {
  it("a friend request and the yes each reach the other side's phone, signed with a valid ES256 provider token", async () => {
    const pub = await configure();
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await phone(a, 1); await phone(b, 2);
    await ok(api(a, "POST", "/api/friends/request", { handle: "bob" }));
    await settle(1);
    expect(calls.map((c) => [c.token, c.body.aps.alert.body])).toEqual([[tok(2), "@alice wants to be your friend."]]);
    const h = calls[0].headers;
    expect([h["apns-topic"], h["apns-push-type"]]).toEqual(["com.senft.ApexNav", "alert"]);
    const [head, body, sig] = h.authorization.replace(/^bearer /, "").split(".");
    const dec = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    expect(JSON.parse(new TextDecoder().decode(dec(head)))).toEqual({ alg: "ES256", kid: "APNSKEY123" });
    expect(JSON.parse(new TextDecoder().decode(dec(body)))).toMatchObject({ iss: "TEAM123456" });
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, dec(sig), new TextEncoder().encode(`${head}.${body}`))).toBe(true);
    // asking again tells no one twice
    await ok(api(a, "POST", "/api/friends/request", { handle: "bob" }));
    await settle(2);
    expect(calls.length).toBe(1);
    await ok(api(b, "POST", "/api/friends/accept", { user_id: a.id }));
    await settle(2);
    expect([calls[1].token, calls[1].body.aps.alert.body, calls[1].body.url]).toEqual([tok(1), "You and @bob are friends now.", "apexnav://open?view=friends&friend=bob"]);
  });

  it("kudos once per run, a duel asked and taken, and a crew drive to every other member but none blocked", async () => {
    await configure();
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara")];
    await befriend(a, b);
    for (const [u, n] of [[a, 1], [b, 2], [c, 3]] as const) await phone(u, n);
    // kudos: bob's run on alice's stage
    const seg = await makeSegment(a, "Esses");
    await ok(api(a, "POST", `/api/segments/${seg}/share`, { audience_type: "friend", audience_id: b.id }));
    const adopted = (await json(api(b, "POST", "/api/segments/adopt", { segment_id: seg }))).id;
    await ok(api(b, "PUT", "/api/grants", { audience_type: "friend", audience_id: a.id, share_scores: true }));
    await ok(api(b, "POST", "/api/board", { segment_id: adopted, driver_score: 812, driven_on: today }));
    const run = { handle: "bob", canon_id: seg, driven_on: today };
    await ok(api(a, "POST", "/api/kudos", run)); await ok(api(a, "POST", "/api/kudos", run));
    await settle(1);
    expect(calls.map((x) => [x.token, x.body.aps.alert.body])).toEqual([[tok(2), "@alice gave you kudos for Esses."]]);
    calls.length = 0;
    // a duel
    const { id } = await json(api(a, "POST", "/api/duels", { handle: "bob", segment_id: seg, days: 7 }));
    await settle(1);
    await ok(api(b, "POST", `/api/duels/${id}/accept`));
    await settle(2);
    expect(calls.map((x) => [x.token, x.body.aps.alert.body])).toEqual([[tok(2), "@alice challenged you on Esses."], [tok(1), "@bob took your duel on Esses."]]);
    calls.length = 0;
    // a crew drive: cara blocked alice, so only bob hears of it
    const crew = (await json(api(a, "POST", "/api/crews", { name: "Ridge Runners" }))).id;
    const t = (await json(api(a, "POST", `/api/crews/${crew}/invite`))).token;
    for (const m of [b, c]) await ok(api(m, "POST", "/api/crews/join", { token: t }));
    await ok(api(c, "POST", "/api/blocks", { handle: "alice" }));
    await ok(api(a, "POST", `/api/crews/${crew}/events`, { title: "Dawn run", starts_at: new Date(Date.now() + 48 * 3600e3).toISOString(), meet: { name: "Shell", lat: 35.36, lon: -84.29 } }));
    await settle(1);
    expect(calls.map((x) => [x.token, x.body.aps.alert.title, x.body.aps.alert.body])).toEqual([[tok(2), "Ridge Runners", "@alice planned Dawn run. Are you going?"]]);
  });

  it("kudos and a comment on your drive post reach your phone, never the comment's words; a phone from Xcode goes to the sandbox", async () => {
    await configure();
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await befriend(a, b);
    await ok(api(a, "POST", "/api/push/token", { token: tok(1), sandbox: true }));
    const line = encodeLine(Array.from({ length: 91 }, (_, i) => [35 + i * 0.001, -84] as [number, number]));
    const { id } = await json(api(a, "POST", "/api/posts", { title: "Cherohala Skyway", driven_on: today, length_m: 10000, line }));
    await ok(api(b, "POST", `/api/posts/${id}/kudos`)); await ok(api(b, "POST", `/api/posts/${id}/kudos`));
    await ok(api(b, "POST", `/api/posts/${id}/comments`, { body: "That fog!" }));
    await ok(api(a, "POST", `/api/posts/${id}/comments`, { body: "Thanks" }));     // your own comment tells no one
    await settle(2);
    expect(calls.map((x) => [x.host, x.body.aps.alert.title, x.body.aps.alert.body])).toEqual([
      ["api.sandbox.push.apple.com", "Kudos", "@bob gave kudos to Cherohala Skyway."],
      ["api.sandbox.push.apple.com", "Cherohala Skyway", "@bob commented on your drive."]]);
  });

  it("a comment tells the others who commented before, unless blocked; never the one commenting or the post's author twice", async () => {
    await configure();
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara")];
    await befriend(a, b); await befriend(a, c);
    await ok(api(b, "POST", "/api/push/token", { token: tok(2) }));
    const line = encodeLine(Array.from({ length: 91 }, (_, i) => [35 + i * 0.001, -84] as [number, number]));
    const { id } = await json(api(a, "POST", "/api/posts", { title: "Cherohala Skyway", driven_on: today, length_m: 10000, line }));
    await ok(api(b, "POST", `/api/posts/${id}/comments`, { body: "That fog!" }));
    await ok(api(c, "POST", `/api/posts/${id}/comments`, { body: "Next time I'm in" }));
    await settle(1);
    expect(calls.map((x) => [x.token, x.body.aps.alert.title, x.body.aps.alert.body])).toEqual([[tok(2), "Cherohala Skyway", "@cara also commented on @alice's drive."]]);
    calls.length = 0;
    await ok(api(b, "POST", "/api/blocks", { handle: "cara" }));
    await ok(api(c, "POST", `/api/posts/${id}/comments`, { body: "Again" }));
    await ok(api(b, "POST", `/api/posts/${id}/comments`, { body: "Mine" }));      // bob's own comment never tells bob
    await settle(1);
    expect(calls).toEqual([]);
  });

  it("a token Apple calls gone is dropped; sign-out drops this phone; Delete account drops them all; bad tokens are refused", async () => {
    await configure();
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await phone(b, 2); await phone(b, 3); await phone(b, 3);
    expect(JSON.parse((await env.PHOTOS!.get(`push/${b.id}`))!).map((x: { t: string }) => x.t)).toEqual([tok(2), tok(3)]);
    answer = (t) => t === tok(2) ? Response.json({ reason: "Unregistered" }, { status: 410 }) : new Response(null, { status: 200 });
    await ok(api(a, "POST", "/api/friends/request", { handle: "bob" }));
    await settle(2);
    expect(JSON.parse((await env.PHOTOS!.get(`push/${b.id}`))!).map((x: { t: string }) => x.t)).toEqual([tok(3)]);
    expect((await api(b, "DELETE", "/api/push/token", { token: tok(3) })).status).toBe(204);
    expect(await env.PHOTOS!.get(`push/${b.id}`)).toBeNull();
    expect((await api(b, "POST", "/api/push/token", { token: "not-a-token" })).status).toBe(400);
    await phone(a, 1);
    await ok(api(a, "DELETE", "/api/me", { confirm: "DELETE" }));
    expect(await env.PHOTOS!.get(`push/${a.id}`)).toBeNull();
  });

  it("nothing while you drive: a drive started keeps pushes away until it ends", async () => {
    await configure();
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara")];
    await phone(b, 2);
    expect((await api(b, "PUT", "/api/push/quiet", { on: true })).status).toBe(204);
    await ok(api(a, "POST", "/api/friends/request", { handle: "bob" }));
    await settle(1);
    expect(calls.length).toBe(0);
    await ok(api(b, "PUT", "/api/push/quiet", { on: false }));
    expect(await env.PHOTOS!.get(`pushquiet/${b.id}`)).toBeNull();
    await ok(api(c, "POST", "/api/friends/request", { handle: "bob" }));
    await settle(1);
    expect(calls.map((x) => x.body.aps.alert.body)).toEqual(["@cara wants to be your friend."]);
  });

  it("without the owner's secrets: tokens are kept, nothing is sent, and every request answers as before", async () => {
    setPushFetchForTest((async () => { throw new Error("no push without secrets"); }) as typeof fetch);
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    expect(await json(api(b, "POST", "/api/push/token", { token: tok(2) }))).toEqual({ ok: true, sending: false });
    await befriend(a, b);
    expect(calls.length).toBe(0);
  });
});
