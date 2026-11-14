// "Someone beat you" pushes (src/push.ts afterTopped, afterPassed): a friend's run over your best Score on a stage you both
// have, and an entrant going under your quickest this week on a fixed time attack, each told once, when they go past you;
// never to someone blocked, never to someone the run isn't published to, and only while the kind "beaten" is on.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeSegment, makeUser, ok, type TestUser } from "./helpers";
import { setApnsFetchForTest } from "../src/apns";

beforeEach(freshDb);
const E = env as unknown as Record<string, unknown>;
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as any;
const tok = (n: number) => n.toString(16).padStart(64, "0");
const today = new Date().toISOString().slice(0, 10);
const calls: { token: string; body: any }[] = [];
const realFetch = globalThis.fetch;
async function configure() {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey) as ArrayBuffer);
  Object.assign(E, { APPLE_TEAM_ID: "TEAM123456", APNS_KEY_ID: "APNSKEY123", APNS_KEY_P8: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n` });
  setApnsFetchForTest((async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ token: String(input).split("/3/device/")[1], body: JSON.parse(String(init?.body)) });
    return new Response(null, { status: 200 });
  }) as typeof fetch);
}
// no graph tiles here (src/loop_check.ts): the loops these tests post go unchecked
beforeEach(() => { globalThis.fetch = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch; });
afterEach(() => { globalThis.fetch = realFetch; setApnsFetchForTest(null); calls.length = 0; for (const k of ["APPLE_TEAM_ID", "APNS_KEY_ID", "APNS_KEY_P8"]) delete E[k]; });
async function settle(n: number) { for (let i = 0; i < 100 && calls.length < n; i++) await new Promise((r) => setTimeout(r, 10)); await new Promise((r) => setTimeout(r, 30)); }
const phone = (u: TestUser, n: number) => ok(api(u, "POST", "/api/push/token", { token: tok(n) }));
const said = () => calls.map((x) => [x.token, x.body.aps.alert.title, x.body.aps.alert.body]);

async function stageShared(owner: TestUser, other: TestUser) {
  const seg = await makeSegment(owner, "Esses");
  await ok(api(owner, "POST", `/api/segments/${seg}/share`, { audience_type: "friend", audience_id: other.id }));
  return { seg, adopted: (await json(api(other, "POST", "/api/segments/adopt", { segment_id: seg }))).id as string };
}
const publish = (u: TestUser, seg: string, score: number) => ok(api(u, "POST", "/api/board", { segment_id: seg, driver_score: score, driven_on: today }));

describe("someone beat you", () => {
  it("a friend's run over your best Score tells you once, as you're passed; never someone blocked or not shared with", async () => {
    await configure();
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara")];
    await befriend(a, b); await befriend(b, c);
    const { seg, adopted } = await stageShared(a, b);
    for (const [u, o] of [[a, b], [b, a], [b, c]] as const) await ok(api(u, "PUT", "/api/grants", { audience_type: "friend", audience_id: o.id, share_scores: true }));
    for (const [u, n] of [[a, 1], [b, 2], [c, 3]] as const) await phone(u, n);
    await publish(a, seg, 800);
    await publish(b, adopted, 790);             // under alice: nothing
    await settle(1);
    expect(said()).toEqual([]);
    await publish(b, adopted, 812);             // over her best
    await settle(1);
    expect(said()).toEqual([[tok(1), "Topped", "@bob scored 812 on Esses, over your best of 800."]]);
    calls.length = 0;
    await publish(b, adopted, 830);             // already past her: not told again
    await settle(1);
    expect(said()).toEqual([]);
    // cara has no copy of Esses: never told. alice, blocked by bob after a new best of hers, isn't either
    await publish(a, seg, 900);
    await settle(1);
    expect(said()).toEqual([[tok(2), "Topped", "@alice scored 900 on Esses, over your best of 830."]]);
    calls.length = 0;
    await ok(api(b, "POST", "/api/blocks", { handle: "alice" }));
    await publish(b, adopted, 950);
    await settle(1);
    expect(said()).toEqual([]);
  });

  it("turned off with the kind; the kinds list carries it", async () => {
    await configure();
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await befriend(a, b);
    const { seg, adopted } = await stageShared(a, b);
    for (const [u, o] of [[a, b], [b, a]] as const) await ok(api(u, "PUT", "/api/grants", { audience_type: "friend", audience_id: o.id, share_scores: true }));
    await phone(a, 1);
    expect((await json(api(a, "GET", "/api/push/kinds"))).kinds).toContain("beaten");
    await ok(api(a, "PUT", "/api/push/kinds", { off: ["beaten"] }));
    await publish(a, seg, 800);
    await publish(b, adopted, 812);
    await settle(1);
    expect(said()).toEqual([]);
  });

  it("a time attack entrant going under your quickest this week tells you once, never the time", async () => {
    await configure();
    const HERE = "lat=39.3&lon=-84.6", CELL = "39.25,-84.75", lat = 39.26, lon = -84.6, side = 2500;
    const dLat = side / 111195, dLon = side / (111195 * Math.cos((lat * Math.PI) / 180)), geom: number[][] = [];
    const c4 = [[lat, lon], [lat + dLat, lon], [lat + dLat, lon + dLon], [lat, lon + dLon], [lat, lon]];
    for (let k = 0; k < 4; k++) for (let i = 0; i < 10; i++) geom.push([c4[k][0] + ((c4[k + 1][0] - c4[k][0]) * i) / 10, c4[k][1] + ((c4[k + 1][1] - c4[k][1]) * i) / 10]);
    geom.push([lat, lon]);
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    const t = await json(api(a, "GET", `/api/ta?${HERE}`));
    const id = (await json(api(a, "POST", "/api/ta/circuit", { cell: CELL, slot: t.make.slot, seed: t.make.seed, name: "Dry Ridge Road loop", geom }))).circuit.id;
    const sa = (await json(api(a, "POST", "/api/ta/enter", { id }))).segment_id, sb = (await json(api(b, "POST", "/api/ta/enter", { id }))).segment_id;
    const day = (await env.DB.prepare("SELECT date('now') AS d").first<{ d: string }>())!.d;
    const run = (u: TestUser, s: string, time_s: number) => json(api(u, "POST", "/api/ta/runs", { runs: [{ segment_id: s, time_s, driven_on: day }] }));
    await phone(a, 1); await phone(b, 2);
    await run(a, sa, 600);
    await run(b, sb, 610);                       // slower: nothing
    await settle(1);
    expect(said()).toEqual([]);
    await run(b, sb, 590);
    await settle(1);
    expect(said()).toEqual([[tok(1), "Time attack", "@bob went quicker than you on Dry Ridge Road loop."]]);
    calls.length = 0;
    await run(b, sb, 580);                       // already ahead of her
    await settle(1);
    expect(said()).toEqual([]);
  });
});
