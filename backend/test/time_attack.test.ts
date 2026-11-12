// Weekly time attack (src/time_attack.ts, migrations 0049, 0051, 0054): the first phone in an area builds the week's loop from
// the seed, entering copies it, the quickest time this week goes on a board every member sees, blocks hide, a report takes it down.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeSegment, makeUser, ok, type TestUser } from "./helpers";
import { cellOf, checkLoop, seedOf } from "../src/time_attack";

type Msg = Record<string, any>;
beforeEach(freshDb);
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as Msg;
const HERE = "lat=39.25&lon=-84.6", CELL = "39.25,-84.75";             // makeSegment starts at 39.25, -84.6
const ta = (u: TestUser) => json(api(u, "GET", `/api/timeattack?${HERE}`));
const today = async () => (await env.DB.prepare("SELECT date('now') AS d").first<{ d: string }>())!.d;
const monday = async () => (await env.DB.prepare("SELECT date('now', '-6 days', 'weekday 1') AS d").first<{ d: string }>())!.d;

// A 10 km square loop from 39.25, -84.6 (2.5 km a side, a point every ~250 m), back where it started.
function square(lat = 39.25, lon = -84.6, side = 2500): number[][] {
  const dLat = side / 111195, dLon = side / (111195 * Math.cos((lat * Math.PI) / 180)), out: number[][] = [];
  const corners = [[lat, lon], [lat + dLat, lon], [lat + dLat, lon + dLon], [lat, lon + dLon], [lat, lon]];
  for (let k = 0; k < 4; k++) for (let i = 0; i < 10; i++) {
    const [a, b] = [corners[k], corners[k + 1]];
    out.push([a[0] + ((b[0] - a[0]) * i) / 10, a[1] + ((b[1] - a[1]) * i) / 10]);
  }
  out.push([lat, lon]);
  return out;
}
const build = async (u: TestUser, extra: Msg = {}) => {
  const t = await ta(u);
  return json(api(u, "POST", "/api/timeattack/circuit", { cell: CELL, seed: t.make?.seed, name: "Dry Ridge Road loop", geom: square(), ...extra }));
};

