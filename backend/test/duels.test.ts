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
const run = (u: TestUser, seg: string, score: number, day: string, time_s = 300) => ok(api(u, "POST", "/api/board", { segment_id: seg, driver_score: score, time_s, driven_on: day }));
const day = async (offset: number) => (await env.DB.prepare(`SELECT date('now', '${offset} days') AS d`).first<{ d: string }>())!.d;

describe("duels", () => {
  it("a challenge, accepted: the stage reaches the friend, and each side's best Score in the days counts; a time only from a side that shares times", async () => {
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
    expect([mineA.you, mineA.them, mineA.you_share, mineA.they_share]).toEqual([{ score: 812, on: await day(0), time_s: null }, null, true, false]);
    await scoresTo(b, a);
    await run(b, bSeg.id, 845, await day(0));
    [mineA] = await duels(a); [mineB] = await duels(b);
    expect([mineA.you.score, mineA.them.score, mineB.you.score, mineB.them.score]).toEqual([812, 845, 845, 812]);
    expect(JSON.stringify(mineA)).not.toMatch(/300/);                                       // no times shared yet: none shown
    // bob shares times with alice: his quickest in the window shows to her; hers, not shared, stays null
    await ok(api(b, "PUT", "/api/grants", { audience_type: "friend", audience_id: a.id, share_scores: true, share_times: true }));
    await run(b, bSeg.id, 845, await day(0), 271);                                             // the same run, now with its time
    await run(b, bSeg.id, 700, await day(-1), 200);                                             // before it started: not this duel's
    [mineA] = await duels(a); [mineB] = await duels(b);
    expect([mineA.them.score, mineA.them.time_s, mineA.you.time_s, mineB.you.time_s]).toEqual([845, 271, null, 271]);
    // over once its last day has passed
    await env.DB.prepare("UPDATE duels SET starts_on = date('now', '-8 days'), ends_on = date('now', '-1 days') WHERE id = ?").bind(id).run();
    await env.DB.prepare("UPDATE board_entries SET driven_on = date(driven_on, '-2 days')").run();
    [mineA] = await duels(a);
    expect([mineA.status, mineA.you.score, mineA.them.score]).toEqual(["over", 812, 845]);
  });

  it("a time duel: the kind is kept, and each side's times count only under share_times", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob");
    await befriend(a, b);
    const seg = await makeSegment(a, "Dry Ridge climb");
    expect((await api(a, "POST", "/api/duels", { handle: "bob", segment_id: seg, days: 7, kind: "lap" })).status).toBe(400);
    const { id } = await json(api(a, "POST", "/api/duels", { handle: "bob", segment_id: seg, days: 7, kind: "time" }));
    await ok(api(b, "POST", `/api/duels/${id}/accept`));
    await scoresTo(a, b);                                                                            // Scores only: not enough for a time duel
    await run(a, seg, 812, await day(0), 190);
    // a quicker, lower-Scored run on another day, published with a time while alice briefly shared times: once she stops,
    // the day bob sees follows the Score, never her quickest (unshared) run
    await env.DB.prepare("UPDATE duels SET starts_on = date('now', '-1 days') WHERE id = ?").bind(id).run();
    await env.DB.prepare(`INSERT INTO board_entries (id, segment_id, canon_id, user_id, audience_type, audience_id, driver_score, time_s, driven_on)
      VALUES ('q', ?, ?, ?, 'friend', ?, 700, 150, date('now', '-1 days'))`).bind(seg, seg, a.id, b.id).run();
    expect((await duels(b))[0].them).toEqual({ score: 812, on: await day(0), time_s: null });
    await env.DB.prepare("DELETE FROM board_entries WHERE id = 'q'").run();
    let [mineA] = await duels(a), [mineB] = await duels(b);
    expect([mineA.kind, mineA.you_share, mineB.they_share, mineB.them.time_s]).toEqual(["time", false, false, null]);
    await ok(api(a, "PUT", "/api/grants", { audience_type: "friend", audience_id: b.id, share_scores: true, share_times: true }));
    await run(a, seg, 812, await day(0), 190);
    [mineA] = await duels(a); [mineB] = await duels(b);
    expect([mineA.you_share, mineB.they_share, mineB.them.time_s]).toEqual([true, true, 190]);
    // a Score duel stays a Score duel by default
    const seg2 = await makeSegment(a, "Other");
    await ok(api(a, "POST", "/api/duels", { handle: "bob", segment_id: seg2, days: 3 }));
    expect((await duels(a)).map((d) => d.kind).sort()).toEqual(["score", "time"]);
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
