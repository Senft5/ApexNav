import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ORIGIN, api, freshDb, makeSegment, makeUser, ok, type TestUser } from "./helpers";

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
    await ok(api(c, "PUT", "/api/grants", { audience_type: "crew", audience_id: crew, share_scores: false }));   // on by default; carol switched it off
    await ok(api(c, "POST", "/api/board", { segment_id: await makeSegment(c), driver_score: 900, driven_on: today() })); // carol shares nothing
    const p = await page(a, crew);
    expect(p.board.map((r: any) => [r.handle, r.score])).toEqual([["bob", 702], ["alice", null], ["carol", null]]);
    expect(p).toMatchObject({ name: "Ridge Runners", members: 3, is_owner: true, livery: { tier: "plain", decals: 0, next: null, supporters: [] }, next: null, sharing_scores: true });   // a private crew: on by default
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

  it("chat: a crew made public shows a stranger who joins later its public days, never its private ones", async () => {
    const [a, b, s] = [await makeUser("alice"), await makeUser("bob"), await makeUser("stranger")];
    const crew = await crewOf(a, b);
    await ok(api(b, "POST", `/api/crews/${crew}/chat`, { body: "My garage code is 4411" }));
    await env.DB.prepare("UPDATE crew_members SET joined_at = datetime('now', '-1 day')").run();
    await env.DB.prepare("UPDATE crew_chat SET created_at = datetime('now', '-1 hour')").run();
    await ok(api(a, "PUT", `/api/crews/${crew}`, { name: "Ridge Runners", visibility: "public", area: { name: "Robbinsville", lat: 35.3254, lon: -83.8071 } }));
    await env.DB.prepare("UPDATE crews SET public_since = datetime('now', '-30 minutes') WHERE id = ?").bind(crew).run();
    await ok(api(a, "POST", `/api/crews/${crew}/chat`, { body: "Welcome, everyone" }));
    await env.DB.prepare("UPDATE crew_chat SET created_at = datetime('now', '-20 minutes') WHERE body = 'Welcome, everyone'").run();
    await ok(api(s, "POST", `/api/crews/${crew}/join`));
    await ok(api(b, "POST", `/api/crews/${crew}/chat`, { body: "Sunday, 8am" }));
    const read = async (u: TestUser) => ((await (await ok(api(u, "GET", `/api/crews/${crew}/chat`))).json()) as { body: string }[]).map((m) => m.body);
    expect(await read(s)).toEqual(["Welcome, everyone", "Sunday, 8am"]);                    // public days, before and after joining
    expect(await read(b)).toEqual(["My garage code is 4411", "Welcome, everyone", "Sunday, 8am"]);   // bob was there
    const feed = (await (await ok(api(s, "GET", "/api/crews/feed"))).json()) as { items: { kind: string; body?: string }[] };
    expect(feed.items.filter((i) => i.kind === "chat").map((i) => i.body).sort()).toEqual(["Sunday, 8am", "Welcome, everyone"]);
    const fresh = await makeUser("newcrew");
    const pub = ((await (await ok(api(fresh, "POST", "/api/crews", { name: "Open Road", visibility: "public", area: { name: "Robbinsville", lat: 35.3254, lon: -83.8071 } }))).json()) as { id: string }).id;
    expect((await env.DB.prepare("SELECT public_since FROM crews WHERE id = ?").bind(pub).first<{ public_since: string | null }>())!.public_since).not.toBeNull();
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

  it("the crews feed: each of your crews with its last message and next drive, and the newest across them; members only, blocks and reports kept", async () => {
    const [a, b, c, out] = [await makeUser("alice"), await makeUser("bob"), await makeUser("carol"), await makeUser("outsider")];
    const k1 = await crewOf(a, b, c);
    const k2 = ((await (await ok(api(a, "POST", "/api/crews", { name: "Breakfast Club" }))).json()) as { id: string }).id;
    const k3 = ((await (await ok(api(out, "POST", "/api/crews", { name: "Not yours" }))).json()) as { id: string }).id;
    const feed = async (u: TestUser) => (await (await ok(api(u, "GET", "/api/crews/feed"))).json()) as { crews: any[]; items: any[] };
    expect(await feed(await makeUser("nobody"))).toEqual({ crews: [], items: [] });
    await ok(api(b, "POST", `/api/crews/${k1}/chat`, { body: "Fog by 7?" }));
    await ok(api(a, "POST", `/api/crews/${k2}/chat`, { body: "Pancakes after" }));
    await ok(api(out, "POST", `/api/crews/${k3}/chat`, { body: "secret" }));
    const soon = new Date(Date.now() + 2 * 86400e3).toISOString();
    await ok(api(c, "POST", `/api/crews/${k1}/events`, { title: "Dawn run", starts_at: soon, meet: { lat: 35.36, lon: -84.29 } }));
    await env.DB.prepare("UPDATE crew_chat SET created_at = datetime('now', '-1 hour') WHERE body = 'Fog by 7?'").run();
    await env.DB.prepare("UPDATE crew_events SET created_at = datetime('now', '-10 minutes')").run();
    const f = await feed(a);
    expect(f.crews.map((x) => x.id).sort()).toEqual([k1, k2].sort());
    const one = f.crews.find((x) => x.id === k1);
    expect(one).toMatchObject({ crest: null, last: { handle: "bob", body: "Fog by 7?", mine: false }, next: { title: "Dawn run" } });
    expect(f.crews.find((x) => x.id === k2)).toMatchObject({ last: { handle: "alice", body: "Pancakes after", mine: true }, next: null });
    expect(f.items.map((i) => [i.kind, i.crew_id, i.handle, i.body ?? i.title])).toEqual([
      ["chat", k2, "alice", "Pancakes after"], ["drive", k1, "carol", "Dawn run"], ["chat", k1, "bob", "Fog by 7?"]]);   // newest first
    expect(JSON.stringify(f)).not.toContain("secret");
    expect((await api(await makeUser("guest"), "GET", "/api/crews/feed")).status).not.toBe(500);
    // someone you blocked drops out of it, as from the crew's own chat and drives
    await ok(api(a, "POST", "/api/blocks", { handle: "bob" }));
    await ok(api(a, "POST", "/api/blocks", { handle: "carol" }));
    const g = await feed(a);
    expect(g.items.map((i) => i.handle)).toEqual(["alice"]);
    expect(g.crews.find((x) => x.id === k1)).toMatchObject({ last: null, next: null });
    // older than two weeks is not news
    await env.DB.prepare("UPDATE crew_chat SET created_at = datetime('now', '-15 days')").run();
    expect((await feed(b)).items.filter((i) => i.kind === "chat")).toEqual([]);
  });

  it("chat is capped at 30 an hour a person", async () => {
    const [a] = [await makeUser("alice")];
    const crew = await crewOf(a);
    const res = await Promise.all(Array.from({ length: 33 }, (_, i) => api(a, "POST", `/api/crews/${crew}/chat`, { body: `line ${i}` })));
    expect(res.filter((r) => r.status === 201)).toHaveLength(30);
    expect(res.filter((r) => r.status === 429)).toHaveLength(3);
  });

  it("Decals: one Pro crew-mate dresses the whole crew (Factory, the owner 2026-11-10), opting out takes yours off", async () => {
    const users = [await makeUser("alice"), await makeUser("bob"), await makeUser("carol"), await makeUser("dee")];
    const [a, b, c] = users;
    const crew = await crewOf(a, b, c, users[3]);
    const pro = (u: TestUser, daysAgo: number, expires: string | null = null) => env.DB.prepare(
      "INSERT OR REPLACE INTO pro_entitlements (user_id, source, since, expires_at) VALUES (?, 'app_store', datetime('now', ?), ?)").bind(u.id, `-${daysAgo} days`, expires).run();
    const route = ((await (await ok(api(a, "POST", "/api/routes", { name: "Skyway loop", geom: [[-84.1, 35.3], [-84.0, 35.4]], crews: [crew] }))).json()) as { id: string }).id;
    // Plain: nothing past the Plain look
    expect((await api(a, "PUT", `/api/crews/${crew}/page`, { stripe2: "#ffffff" })).status).toBe(403);
    expect((await api(a, "PUT", `/api/crews/${crew}/page`, { pinned_route_id: route })).status).toBe(403);
    // an expired Pro counts nothing
    await pro(c, 40, "2020-01-01 00:00:00");
    expect((await page(a, crew)).livery).toMatchObject({ decals: 0, tier: "plain", next: null });
    // bob alone (3 Decals, 70 days): the whole livery, no next threshold
    await pro(b, 70);
    let p = await page(a, crew);
    expect(p.livery).toMatchObject({ decals: 3, tier: "factory", next: null });
    expect(p.livery.supporters).toEqual([{ handle: "bob", decals: 3 }]);
    await ok(api(a, "PUT", `/api/crews/${crew}/page`, { stripe2: "#FFFFFF", pinned_route_id: route, stripe3: "#111111", pattern: "chevron" }));
    expect((await api(a, "PUT", `/api/crews/${crew}/page`, { pattern: "zigzag" })).status).toBe(400);
    p = await page(b, crew);
    expect(p).toMatchObject({ stripe2: "#ffffff", pinned: { id: route, name: "Skyway loop" }, stripe3: "#111111", pattern: "chevron" });
    expect(p.livery.mine).toEqual({ pro: true, decals: 3, on: true });
    expect(p.routes).toBeUndefined();                                                                  // only the owner picks
    // bob keeps his Decals off: Plain again, and the look falls back without being lost
    await ok(api(b, "PUT", `/api/crews/${crew}/decals`, { on: false }));
    p = await page(a, crew);
    expect(p.livery).toMatchObject({ decals: 0, tier: "plain" });
    expect([p.stripe2, p.pinned]).toEqual([null, null]);
    await ok(api(b, "PUT", `/api/crews/${crew}/decals`, { on: true }));
    expect(await page(c, crew)).toMatchObject({ stripe2: "#ffffff", stripe3: "#111111", pattern: "chevron" });
    expect((await api(users[0], "PUT", `/api/crews/${crew}/decals`, { on: "yes" })).status).toBe(400);
  });

  it("One Pro crew-mate opens it all: a pinned message, 10 templates, badges, a house stage and a call sign", async () => {
    const [a, b, c, d] = [await makeUser("alice"), await makeUser("bob"), await makeUser("carol"), await makeUser("dee")];
    const crew = await crewOf(a, b, c, d);
    const pro = (u: TestUser, days: number) => env.DB.prepare("INSERT OR REPLACE INTO pro_entitlements (user_id, source, since) VALUES (?, 'founder', datetime('now', ?))").bind(u.id, `-${days} days`).run();
    const msg = ((await (await ok(api(b, "POST", `/api/crews/${crew}/chat`, { body: "Dawn run Saturday, meet 6:15" }))).json()) as { id: string }).id;
    const tpl = (n: number) => api(a, "POST", `/api/crews/${crew}/templates`, { name: `T${n}`, title: "Dawn run", meet: { name: "Hardee's", lat: 35.36, lon: -84.29 } });
    // Plain: none of it
    expect((await api(a, "PUT", `/api/crews/${crew}/page`, { pinned_chat_id: msg })).status).toBe(403);
    expect((await tpl(1)).status).toBe(403);
    expect(await (await ok(api(b, "GET", `/api/crews/${crew}/templates`))).json()).toEqual([]);
    expect((await api(a, "PUT", `/api/crews/${crew}/badges`, { handle: "bob", badge: "Sweep" })).status).toBe(403);
    expect((await api(a, "PUT", `/api/crews/${crew}/page`, { call_sign: "Ridge" })).status).toBe(403);
    // one Pro crew-mate: everything
    await pro(b, 70);
    await ok(api(a, "PUT", `/api/crews/${crew}/page`, { pinned_chat_id: msg }));
    expect((await page(d, crew)).pinned_chat).toMatchObject({ id: msg, body: "Dawn run Saturday, meet 6:15", handle: "bob" });
    for (const n of [1, 2, 3]) await ok(tpl(n));
    expect(((await (await ok(api(d, "GET", `/api/crews/${crew}/templates`))).json()) as any[]).map((t) => t.name)).toEqual(["T1", "T2", "T3"]);
    expect((await api(b, "POST", `/api/crews/${crew}/templates`, { name: "x", title: "x", meet: { lat: 1, lon: 1 } })).status).toBe(404);   // the owner's
    await ok(api(a, "PUT", `/api/crews/${crew}/badges`, { handle: "bob", badge: "Sweep" }));
    await ok(api(a, "PUT", `/api/crews/${crew}/page`, { call_sign: "ridge 1" }));
    const seg = await makeSegment(b, "Skyway climb");
    await env.DB.prepare("INSERT INTO segment_shares (segment_id, audience_type, audience_id) VALUES (?, 'crew', ?)").bind(seg, crew).run();
    await ok(api(b, "PUT", "/api/grants", { audience_type: "crew", audience_id: crew, share_scores: true }));
    await ok(api(b, "POST", "/api/board", { segment_id: seg, driver_score: 744, driven_on: today() }));
    expect((await api(a, "PUT", `/api/crews/${crew}/page`, { house_canon_id: "nope" })).status).toBe(400);
    await ok(api(a, "PUT", `/api/crews/${crew}/page`, { house_canon_id: seg }));
    const p = await page(c, crew);
    expect(p.call_sign).toBe("RIDGE 1");
    expect(p.board.find((r: any) => r.handle === "bob").badge).toBe("Sweep");
    expect(p.house).toEqual({ id: seg, name: "Skyway climb", board: [{ handle: "bob", score: 744 }] });
    expect(p.templates_cap).toBe(10);
    for (const n of [4, 5, 6, 7, 8, 9, 10]) await ok(tpl(n));
    expect((await tpl(11)).status).toBe(429);
    // the call sign rides on the crew's drives (for the convoy's name)
    await ok(api(a, "POST", `/api/crews/${crew}/events`, { title: "Dawn run", starts_at: new Date(Date.now() + 86400e3).toISOString(), meet: { lat: 35.36, lon: -84.29 } }));
    expect(((await (await ok(api(d, "GET", `/api/crews/${crew}/events`))).json()) as any[])[0].call_sign).toBe("RIDGE 1");
    // dropping back to Plain hides it all without losing it
    await env.DB.prepare("DELETE FROM pro_entitlements").run();
    const plain = await page(c, crew);
    expect([plain.pinned_chat, plain.house, plain.call_sign, plain.board.find((r: any) => r.handle === "bob").badge]).toEqual([null, null, null, null]);
  });

  it("Factory: the crew's own hazard categories, reported as a labelled report only by its members", async () => {
    const users = [await makeUser("alice"), await makeUser("bob"), await makeUser("carol"), await makeUser("dee"), await makeUser("eve"), await makeUser("outsider")];
    const [a, b, c, d, e, out] = users;
    const crew = await crewOf(a, b, c, d, e);
    expect((await api(a, "PUT", `/api/crews/${crew}/page`, { hazard_kinds: ["Cattle grid"] })).status).toBe(403);
    // an outsider's Pro dresses nothing; one member's Pro dresses the crew
    await env.DB.prepare("INSERT INTO pro_entitlements (user_id, source, since) VALUES (?, 'founder', datetime('now', '-90 days'))").bind(out.id).run();
    expect((await page(a, crew)).livery.tier).toBe("plain");
    await env.DB.prepare("INSERT INTO pro_entitlements (user_id, source, since) VALUES (?, 'founder', datetime('now', '-90 days'))").bind(e.id).run();
    expect((await page(a, crew)).livery.tier).toBe("factory");
    expect((await api(a, "PUT", `/api/crews/${crew}/page`, { hazard_kinds: ["a", "b", "c", "d", "e"] })).status).toBe(400);
    await ok(api(a, "PUT", `/api/crews/${crew}/page`, { hazard_kinds: [" Cattle   grid ", "Cattle grid", "Logging trucks"] }));
    expect((await page(b, crew)).hazard_kinds).toEqual(["Cattle grid", "Logging trucks"]);
    expect(await (await ok(api(b, "GET", "/api/hazards/kinds"))).json()).toEqual(["Cattle grid", "Logging trucks"]);
    expect(await (await ok(api(out, "GET", "/api/hazards/kinds"))).json()).toEqual([]);
    const r = (await (await ok(api(b, "POST", "/api/hazards", { kind: "debris", label: "Cattle grid", lat: 35.36, lon: -84.29 }))).json()) as { id: string };
    expect((await api(out, "POST", "/api/hazards", { kind: "debris", label: "Cattle grid", lat: 35.36, lon: -84.29 })).status).toBe(400);
    const seen = async (u: TestUser) => ((await (await ok(api(u, "GET", "/api/hazards?lat=35.36&lon=-84.29"))).json()) as any[]).find((h) => h.id === r.id);
    expect(await seen(c)).toMatchObject({ kind: "debris", label: "Cattle grid" });          // the crew reads its own word
    expect(await seen(out)).toMatchObject({ kind: "debris", label: null });                 // everyone else reads Debris
  });

  it("Factory: the regroup line in each pack's voice, uploaded by the owner, played to members; a new line drops the clips", async () => {
    const people = await Promise.all(["alice", "bob", "carol", "dee", "eve", "frank", "gus"].map((h) => makeUser(h)));
    const [a, b] = people, out = await makeUser("outsider");
    const crew = await crewOf(a, ...people.slice(1));
    const wav = (n = 64) => { const x = new Uint8Array(44 + n); x.set([...("RIFF")].map((c) => c.charCodeAt(0)), 0); x.set([...("WAVE")].map((c) => c.charCodeAt(0)), 8); return x; };
    const put = (u: TestUser, pack: string, body: Uint8Array, type = "audio/wav") => exports.default.fetch(new Request(`${ORIGIN}/api/crews/${crew}/voice/${pack}`,
      { method: "PUT", body, headers: { origin: ORIGIN, "x-apexnav": "1", "content-type": type, cookie: `__Host-ax_session=${u.token}` } }));
    expect((await api(a, "PUT", `/api/crews/${crew}/page`, { regroup_line: "Ridge Runners, regroup." })).status).toBe(403);   // Plain
    for (const u of people) await env.DB.prepare("INSERT INTO pro_entitlements (user_id, source, since) VALUES (?, 'founder', datetime('now', '-90 days'))").bind(u.id).run();   // 21
    expect((await put(a, "kit", wav())).status).toBe(400);                                              // no line yet
    await ok(api(a, "PUT", `/api/crews/${crew}/page`, { regroup_line: "Ridge Runners,   regroup." }));
    expect((await put(b, "kit", wav())).status).toBe(404);                                              // the owner's
    expect((await put(a, "jarvis", wav())).status).toBe(400);
    expect((await put(a, "kit", wav(), "audio/mpeg")).status).toBe(415);
    expect((await put(a, "kit", new Uint8Array(100))).status).toBe(400);
    expect((await put(a, "kit", wav(500_000))).status).toBe(413);
    await ok(put(a, "kit", wav())); await ok(put(a, "hale", wav()));
    expect(await page(b, crew)).toMatchObject({ regroup_line: "Ridge Runners, regroup." });
    expect((await page(b, crew)).voice_packs.sort()).toEqual(["hale", "kit"]);
    const got = await ok(api(b, "GET", `/api/crews/${crew}/voice/kit`));
    expect(got.headers.get("content-type")).toBe("audio/wav");
    expect((await api(out, "GET", `/api/crews/${crew}/voice/kit`)).status).toBe(404);
    expect(((await (await ok(api(b, "GET", "/api/crews/voices"))).json()) as any[])).toEqual([{ id: crew, name: "Ridge Runners", call_sign: null, regroup_line: "Ridge Runners, regroup.", packs: expect.arrayContaining(["kit", "hale"]) }]);
    await ok(api(a, "PUT", `/api/crews/${crew}/page`, { regroup_line: "Ridge, regroup now." }));
    expect((await page(b, crew)).voice_packs).toEqual([]);
    expect((await api(b, "GET", `/api/crews/${crew}/voice/kit`)).status).toBe(404);
  });
});

describe("livery grants (migration 0040)", () => {
  beforeEach(freshDb);
  it("a granted member opens the whole livery for their crew, with no Decals; taking the grant away goes back to Plain", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob");
    const crew = await crewOf(a, b);
    expect((await page(b, crew)).livery.tier).toBe("plain");
    await env.DB.prepare("INSERT INTO livery_grants (user_id, note) VALUES (?, 'owner')").bind(a.id).run();
    const p = await page(b, crew);
    expect(p.livery).toMatchObject({ tier: "factory", next: null, granted: true, decals: 0 });
    await ok(api(a, "PUT", `/api/crews/${crew}/page`, { hazard_kinds: ["Cattle grid"] }));   // a Factory setting
    expect((await page(a, crew)).livery.mine).toMatchObject({ pro: true });
    await env.DB.prepare("DELETE FROM livery_grants").run();
    expect((await page(b, crew)).livery).toMatchObject({ tier: "plain", granted: false });
  });
});