describe("time attack", () => {
  it("cells, seeds and the loop check", () => {
    expect([cellOf(39.25, -84.6), cellOf(-33.9, 151.2), cellOf(0.5, -0.5), cellOf(39.1, -84.1)]).toEqual(["39.25,-84.75", "-34,151", "0.5,-0.5", "39,-84.25"]);
    expect(seedOf("2026-11-09", CELL, 0)).toBe("2026-11-09|39.25,-84.75|0");
    const ok1 = checkLoop(square(), CELL);
    expect(ok1.length_m).toBeGreaterThan(9900);
    expect(ok1.length_m).toBeLessThan(10100);
    const bad = (g: unknown, code: string) => { try { checkLoop(g, CELL); throw new Error("passed"); } catch (e: any) { expect(e.message).toBe(code); } };
    bad(square().slice(0, 30), "not_a_loop");                                  // stops short of its start
    bad(square(38.5, -84.6), "not_in_area");                                   // starts in an area to the south
    bad(square(39.2, -84.6), "not_in_area");                                   // 5 km south: the next quarter-degree area
    bad(square(39.25, -84.6, 800), "bad_length");                              // 3.2 km: under 5
    bad(square(39.25, -84.6, 7000), "bad_length");                             // 28 km: over 25
    const jump = square(); jump.splice(5, 0, [39.5, -84.6]);
    bad(jump, "bad_geom");                                                     // a 28 km line between two points: drawn, not roads
    bad(square().slice(0, 9), "bad_geom");                                     // too few points
  });

  it("no loop yet: the seed; the first phone's loop is the week's, nobody's name on it; entered, timed, the quickest stays; blocks hide", async () => {
    const [a, b, c, d] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara"), await makeUser("dee")];
    let t = await ta(b);
    expect([t.circuit, t.make]).toEqual([null, { seed: seedOf(await monday(), CELL, 0), km: { min: 8, max: 16 } }]);
    expect((await api(b, "GET", "/api/timeattack")).status).toBe(400);                         // no area: a 400, not the (0, 0) square
    expect((await api(b, "POST", "/api/timeattack/enter", { cell: "39.1,-84.75" })).status).toBe(400);   // not an area's corner: nothing finer
    expect((await api(b, "POST", "/api/timeattack/circuit", { cell: CELL, seed: "2020-01-06|39,-85|0", geom: square() })).status).toBe(409);   // not this week's seed
    const made = await build(a);
    expect([made.kept, made.circuit.name, made.circuit.length_m > 9900, made.circuit.segment_id.startsWith("ta-")]).toEqual([true, "Dry Ridge Road loop", true, true]);
    // a second phone that raced it gets the one kept
    const raced = await json(api(c, "POST", "/api/timeattack/circuit", { cell: CELL, seed: t.make.seed, name: "Other", geom: square(39.3, -84.5) }));
    expect([raced.kept, raced.circuit.segment_id]).toEqual([false, made.circuit.segment_id]);
    t = await ta(b);
    const id = made.circuit.segment_id;
    expect([t.circuit.segment_id, t.circuit.by, t.make, t.week, t.entered, t.board]).toEqual([id, undefined, null, await monday(), false, []]);
    expect(await json(api(b, "GET", "/api/timeattack/circuits"))).toMatchObject({ week: await monday(), circuits: [] });   // only weeks you entered
    const e = await json(api(b, "POST", "/api/timeattack/enter", { cell: CELL }));
    expect(e.added).toBe(true);
    expect(await json(api(b, "POST", "/api/timeattack/enter", { cell: CELL }))).toEqual({ segment_id: e.segment_id, added: false });
    const mine = await env.DB.prepare("SELECT name, origin_id, start_lat, end_lat FROM segments WHERE id = ?").bind(e.segment_id).first<Msg>();
    expect(mine).toEqual({ name: "Dry Ridge Road loop", origin_id: id, start_lat: 39.25, end_lat: 39.25 });
    expect(await json(api(b, "GET", "/api/timeattack/circuits"))).toMatchObject({ circuits: [{ segment_id: id, cell: CELL }] });
    const day = await today();
    expect(await json(api(b, "POST", "/api/timeattack/runs", { runs: [{ segment_id: e.segment_id, time_s: 600, driver_score: 780, driven_on: day }] }))).toMatchObject({ accepted: 1 });
    await ok(api(b, "POST", "/api/timeattack/runs", { runs: [{ segment_id: e.segment_id, time_s: 640, driver_score: 900, driven_on: day }] }));   // slower: not kept
    const as = await json(api(a, "POST", "/api/timeattack/enter", { cell: CELL }));                 // building it isn't entering
    // your place after the sync, as the board has it (ties share a place)
    expect((await json(api(a, "POST", "/api/timeattack/runs", { runs: [{ segment_id: as.segment_id, time_s: 590, driver_score: 700, driven_on: day }] }))).places)
      .toEqual([{ cell: CELL, name: "Dry Ridge Road loop", place: 1, of: 2, time_s: 590, gap_s: 0 }]);
    const cs = await json(api(c, "POST", "/api/timeattack/enter", { cell: CELL }));
    expect((await json(api(c, "POST", "/api/timeattack/runs", { runs: [{ segment_id: cs.segment_id, time_s: 600, driver_score: 810, driven_on: day }] }))).places)
      .toEqual([{ cell: CELL, name: "Dry Ridge Road loop", place: 2, of: 3, time_s: 600, gap_s: 10 }]);
    // not counted: a stage that isn't the circuit, a day outside the week; 10 km in 100 s is refused, not an error
    const other = await makeSegment(d, "Other");
    expect(await json(api(d, "POST", "/api/timeattack/runs", { runs: [{ segment_id: other, time_s: 100, driven_on: day }] }))).toMatchObject({ accepted: 0 });
    expect(await json(api(b, "POST", "/api/timeattack/runs", { runs: [{ segment_id: e.segment_id, time_s: 550, driven_on: "2020-01-06" }] }))).toMatchObject({ accepted: 0 });
    expect(await json(api(b, "POST", "/api/timeattack/runs", { runs: [{ segment_id: e.segment_id, time_s: 100, driven_on: day }, { segment_id: cs.segment_id, time_s: 500, driven_on: day }] })))
      .toEqual({ accepted: 0, refused: 1, places: [] });
    t = await ta(d);
    expect(t.board.map((x: Msg) => [x.place, x.handle, x.time_s, x.gap_s, x.score])).toEqual([[1, "alice", 590, 0, 700], [2, "bob", 600, 10, 780], [2, "cara", 600, 10, 810]]);
    expect([t.you, t.entrants]).toEqual([null, 3]);
    t = await ta(b);
    expect([t.entered, t.you.place, t.you.mine]).toEqual([true, 2, true]);
    await ok(api(d, "POST", "/api/blocks", { handle: "alice" }));
    expect((await ta(d)).board.map((x: Msg) => x.handle)).toEqual(["bob", "cara"]);
    await ok(api(c, "DELETE", `/api/timeattack/entry?${HERE}`));
    expect((await ta(b)).board.map((x: Msg) => x.handle)).toEqual(["alice", "bob"]);
    expect(await json(api(c, "POST", "/api/timeattack/runs", { runs: [{ segment_id: cs.segment_id, time_s: 600, driven_on: day }] }))).toMatchObject({ accepted: 0 });
    // last week: the podium under its name, and this week asks for a new loop
    await env.DB.batch(["ta_weeks", "ta_entries", "ta_joins"].map((tb) => env.DB.prepare(`UPDATE ${tb} SET week = date(week, '-7 days')`)));
    t = await ta(b);
    expect([t.circuit, t.make?.seed, t.last]).toEqual([null, seedOf(await monday(), CELL, 0), { name: "Dry Ridge Road loop", podium: [{ handle: "alice", time_s: 590 }, { handle: "bob", time_s: 600 }] }]);
    const ex = await json(api(a, "GET", "/api/me/export"));
    expect([ex.time_attack_times.length, ex.time_attack_entered.length]).toEqual([1, 1]);
  });

  it("a member's stage picked before the change is replaced by a loop; bad loops are 400s", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    const seg = await makeSegment(a, "Old pick");
    await env.DB.prepare("INSERT INTO ta_weeks (week, cell, segment_id) VALUES (?, ?, ?)").bind(await monday(), CELL, seg).run();
    let t = await ta(b);
    expect([t.circuit, t.make.seed]).toEqual([null, seedOf(await monday(), CELL, 1)]);
    expect((await api(b, "POST", "/api/timeattack/circuit", { cell: CELL, seed: t.make.seed, geom: square().slice(0, 30) })).status).toBe(400);
    expect((await api(b, "POST", "/api/timeattack/circuit", { cell: CELL, seed: t.make.seed, geom: [[1, 2]] })).status).toBe(400);
    await env.DB.prepare("UPDATE members SET joined_at = datetime('now') WHERE user_id = ?").bind(b.id).run();   // a new account can't set it
    expect((await api(b, "POST", "/api/timeattack/circuit", { cell: CELL, seed: t.make.seed, geom: square() })).status).toBe(403);
    await env.DB.prepare("UPDATE members SET joined_at = datetime('now', '-30 days') WHERE user_id = ?").bind(b.id).run();
    const made = await json(api(b, "POST", "/api/timeattack/circuit", { cell: CELL, seed: t.make.seed, name: "  <b>x</b>\n", geom: square() }));
    expect([made.kept, made.circuit.name]).toEqual([true, "bx/b"]);
    t = await ta(a);
    expect([t.circuit.segment_id, t.make]).toEqual([made.circuit.segment_id, null]);
    const nohandle = await makeUser("zed");
    await env.DB.prepare("UPDATE users SET handle = NULL WHERE id = ?").bind(nohandle.id).run();
    expect((await api(nohandle, "POST", "/api/timeattack/enter", { cell: CELL })).status).toBe(409);
  });

  it("a loop can be reported; taken down, its times go and the area builds another from the next seed", async () => {
    const [a, b, mod] = [await makeUser("alice"), await makeUser("bob"), await makeUser("owner")];
    const made = await build(a, { name: "Rude name" });
    const id = made.circuit.segment_id;
    const e = await json(api(b, "POST", "/api/timeattack/enter", { cell: CELL }));
    await ok(api(b, "POST", "/api/timeattack/runs", { runs: [{ segment_id: e.segment_id, time_s: 600, driven_on: await today() }] }));
    expect((await api(b, "POST", "/api/reports", { kind: "circuit", target: "ta-nope", reason: "abuse" })).status).toBe(404);
    await ok(api(b, "POST", "/api/reports", { kind: "circuit", target: id, reason: "abuse" }));
    const q = (await (await ok(api(mod, "GET", "/api/moderation"))).json()) as Msg[];
    expect(q.map((r) => [r.kind, r.label])).toEqual([["circuit", `time attack loop "Rude name" · area ${CELL}`]]);
    await ok(api(mod, "POST", "/api/moderation/resolve", { kind: "circuit", target: id, action: "remove" }));
    let t = await ta(b);
    expect([t.circuit, t.board, t.make.seed]).toEqual([null, [], seedOf(await monday(), CELL, 1)]);
    expect(await json(api(b, "GET", "/api/timeattack/circuits"))).toMatchObject({ circuits: [] });
    const again = await build(b, { name: "Dry Ridge Road loop" });
    expect([again.kept, again.circuit.segment_id === id]).toEqual([true, false]);
    t = await ta(a);
    expect([t.circuit.name, t.entered, t.board]).toEqual(["Dry Ridge Road loop", false, []]);
  });
});
