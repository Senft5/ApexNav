// Fixed time attacks (src/ta_fixed.ts, migration 0057): up to three loops per area a season, built by the first phones from
// seeds and kept the season, at least 3 km apart; one featured a week in turn; entering is the opt-in; your quickest each day
// is kept, so a board reads for the week, month, year or all time; blocks hide; leaving takes your times; a report takes one down.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeSegment, makeUser, ok, type TestUser } from "./helpers";
import { featuredOf, seedFor } from "../src/ta_fixed";

type Msg = Record<string, any>;
beforeEach(freshDb);
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as Msg;
const HERE = "lat=39.3&lon=-84.6", CELL = "39.25,-84.75";
const area = (u: TestUser, q = "") => json(api(u, "GET", `/api/ta?${HERE}${q}`));
const one = async (sql: string) => (await env.DB.prepare(sql).first<{ d: string }>())!.d;
const today = () => one("SELECT date('now') AS d");
const season = () => one("SELECT date('now', 'start of month', '-' || ((CAST(strftime('%m', 'now') AS INTEGER) - 1) % 3) || ' months') AS d");

// A square loop of 4 x `side` m from (lat, lon), a point every side/10 m, back where it started.
function square(lat: number, lon: number, side = 2500): number[][] {
  const dLat = side / 111195, dLon = side / (111195 * Math.cos((lat * Math.PI) / 180)), out: number[][] = [];
  const c = [[lat, lon], [lat + dLat, lon], [lat + dLat, lon + dLon], [lat, lon + dLon], [lat, lon]];
  for (let k = 0; k < 4; k++) for (let i = 0; i < 10; i++) out.push([c[k][0] + ((c[k + 1][0] - c[k][0]) * i) / 10, c[k][1] + ((c[k + 1][1] - c[k][1]) * i) / 10]);
  out.push([lat, lon]);
  return out;
}
const STARTS = [[39.26, -84.6], [39.36, -84.7], [39.42, -84.56]];
const build = async (u: TestUser, at: number[], name = "Dry Ridge Road loop") => {
  const t = await area(u);
  return json(api(u, "POST", "/api/ta/circuit", { cell: CELL, slot: t.make.slot, seed: t.make.seed, name, geom: square(at[0], at[1]) }));
};
const run = (u: TestUser, segment_id: string, time_s: number, driven_on: string, driver_score: number | null = null) =>
  json(api(u, "POST", "/api/ta/runs", { runs: [{ segment_id, time_s, driven_on, driver_score }] }));

