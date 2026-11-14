// Direct messages (src/messages.ts, migration 0064): friends only; the list newest first with unread counts; reading marks
// read; blocks hide both ways; a report hides it from the reporter and the owner's queue removes it; unsend; the hourly cap;
// a push that never carries the words; the sweep after a year; Download my data lists what you sent; Delete account takes it.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeUser, ok } from "./helpers";
import { setApnsFetchForTest as setPushFetchForTest } from "../src/apns";
import { sweepExpired } from "../src/sweep";
import { DM_PER_HOUR } from "../src/messages";

beforeEach(freshDb);
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as any;
const send = (u: any, to: string, body: string) => api(u, "POST", `/api/messages/${to}`, { body });

describe("direct messages", () => {
  it("friends write to each other; the list shows the newest first with what is unread; opening it marks it read", async () => {
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara")];
    await befriend(a, b); await befriend(a, c);
    expect((await send(b, "cara", "hi")).status).toBe(403);                         // not friends
    expect((await send(a, "nobody", "hi")).status).toBe(404);
    expect((await send(a, "bob", "  ")).status).toBe(400);
    await ok(send(a, "bob", "Skyway Saturday?"));
    await env.DB.prepare("UPDATE direct_messages SET created_at = datetime('now', '-2 minutes')").run();
    await ok(send(b, "alice", "Yes! 8 at the overlook"));
    await env.DB.prepare("UPDATE direct_messages SET created_at = datetime('now', '-1 minute') WHERE body LIKE 'Yes%'").run();
    await ok(send(a, "@Cara", "Coming too?"));
    expect((await json(api(a, "GET", "/api/messages"))).map((t: any) => [t.handle, t.last, t.mine, t.unread])).toEqual([["cara", "Coming too?", true, 0], ["bob", "Yes! 8 at the overlook", false, 1]]);
    expect(await json(api(a, "GET", "/api/me/messages/unread"))).toEqual({ unread: 1 });
    const t = await json(api(a, "GET", "/api/messages/bob"));
    expect(t.with).toMatchObject({ handle: "bob", friend: true });
    expect(t.messages.map((m: any) => [m.body, m.mine])).toEqual([["Skyway Saturday?", true], ["Yes! 8 at the overlook", false]]);
    expect(t.messages[0].seen).toBe(false);                                          // bob hasn't opened it yet
    expect(await json(api(a, "GET", "/api/me/messages/unread"))).toEqual({ unread: 0 });
    expect((await json(api(b, "GET", "/api/messages/alice"))).messages.map((m: any) => m.body)).toEqual(["Skyway Saturday?", "Yes! 8 at the overlook"]);
    expect((await json(api(a, "GET", "/api/messages/bob"))).messages[0].seen).toBe(true);
    expect(await json(api(c, "GET", "/api/messages/bob"))).toMatchObject({ messages: [] });   // nobody else's conversation
    // unfriended: the history stays, nothing new goes
    await ok(api(a, "DELETE", `/api/friends/${b.id}`));
    expect((await json(api(a, "GET", "/api/messages/bob"))).with.friend).toBe(false);
    expect((await send(a, "bob", "?")).status).toBe(403);
  });

  it("a block hides the conversation both ways; a report hides the message from the reporter and the owner removes it; unsend", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await befriend(a, b);
    const { id } = await json(send(b, "alice", "spam spam"));
    const { id: mine } = await json(send(a, "bob", "hello"));
    expect((await api(b, "DELETE", `/api/messages/m/${mine}`)).status).toBe(404);   // not bob's to unsend
    expect((await api(a, "POST", "/api/reports", { kind: "dm", target: mine, reason: "spam" })).status).toBe(404);   // never your own
    expect((await api(a, "POST", "/api/reports", { kind: "dm", target: id, reason: "spam" })).status).toBe(204);
    expect((await json(api(a, "GET", "/api/messages/bob"))).messages.map((m: any) => m.body)).toEqual(["hello"]);
    expect((await json(api(b, "GET", "/api/messages/alice"))).messages.length).toBe(2);
    const owner = await makeUser("owner");
    expect((await json(api(owner, "GET", "/api/moderation"))).find((r: any) => r.kind === "dm")).toMatchObject({ target: id, label: expect.stringContaining("spam spam") });
    await ok(api(owner, "POST", "/api/moderation/resolve", { kind: "dm", target: id, action: "remove" }));
    expect((await json(api(b, "GET", "/api/messages/alice"))).messages.map((m: any) => m.body)).toEqual(["hello"]);
    await ok(api(a, "DELETE", `/api/messages/m/${mine}`));
    expect(await json(api(b, "GET", "/api/messages"))).toEqual([]);
    await ok(send(b, "alice", "sorry"));
    await ok(api(a, "POST", "/api/blocks", { handle: "bob" }));
    expect(await json(api(a, "GET", "/api/messages"))).toEqual([]);
    expect(await json(api(b, "GET", "/api/messages"))).toEqual([]);
    expect((await api(b, "GET", "/api/messages/alice")).status).toBe(404);
    expect((await send(b, "alice", "?")).status).toBe(404);
  });

  it("sixty an hour; kept a year; in Download my data; gone with the account", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await befriend(a, b);
    await env.DB.batch(Array.from({ length: DM_PER_HOUR }, (_, i) => env.DB.prepare("INSERT INTO direct_messages (id, pair, sender, recipient, body) VALUES (?, ?, ?, ?, 'x')")
      .bind(`m${i}`, [a.id, b.id].sort().join(":"), a.id, b.id)));
    expect((await send(a, "bob", "one more")).status).toBe(429);
    await env.DB.prepare("UPDATE direct_messages SET created_at = datetime('now', '-366 days') WHERE id != 'm0'").run();
    expect((await sweepExpired(env as any)).direct_messages).toBe(DM_PER_HOUR - 1);
    const exp = await json(api(a, "GET", "/api/me/export"));
    expect(exp.direct_messages).toEqual([expect.objectContaining({ to_handle: "bob", body: "x" })]);
    await ok(api(a, "DELETE", "/api/me", { confirm: "DELETE" }));
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM direct_messages").first<{ n: number }>())!.n).toBe(0);
  });
});

describe("a message's push", () => {
  const E = env as unknown as Record<string, unknown>;
  afterEach(() => { setPushFetchForTest(null); for (const k of ["APPLE_TEAM_ID", "APNS_KEY_ID", "APNS_KEY_P8"]) delete E[k]; });
  it("says who wrote, never the words, and opens the conversation", async () => {
    const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey) as ArrayBuffer);
    Object.assign(E, { APPLE_TEAM_ID: "TEAM123456", APNS_KEY_ID: "APNSKEY123", APNS_KEY_P8: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n` });
    const calls: any[] = [];
    setPushFetchForTest((async (_i: RequestInfo | URL, init?: RequestInit) => { calls.push(JSON.parse(String(init?.body))); return new Response(null, { status: 200 }); }) as typeof fetch);
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await befriend(a, b);
    await ok(api(b, "POST", "/api/push/token", { token: "b".repeat(64) }));
    await ok(send(a, "bob", "the secret meet spot"));
    for (let i = 0; i < 100 && !calls.length; i++) await new Promise((r) => setTimeout(r, 10));
    expect(calls.map((c) => [c.aps.alert.title, c.aps.alert.body, c.url])).toEqual([["Message", "@alice sent you a message.", "apexnav://open?view=friends&chat=alice"]]);
  });
});
