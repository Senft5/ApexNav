// Duels (src/duels.ts, migration 0047): a friend against a friend on a stage for some days; Scores only, from runs each
// side already shows the other.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeSegment, makeUser, ok, type TestUser } from "./helpers";

beforeEach(freshDb);
type Msg = Record<string, any>;
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as Msg;
const duels = async (u: TestUser) => (await json(api(u, "GET", "/api/duels"))) as unknown as Msg[];
const scoresTo = (u: TestUser, to: TestUser) => ok(api(u, "PUT", "/api/grants", { audience_type: "friend", audience_id: to.id, share_scores: true }));
const run = (u: TestUser, seg: string, score: number, day: string) => ok(api(u, "POST", "/api/board", { segment_id: seg, driver_score: score, time_s: 300, driven_on: day }));
const day = async (offset: number) => (await env.DB.prepare(`SELECT date('now', '${offset} days') AS d`).first<{ d: string }>())!.d;

describe("duels", () => {
  it("a challenge, accepted: the stage reaches the friend, and each side's best Score in the days counts, never a time", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob");
    await befriend(a, b);
    const seg = await makeSegment(a, "Dry Ridge climb");
    const { id } = await json(api(a, "POST", "/api/duels", { handle: "@bob", segment_id: seg, days: 7 }));
    let [mineA] = await duels(a), [mineB] = await duels(b);
    expect([mineA.status, mineA.with, mineA.challenger, mineA.stage, mineA.you, mineA.them]).toEqual(["pending", "bob", true, "Dry Ridge climb", null, null]);
    expect([mineB.status, mineB.with, mineB.challenger, mineB.have_stage]).toEqual(["pending", "alice", false, false]);
    expect((await api(a, "POST", `/api/duels/${id}/accept`)).status).toBe(409);                 // only the friend accepts
    expect(await json(api(b, "POST", `/api/duels/${id}/accept`))).toEqual({ stage_added: true });
    const bSeg = ((await json(api(b, "GET", "/api/segments"))) as Msg[]).find((s) => s.name === "Dry Ridge climb")!;
    expect(bSeg.origin_id).toBe(seg);
    [mineB] = await duels(b);
    expect([mineB.status, mineB.have_stage, mineB.starts_on, mineB.ends_on]).toEqual(["on", true, await day(0), await day(6)]);
    // runs: before it started (doesn't count), in it; bob's only count once his Scores reach alice
    await scoresTo(a, b);
    await run(a, seg, 700, await day(-1));
    await run(a, seg, 812, await day(0));
    await run(b, bSeg.id, 790, await day(0));
    [mineA] = await duels(a);
    expect([mineA.you, mineA.them, mineA.you_share, mineA.they_share]).toEqual([{ score: 812, on: await day(0) }, null, true, false]);
    await scoresTo(b, a);
    await run(b, bSeg.id, 845, await day(0));
    [mineA] = await duels(a); [mineB] = await duels(b);
    expect([mineA.you.score, mineA.them.score, mineB.you.score, mineB.them.score]).toEqual([812, 845, 845, 812]);
    expect(JSON.stringify(mineA)).not.toMatch(/time|300/);
    // over once its last day has passed
    await env.DB.prepare("UPDATE duels SET starts_on = date('now', '-8 days'), ends_on = date('now', '-1 days') WHERE id = ?").bind(id).run();
    await env.DB.prepare("UPDATE board_entries SET driven_on = date(driven_on, '-2 days')").run();
    [mineA] = await duels(a);
    expect([mineA.status, mineA.you.score, mineA.them.score]).toEqual(["over", 812, 845]);
  });

  it("only friends, one live duel per stage and pair, the days are 3, 7 or 14, and a stage must be yours", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob"), s = await makeUser("stranger");
    await befriend(a, b);
    const seg = await makeSegment(a), bs = await makeSegment(b);
    expect((await api(a, "POST", "/api/duels", { handle: "stranger", segment_id: seg, days: 7 })).status).toBe(404);
    expect((await api(a, "POST", "/api/duels", { handle: "nobody", segment_id: seg, days: 7 })).status).toBe(404);
    expect((await api(a, "POST", "/api/duels", { handle: "bob", segment_id: bs, days: 7 })).status).toBe(404);
    for (const days of [0, 5, 30, "7"]) expect((await api(a, "POST", "/api/duels", { handle: "bob", segment_id: seg, days })).status).toBe(400);
    await ok(api(a, "POST", "/api/duels", { handle: "bob", segment_id: seg, days: 3 }));
    expect((await api(a, "POST", "/api/duels", { handle: "bob", segment_id: seg, days: 14 })).status).toBe(409);
    expect(await duels(s)).toEqual([]);
  });

  it("declined by the friend, withdrawn by either; a block or an unfriending hides it", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob");
    await befriend(a, b);
    const seg = await makeSegment(a);
    const d1 = (await json(api(a, "POST", "/api/duels", { handle: "bob", segment_id: seg, days: 7 }))).id;
    expect(await json(api(b, "DELETE", `/api/duels/${d1}`))).toEqual({ status: "declined" });
    expect((await api(b, "POST", `/api/duels/${d1}/accept`)).status).toBe(409);
    const d2 = (await json(api(a, "POST", "/api/duels", { handle: "bob", segment_id: seg, days: 7 }))).id;   // declined is no longer live
    await ok(api(b, "POST", `/api/duels/${d2}/accept`));
    expect(await json(api(a, "DELETE", `/api/duels/${d2}`))).toEqual({ status: "withdrawn" });
    expect((await duels(a)).map((d: Msg) => d.status)).toEqual(["withdrawn", "declined"]);
    const d3 = (await json(api(a, "POST", "/api/duels", { handle: "bob", segment_id: seg, days: 7 }))).id;
    await ok(api(a, "DELETE", `/api/friends/${b.id}`));
    expect((await duels(b)).map((d: Msg) => d.id)).not.toContain(d3);
    expect((await api(b, "POST", `/api/duels/${d3}/accept`)).status).toBe(404);
    await befriend(a, b);
    await ok(api(b, "POST", "/api/blocks", { user_id: a.id }));
    expect(await duels(a)).toEqual([]);
  });

  it("export lists them, deleting an account takes them, the sweep clears old ones", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob");
    await befriend(a, b);
    const seg = await makeSegment(a, "Dry Ridge climb");
    await ok(api(a, "POST", "/api/duels", { handle: "bob", segment_id: seg, days: 7 }));
    const ex = await json(api(b, "GET", "/api/me/export"));
    expect(ex.duels.map((d: Msg) => [d.stage, d.with_handle, d.side, d.status])).toEqual([["Dry Ridge climb", "alice", "challenged you", "pending"]]);
    await env.DB.prepare("UPDATE duels SET created_at = datetime('now', '-61 days')").run();
    const { sweepExpired } = await import("../src/sweep");
    expect((await sweepExpired(env as any)).duels).toBe(1);
    await ok(api(a, "POST", "/api/duels", { handle: "bob", segment_id: seg, days: 7 }));
    await ok(api(a, "DELETE", "/api/me", { confirm: "DELETE" }));
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM duels").first<{ n: number }>())!.n).toBe(0);
  });
});