describe("fixed time attack", () => {
  it("seeds and the featured one", () => {
    expect(seedFor("2026-10-01", CELL, 2, 1)).toBe("2026-10-01|39.25,-84.75|2|1");
    const three = ["a", "b", "c"];
    expect(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-12-28"].map((w) => featuredOf(three, "2026-10-01", w)))
      .toEqual(["a", "b", "c", "a", "a"]);                                                   // 12 weeks in: back to the first
    expect([featuredOf([], "2026-10-01", "2026-10-05"), featuredOf(["x"], "2026-10-01", "2026-09-29")]).toEqual([null, "x"]);
  });

  it("three loops a season, 3 km apart, each kept; one featured; the area then asks for none", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    let t = await area(b);
    expect([t.season, t.circuits, t.board, t.make]).toEqual([await season(), [], null,
      { slot: 0, seed: seedFor(await season(), CELL, 0, 0), km: { min: 8, max: 16 }, best: true, avoid: [] }]);
    expect((await api(b, "GET", "/api/ta?lat=39.3&lon=-84.6&period=decade")).status).toBe(400);
    expect((await api(b, "POST", "/api/ta/circuit", { cell: CELL, slot: 1, seed: t.make.seed, geom: square(39.26, -84.6) })).status).toBe(409);   // not the slot asked for
    const m0 = await build(a, STARTS[0]);
    expect([m0.kept, m0.circuit.slot, m0.circuit.id.startsWith("ta-")]).toEqual([true, 0, true]);
    t = await area(b);
    expect([t.make.slot, t.make.avoid]).toEqual([1, [[39.26, -84.6]]]);
    // a second loop from the same junction is the same drive
    expect((await api(b, "POST", "/api/ta/circuit", { cell: CELL, slot: 1, seed: t.make.seed, geom: square(39.27, -84.61) })).status).toBe(400);
    await build(b, STARTS[1], "");
    await build(a, STARTS[2], "Hog Run loop");
    t = await area(b);
    expect([t.make, t.circuits.map((c: Msg) => [c.slot, c.name, c.entered])]).toEqual([null, [[0, "Dry Ridge Road loop", false], [1, "Local loop", false], [2, "Hog Run loop", false]]]);
    expect(t.circuits.filter((c: Msg) => c.featured).length).toBe(1);
    expect(t.board).toMatchObject({ id: t.circuits.find((c: Msg) => c.featured).id, period: "week", entrants: 0, rows: [], you: null });
    // a race for a slot already kept answers with the kept one
    const raced = await json(api(a, "POST", "/api/ta/circuit", { cell: CELL, slot: 0, seed: "x", geom: square(39.3, -84.5) }));
    expect([raced.kept, raced.circuit.id]).toEqual([false, m0.circuit.id]);
    expect((await api(b, "GET", `/api/ta?${HERE}&id=ta-nope`)).status).toBe(404);
  });

  it("a new account with no inviter isn't asked to build a loop and can't set one", async () => {
    const [n, a] = [await makeUser("newbie"), await makeUser("alice")];
    await env.DB.prepare("UPDATE members SET joined_at = datetime('now', '-1 day'), invited_by = NULL WHERE user_id = ?").bind(n.id).run();
    expect((await area(n)).make).toBeNull();
    const seed = (await area(a)).make.seed;
    expect((await api(n, "POST", "/api/ta/circuit", { cell: CELL, slot: 0, seed, geom: square(39.26, -84.6) })).status).toBe(403);
    expect((await area(a)).make.slot).toBe(0);                                                // nothing kept
    await env.DB.prepare("UPDATE members SET invited_by = ? WHERE user_id = ?").bind(a.id, n.id).run();   // invited: may
    expect((await build(n, STARTS[0])).kept).toBe(true);
  });

  it("entered, timed, a board for the week, month, year and all time; blocks hide; leaving takes your times", async () => {
    const [a, b, c, d] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara"), await makeUser("dee")];
    const id = (await build(a, STARTS[0])).circuit.id, day = await today();
    const seg = async (u: TestUser) => (await json(api(u, "POST", "/api/ta/enter", { id }))).segment_id as string;
    const [sb, sc] = [await seg(b), await seg(c)];
    expect(await json(api(b, "POST", "/api/ta/enter", { id }))).toEqual({ segment_id: sb, added: false });
    expect(await json(api(b, "GET", "/api/ta/entered"))).toMatchObject({ season: await season(), circuits: [{ id, cell: CELL, name: "Dry Ridge Road loop" }] });
    expect((await run(b, sb, 600, day, 780)).places).toEqual([{ id, name: "Dry Ridge Road loop", place: 1, of: 1, time_s: 600, gap_s: 0 }]);
    await run(b, sb, 640, day, 900);                                                           // slower the same day: not kept
    expect((await run(c, sc, 590, day, 700)).places).toEqual([{ id, name: "Dry Ridge Road loop", place: 1, of: 2, time_s: 590, gap_s: 0 }]);
    // not counted: a stage that isn't the circuit, a run before the season, a run in the future; 10 km in 100 s is refused
    const other = await makeSegment(d, "Other");
    expect(await run(d, other, 100, day)).toMatchObject({ accepted: 0 });
    expect(await run(b, sb, 500, "2020-01-06")).toMatchObject({ accepted: 0 });
    expect(await run(b, sb, 500, "2999-01-01")).toMatchObject({ accepted: 0 });
    expect(await run(b, sb, 100, day)).toEqual({ accepted: 0, refused: 1, places: [] });
    // the periods: a quicker time from last year counts for all time only (put in by hand: the season's own days are this quarter)
    await env.DB.prepare("INSERT INTO ta_times (circuit_id, user_id, driven_on, time_s) VALUES (?, ?, date('now', '-1 year'), 550)").bind(id, b.id).run();
    const rows = async (period: string) => (await area(d, `&id=${id}&period=${period}`)).board.rows.map((r: Msg) => [r.place, r.handle, r.time_s, r.gap_s]);
    expect(await rows("week")).toEqual([[1, "cara", 590, 0], [2, "bob", 600, 10]]);
    expect(await rows("month")).toEqual([[1, "cara", 590, 0], [2, "bob", 600, 10]]);
    expect(await rows("year")).toEqual([[1, "cara", 590, 0], [2, "bob", 600, 10]]);
    expect(await rows("all")).toEqual([[1, "bob", 550, 0], [2, "cara", 590, 40]]);
    const week = (await area(b, `&id=${id}`)).board;
    expect([week.you.place, week.you.mine, week.you.score, week.entrants]).toEqual([2, true, 780, 2]);
    expect((await area(b)).circuits[0].entered).toBe(true);
    await ok(api(d, "POST", "/api/blocks", { handle: "cara" }));
    expect(await rows("week")).toEqual([[1, "bob", 600, 0]]);
    await ok(api(b, "DELETE", `/api/ta/entry?id=${id}`));
    expect(await rows("all")).toEqual([]);                                                     // cara is blocked by dee; bob left
    expect(await run(b, sb, 580, day)).toMatchObject({ accepted: 0 });                          // left: runs no longer count
    const ex = await json(api(c, "GET", "/api/me/export"));
    expect([ex.fixed_time_attack_times.length, ex.fixed_time_attack_entered.length]).toEqual([1, 1]);
    const nohandle = await makeUser("zed");
    await env.DB.prepare("UPDATE users SET handle = NULL WHERE id = ?").bind(nohandle.id).run();
    expect((await api(nohandle, "POST", "/api/ta/enter", { id })).status).toBe(409);
  });

  it("someone quicker this week is in For you", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    const id = (await build(a, STARTS[0])).circuit.id, day = await today();
    const sa = (await json(api(a, "POST", "/api/ta/enter", { id }))).segment_id, sb = (await json(api(b, "POST", "/api/ta/enter", { id }))).segment_id;
    await run(a, sa, 600, day);
    await env.DB.prepare("UPDATE ta_times SET updated_at = datetime('now', '-1 hour')").run();
    await run(b, sb, 590, day);
    const inbox = await json(api(a, "GET", "/api/inbox"));
    expect(inbox.items.filter((i: Msg) => i.kind === "passed").map((i: Msg) => [i.handle, i.stage, i.gap_s, i.place])).toEqual([["bob", "Dry Ridge Road loop", 10, 2]]);
  });

  it("a loop can be reported; taken down, its times go and its slot is built again from the next seed", async () => {
    const [a, b, mod] = [await makeUser("alice"), await makeUser("bob"), await makeUser("owner")];
    const id = (await build(a, STARTS[0], "Rude name")).circuit.id;
    const sb = (await json(api(b, "POST", "/api/ta/enter", { id }))).segment_id;
    await run(b, sb, 600, await today());
    await ok(api(b, "POST", "/api/reports", { kind: "circuit", target: id, reason: "abuse" }));
    const q = (await (await ok(api(mod, "GET", "/api/moderation"))).json()) as Msg[];
    expect(q.map((r) => [r.kind, r.label])).toEqual([["circuit", `time attack loop "Rude name" · area ${CELL}`]]);
    await ok(api(mod, "POST", "/api/moderation/resolve", { kind: "circuit", target: id, action: "remove" }));
    let t = await area(b);
    expect([t.circuits, t.board, t.make.slot, t.make.seed, t.make.avoid]).toEqual([[], null, 0, seedFor(await season(), CELL, 0, 1), []]);
    expect((await json(api(b, "GET", "/api/ta/entered"))).circuits).toEqual([]);
    expect((await api(b, "POST", "/api/ta/enter", { id })).status).toBe(404);
    const again = await build(b, STARTS[0]);
    expect([again.kept, again.circuit.id === id]).toEqual([true, false]);
    t = await area(a);
    expect([t.circuits.map((c: Msg) => [c.name, c.entered]), t.board.rows]).toEqual([[["Dry Ridge Road loop", false]], []]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM ta_times").first<Msg>()).toEqual({ n: 0 });
  });
});
