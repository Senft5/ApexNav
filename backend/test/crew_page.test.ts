import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeSegment, makeUser, ok, type TestUser } from "./helpers";

beforeEach(freshDb);

const today = () => new Date().toISOString().slice(0, 10);
async function crewOf(owner: TestUser, ...others: TestUser[]) {
  const crew = ((await (await ok(api(owner, "POST", "/api/crews", { name: "Ridge Runners" }))).json()) as { id: string }).id;
  for (const o of others) {
    const tok = ((await (await ok(api(owner, "POST", `/api/crews/${crew}/invite`))).json()) as { token: string }).token;
    await ok(api(o, "POST", "/api/crews/join", { token: tok }));
  }
  return crew;
}
const page = async (u: TestUser, crew: string) => (await (await ok(api(u, "GET", `/api/crews/${crew}/page`))).json()) as Record<string, any>;

describe("crew page", () => {
  it("the board: best Score this month from those sharing with the crew, -- for the rest, blocked people left out", async () => {
    const [a, b, c, out] = [await makeUser("alice"), await makeUser("bob"), await makeUser("carol"), await makeUser("outsider")];
    const crew = await crewOf(a, b, c);
    await ok(api(b, "PUT", "/api/grants", { audience_type: "crew", audience_id: crew, share_scores: true }));
    const seg = await makeSegment(b);
    await ok(api(b, "POST", "/api/board", { segment_id: seg, driver_score: 640, driven_on: today() }));
    await ok(api(b, "POST", "/api/board", { segment_id: seg, driver_score: 702, driven_on: today() }));
    await ok(api(b, "POST", "/api/board", { segment_id: seg, driver_score: 990, driven_on: "2020-01-05" }));   // not this month
    await ok(api(c, "POST", "/api/board", { segment_id: await makeSegment(c), driver_score: 900, driven_on: today() })); // carol shares nothing
    const p = await page(a, crew);
    expect(p.board.map((r: any) => [r.handle, r.score])).toEqual([["bob", 702], ["alice", null], ["carol", null]]);
    expect(p).toMatchObject({ name: "Ridge Runners", members: 3, is_owner: true, livery: { tier: "plain", decals: 0, next: { tier: "club", at: 5 }, supporters: [] }, next: null, sharing_scores: false });
    expect((await page(b, crew)).is_owner).toBe(false);
    expect((await api(out, "GET", `/api/crews/${crew}/page`)).status).toBe(404);
    await ok(api(a, "POST", "/api/blocks", { handle: "carol" }));
    expect((await page(a, crew)).board.map((r: any) => r.handle)).not.toContain("carol");
  });

  it("the owner sets the motto, a stock crest and the stripe; nobody else can", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    const crew = await crewOf(a, b);
    await ok(api(a, "PUT", `/api/crews/${crew}/page`, { motto: "  Slow in,   smooth out. ", crest: "peak", stripe: "#C8102E" }));
    expect(await page(b, crew)).toMatchObject({ motto: "Slow in, smooth out.", crest: "peak", stripe: "#c8102e" });
    expect((await api(b, "PUT", `/api/crews/${crew}/page`, { motto: "mine now" })).status).toBe(404);
    expect((await api(a, "PUT", `/api/crews/${crew}/page`, { crest: "skull" })).status).toBe(400);
    expect((await api(a, "PUT", `/api/crews/${crew}/page`, { stripe: "red" })).status).toBe(400);
    expect((await api(a, "PUT", `/api/crews/${crew}/page`, { motto: "x".repeat(81) })).status).toBe(400);
    await ok(api(a, "PUT", `/api/crews/${crew}/page`, { motto: null, crest: null }));
    expect(await page(a, crew)).toMatchObject({ motto: null, crest: null, stripe: "#c8102e" });
  });

  it("chat: members only, newest 50, report hides after three, author or owner deletes, export has yours, 30 days", async () => {
    const [a, b, c, d, out] = [await makeUser("alice"), await makeUser("bob"), await makeUser("carol"), await makeUser("dee"), await makeUser("outsider")];
    const crew = await crewOf(a, b, c, d);
    const say = async (u: TestUser, body: string) => ((await (await ok(api(u, "POST", `/api/crews/${crew}/chat`, { body }))).json()) as { id: string }).id;
    const read = async (u: TestUser) => (await (await ok(api(u, "GET", `/api/crews/${crew}/chat`))).json()) as { id: string; body: string; handle: string; mine: boolean }[];
    const m1 = await say(a, "Dawn run Saturday?"), m2 = await say(b, "In. Meet at the Hardee's");
    expect((await read(c)).map((m) => [m.handle, m.body, m.mine])).toEqual([["alice", "Dawn run Saturday?", false], ["bob", "In. Meet at the Hardee's", false]]);
    expect((await api(out, "GET", `/api/crews/${crew}/chat`)).status).toBe(404);
    expect((await api(out, "POST", `/api/crews/${crew}/chat`, { body: "hi" })).status).toBe(404);
    expect((await api(a, "POST", `/api/crews/${crew}/chat`, { body: "   " })).status).toBe(400);
    expect((await api(a, "POST", `/api/crews/${crew}/chat`, { body: "x".repeat(501) })).status).toBe(400);
    // reports: hidden from others once three people (invited by different people) report it; the author still sees it
    for (const u of [a, c, d]) await ok(api(u, "POST", "/api/reports", { kind: "chat", target: m2, reason: "abuse" }));
    expect((await read(c)).map((m) => m.id)).toEqual([m1]);
    expect((await read(b)).map((m) => m.id)).toEqual([m1, m2]);
    expect((await api(b, "POST", "/api/reports", { kind: "chat", target: m2, reason: "abuse" })).status).toBe(404);   // not your own
    // delete: the author or the owner, nobody else
    expect((await api(c, "DELETE", `/api/crews/${crew}/chat/${m1}`)).status).toBe(404);
    await ok(api(a, "DELETE", `/api/crews/${crew}/chat/${m2}`));                       // the owner
    await ok(api(a, "DELETE", `/api/crews/${crew}/chat/${m1}`));                       // the author
    expect(await read(a)).toEqual([]);
    const m3 = await say(c, "Saturday it is");
    const exp = (await (await ok(api(c, "GET", "/api/me/export"))).json()) as { crew_chat: { body: string }[] };
    expect(exp.crew_chat.map((m) => m.body)).toEqual(["Saturday it is"]);
    await env.DB.prepare("UPDATE crew_chat SET created_at = datetime('now', '-31 days') WHERE id = ?").bind(m3).run();
    const { sweepExpired } = await import("../src/sweep");
    expect((await sweepExpired(env as any)).crew_chat).toBe(1);
  });

  it("chat is capped at 30 an hour a person", async () => {
    const [a] = [await makeUser("alice")];
    const crew = await crewOf(a);
    const res = await Promise.all(Array.from({ length: 33 }, (_, i) => api(a, "POST", `/api/crews/${crew}/chat`, { body: `line ${i}` })));
    expect(res.filter((r) => r.status === 201)).toHaveLength(30);
    expect(res.filter((r) => r.status === 429)).toHaveLength(3);
  });

  it("Decals: Pro crew-mates set the tier (1, 2, then 3 a member), each tier unlocks its part of the livery, opting out takes yours off", async () => {
    const users = [await makeUser("alice"), await makeUser("bob"), await makeUser("carol"), await makeUser("dee")];
    const [a, b, c, d] = users;
    const crew = await crewOf(a, b, c, d);
    const pro = (u: TestUser, daysAgo: number, expires: string | null = null) => env.DB.prepare(
      "INSERT OR REPLACE INTO pro_entitlements (user_id, source, since, expires_at) VALUES (?, 'app_store', datetime('now', ?), ?)").bind(u.id, `-${daysAgo} days`, expires).run();
    const route = ((await (await ok(api(a, "POST", "/api/routes", { name: "Skyway loop", geom: [[-84.1, 35.3], [-84.0, 35.4]], crews: [crew] }))).json()) as { id: string }).id;
    // Plain: nothing past the Plain look
    expect((await api(a, "PUT", `/api/crews/${crew}/page`, { stripe2: "#ffffff" })).status).toBe(403);
    expect((await api(a, "PUT", `/api/crews/${crew}/page`, { pinned_route_id: route })).status).toBe(403);
    // bob 3 decals (70 days), carol 2 (40 days): 5 = Club
    await pro(b, 70); await pro(c, 40);
    let p = await page(a, crew);
    expect(p.livery).toMatchObject({ decals: 5, tier: "club", next: { tier: "works", at: 12 } });
    expect(p.livery.supporters).toEqual([{ handle: "bob", decals: 3 }, { handle: "carol", decals: 2 }]);
    await ok(api(a, "PUT", `/api/crews/${crew}/page`, { stripe2: "#FFFFFF", pinned_route_id: route }));
    expect((await api(a, "PUT", `/api/crews/${crew}/page`, { stripe3: "#000000" })).status).toBe(403);   // Works
    expect((await api(a, "PUT", `/api/crews/${crew}/page`, { pattern: "chevron" })).status).toBe(403);
    expect((await api(a, "PUT", `/api/crews/${crew}/page`, { pattern: "zigzag" })).status).toBe(400);
    p = await page(b, crew);
    expect(p).toMatchObject({ stripe2: "#ffffff", pinned: { id: route, name: "Skyway loop" }, stripe3: null, pattern: null });
    expect(p.livery.mine).toEqual({ pro: true, decals: 3, on: true });
    expect(p.routes).toBeUndefined();                                                                  // only the owner picks
    expect((await page(a, crew)).routes.map((r: any) => r.id)).toEqual([route]);
    // carol keeps her Decals off: back to 3, Plain, and the Club look falls back without being lost
    await ok(api(c, "PUT", `/api/crews/${crew}/decals`, { on: false }));
    p = await page(a, crew);
    expect(p.livery).toMatchObject({ decals: 3, tier: "plain" });
    expect([p.stripe2, p.pinned]).toEqual([null, null]);
    await ok(api(c, "PUT", `/api/crews/${crew}/decals`, { on: true }));
    // dee and alice join in (3 each, a long time Pro), and an expired one counts nothing: 3 + 2 + 3 + 3 = 11, then 12 = Works
    await pro(d, 400); await pro(a, 100, "2020-01-01 00:00:00");
    expect((await page(a, crew)).livery).toMatchObject({ decals: 8, tier: "club" });
    await pro(a, 100);
    await env.DB.prepare("UPDATE pro_entitlements SET since = datetime('now', '-100 days') WHERE user_id = ?").bind(c.id).run();
    expect((await page(a, crew)).livery).toMatchObject({ decals: 12, tier: "works", next: { tier: "factory", at: 20 } });
    await ok(api(a, "PUT", `/api/crews/${crew}/page`, { stripe3: "#111111", pattern: "chevron" }));
    expect(await page(c, crew)).toMatchObject({ stripe3: "#111111", pattern: "chevron" });
    expect((await api(users[0], "PUT", `/api/crews/${crew}/decals`, { on: "yes" })).status).toBe(400);
  });
});
