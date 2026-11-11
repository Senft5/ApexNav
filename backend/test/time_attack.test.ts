// Weekly time attack (src/time_attack.ts, migration 0049): a stage put up for its area, one picked per area per week,
// entering copies it, the quickest time this week goes on a board every member sees, blocks hide, a report takes it down.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeSegment, makeUser, ok, type TestUser } from "./helpers";
import { cellOf, pick } from "../src/time_attack";

type Msg = Record<string, any>;
beforeEach(freshDb);
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as Msg;
const HERE = "lat=39.25&lon=-84.6", CELL = "39,-85";             // makeSegment starts at 39.25, -84.6
const ta = (u: TestUser) => json(api(u, "GET", `/api/timeattack?${HERE}`));
const today = async () => (await env.DB.prepare("SELECT date('now') AS d").first<{ d: string }>())!.d;
const monday = async () => (await env.DB.prepare("SELECT date('now', '-6 days', 'weekday 1') AS d").first<{ d: string }>())!.d;

describe("time attack", () => {
  it("cells and the pick are stable", () => {
    expect([cellOf(39.25, -84.6), cellOf(-33.9, 151.2), cellOf(0.5, -0.5)]).toEqual(["39,-85", "-34,151", "0,-1"]);
    const list = [{ segment_id: "b" }, { segment_id: "a" }, { segment_id: "c" }];
    expect(pick(list, "2026-11-09|39,-85")).toEqual(pick([...list].reverse(), "2026-11-09|39,-85"));
    expect(pick([], "x")).toBeNull();
  });

  it("put up, picked for the week, entered, timed; the quickest stays; the board is everyone's, blocks hide", async () => {
    const [a, b, c, d] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara"), await makeUser("dee")];
    expect((await ta(b)).circuit).toBeNull();                                                 // nothing put up yet
    const seg = await makeSegment(a, "Dry Ridge climb");
    expect(await json(api(a, "POST", "/api/timeattack/pool", { segment_id: seg }))).toEqual({ cell: CELL });
    expect((await api(b, "POST", "/api/timeattack/pool", { segment_id: seg })).status).toBe(404);   // not yours
    let t = await ta(b);
    expect([t.circuit.segment_id, t.circuit.name, t.circuit.by, t.week, t.entered, t.board]).toEqual([seg, "Dry Ridge climb", "alice", await monday(), false, []]);
    expect(await json(api(b, "GET", "/api/timeattack/circuits"))).toMatchObject({ week: await monday(), circuits: [{ segment_id: seg, cell: CELL }] });
    // entering copies it; runs on the copy count, the quickest stays
    const e = await json(api(b, "POST", "/api/timeattack/enter", { cell: CELL }));
    expect(e.added).toBe(true);
    expect(await json(api(b, "POST", "/api/timeattack/enter", { cell: CELL }))).toEqual({ segment_id: e.segment_id, added: false });
    const day = await today();
    expect(await json(api(b, "POST", "/api/timeattack/runs", { runs: [{ segment_id: e.segment_id, time_s: 200, driver_score: 780, driven_on: day }] }))).toEqual({ accepted: 1 });
    await ok(api(b, "POST", "/api/timeattack/runs", { runs: [{ segment_id: e.segment_id, time_s: 230, driver_score: 900, driven_on: day }] }));   // slower: not kept
    await ok(api(a, "POST", "/api/timeattack/runs", { runs: [{ segment_id: seg, time_s: 190, driver_score: 700, driven_on: day }] }));           // the owner's own stage counts
    const cs = await json(api(c, "POST", "/api/timeattack/enter", { cell: CELL }));
    await ok(api(c, "POST", "/api/timeattack/runs", { runs: [{ segment_id: cs.segment_id, time_s: 200, driver_score: 810, driven_on: day }] }));
    // not counted: a stage that isn't the circuit, a day outside the week, 2.5 km in 30 s
    const other = await makeSegment(d, "Other");
    expect(await json(api(d, "POST", "/api/timeattack/runs", { runs: [{ segment_id: other, time_s: 100, driven_on: day }] }))).toEqual({ accepted: 0 });
    expect(await json(api(b, "POST", "/api/timeattack/runs", { runs: [{ segment_id: e.segment_id, time_s: 150, driven_on: "2020-01-06" }] }))).toEqual({ accepted: 0 });
    expect((await api(b, "POST", "/api/timeattack/runs", { runs: [{ segment_id: e.segment_id, time_s: 30, driven_on: day }] })).status).toBe(400);
    t = await ta(d);
    expect(t.board.map((x: Msg) => [x.place, x.handle, x.time_s, x.gap_s, x.score])).toEqual([[1, "alice", 190, 0, 700], [2, "bob", 200, 10, 780], [2, "cara", 200, 10, 810]]);
    expect([t.you, t.entrants]).toEqual([null, 3]);
    t = await ta(b);
    expect([t.entered, t.you.place, t.you.mine]).toEqual([true, 2, true]);
    // a block hides people both ways; leaving takes your time off
    await ok(api(d, "POST", "/api/blocks", { handle: "alice" }));
    expect((await ta(d)).board.map((x: Msg) => x.handle)).toEqual(["bob", "cara"]);
    expect((await ta(a)).board.map((x: Msg) => x.handle)).toEqual(["alice", "bob", "cara"]);   // dee isn't on it to hide
    await ok(api(c, "DELETE", `/api/timeattack/entry?${HERE}`));
    expect((await ta(b)).board.map((x: Msg) => x.handle)).toEqual(["alice", "bob"]);
    // the export lists both; deleting the account takes them
    const ex = await json(api(a, "GET", "/api/me/export"));
    expect([ex.time_attack_stages.length, ex.time_attack_times.length]).toEqual([1, 1]);
    await ok(api(a, "DELETE", "/api/me", { confirm: "DELETE" }));
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM ta_pool").first<{ n: number }>())!.n).toBe(0);
    expect((await ta(b)).board.map((x: Msg) => x.handle)).toEqual(["bob"]);
  });

  it("limits: a handle, your own original stage, 1 to 25 km, three at most; last week's stage isn't picked again while there's another", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob");
    const copy = crypto.randomUUID();
    const segs = [await makeSegment(a, "One"), await makeSegment(a, "Two"), await makeSegment(a, "Three"), await makeSegment(a, "Four")];
    await env.DB.prepare("INSERT INTO segments (id, owner, name, length_m, geom, start_lat, start_lon, end_lat, end_lon, origin_id) VALUES (?, ?, 'Copy', 2500, '[[1,2]]', 39.2, -84.6, 39.3, -84.5, ?)").bind(copy, b.id, segs[0]).run();
    expect((await api(b, "POST", "/api/timeattack/pool", { segment_id: copy })).status).toBe(404);
    await env.DB.prepare("UPDATE segments SET length_m = 400 WHERE id = ?").bind(segs[3]).run();
    expect((await api(a, "POST", "/api/timeattack/pool", { segment_id: segs[3] })).status).toBe(400);
    for (const s of segs.slice(0, 3)) await ok(api(a, "POST", "/api/timeattack/pool", { segment_id: s }));
    await env.DB.prepare("UPDATE segments SET length_m = 2500 WHERE id = ?").bind(segs[3]).run();
    expect((await api(a, "POST", "/api/timeattack/pool", { segment_id: segs[3] })).status).toBe(429);
    // last week's pick: set it to whatever this week would pick, then clear this week, and the pick moves on
    const first = (await ta(b)).circuit.segment_id;
    await env.DB.prepare("UPDATE ta_weeks SET week = date(week, '-7 days')").run();
    expect((await ta(b)).circuit.segment_id).not.toBe(first);
    const nohandle = await makeUser("zed");
    await env.DB.prepare("UPDATE users SET handle = NULL WHERE id = ?").bind(nohandle.id).run();
    expect((await api(nohandle, "POST", "/api/timeattack/enter", { cell: CELL })).status).toBe(409);
  });

  it("a stage put up can be reported; removed, it leaves the pool and this week, and can't be put up again", async () => {
    const [a, b, mod] = [await makeUser("alice"), await makeUser("bob"), await makeUser("owner")];
    const seg = await makeSegment(a, "Rude name");
    await ok(api(a, "POST", "/api/timeattack/pool", { segment_id: seg }));
    expect((await ta(b)).circuit.segment_id).toBe(seg);
    const e = await json(api(b, "POST", "/api/timeattack/enter", { cell: CELL }));
    await ok(api(b, "POST", "/api/timeattack/runs", { runs: [{ segment_id: e.segment_id, time_s: 200, driven_on: await today() }] }));
    expect((await api(a, "POST", "/api/reports", { kind: "circuit", target: seg, reason: "abuse" })).status).toBe(404);   // not your own
    await ok(api(b, "POST", "/api/reports", { kind: "circuit", target: seg, reason: "abuse" }));
    const q = (await (await ok(api(mod, "GET", "/api/moderation"))).json()) as Msg[];
    expect(q.map((r) => [r.kind, r.label])).toEqual([["circuit", 'time attack stage "Rude name" · @alice']]);
    await ok(api(mod, "POST", "/api/moderation/resolve", { kind: "circuit", target: seg, action: "remove" }));
    expect((await ta(b)).circuit).toBeNull();
    expect((await ta(b)).board).toEqual([]);                                                   // its times went with it
    expect((await api(a, "POST", "/api/timeattack/pool", { segment_id: seg })).status).toBe(403);
  });
});
