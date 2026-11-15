// Live ghost duels (src/social.ts ghosts, migration 0062): a friend's quickest run on your stage with its splits, only where
// their times reach you, on a road like yours (wet only with wet), a friend in an open duel first.
import { beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeSegment, makeUser, ok, type TestUser } from "./helpers";

beforeEach(freshDb);
type Msg = Record<string, any>;
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as Msg;
const grant = (u: TestUser, to: TestUser, times: boolean) => ok(api(u, "PUT", "/api/grants", { audience_type: "friend", audience_id: to.id, share_scores: true, share_times: times }));
const run = (u: TestUser, seg: string, time_s: number, day: string, extra: Msg = {}) =>
  ok(api(u, "POST", "/api/board", { segment_id: seg, driver_score: 700, time_s, driven_on: day, splits: [[0.25, time_s / 4], [0.5, time_s / 2], [0.75, time_s * 0.75], [1, time_s]], ...extra }));
const ghostsOf = async (u: TestUser, canon: string, surface = "") => (await json(api(u, "GET", `/api/board/ghosts?canons=${canon}${surface ? `&surface=${surface}` : ""}`))) as unknown as Msg[];

describe("ghosts", () => {
  it("a friend's quickest run with splits, only with their times shared, like with like", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob");
    await befriend(a, b);
    const bId = await makeSegment(b, "Dry Ridge climb"), canon = bId;
    await grant(b, a, false);
    await run(b, bId, 300, "2026-11-01");
    expect(await ghostsOf(a, canon)).toEqual([]);                                        // times not shared: no splits kept
    await grant(b, a, true);
    await run(b, bId, 280, "2026-11-02");
    await run(b, bId, 260, "2026-11-03", { surface: "wet" });
    await run(b, bId, 400, "2026-11-04", { splits: [[0.5, 1], [1, 500]] });                          // a split past its own time: the run, no splits
    let g = await ghostsOf(a, canon);
    expect(g.map((x) => [x.handle, x.time_s, x.splits, x.surface])).toEqual([["bob", 280, [[0.25, 70], [0.5, 140], [0.75, 210], [1, 280]], null]]);
    g = await ghostsOf(a, canon, "wet");
    expect(g.map((x) => [x.time_s, x.surface])).toEqual([[260, "wet"]]);
    expect(await ghostsOf(a, canon, "ice")).toEqual([]);
    expect(await ghostsOf(b, canon)).toEqual([]);                                        // your own runs are not your ghost
    await grant(b, a, false);                                                            // times off: the splits go with them
    expect(await ghostsOf(a, canon)).toEqual([]);
  });
});

describe("splitsOf", () => {
  it("keeps corner splits that rise to the finish, and nothing else", async () => {
    const { splitsOf } = await import("../src/social");
    expect(splitsOf([[0.3333, 20.04], [1, 60]], 60)).toEqual([[0.333, 20], [1, 60]]);
    expect(splitsOf([[0.5, 30]], 60)).toBeNull();                     // never reaches the finish
    expect(splitsOf([[0.5, 30], [0.4, 31], [1, 60]], 60)).toBeNull(); // goes back along the stage
    expect(splitsOf([[0.5, 30], [1, 29]], 60)).toBeNull();            // the clock goes back
    expect(splitsOf([[1, 90]], 60)).toBeNull();                       // past its own time
    expect(splitsOf([1, 2, 3], 60)).toBeNull();
    expect(splitsOf("x", 60)).toBeNull();
  });
});
