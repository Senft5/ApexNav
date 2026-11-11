import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { BUMP, bumpWeight } from "../src/contribute";
import { VERIFY, verifiedBumps } from "../src/roads";
import { api, freshDb, makeUser, ok, type TestUser } from "./helpers";

beforeEach(freshDb);

const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
const today = daysAgo(0);
// a primary road: shown from its first pass (roads.ts open-road rule), so only the bump rule decides
const SHAPE: [number, number][] = [[45, -122], [45.0015, -122]];
let seq = 0;
/** One pass over bins 0..29 of way 777; `hit` bins felt a spike; `bp: null` (an older build) everywhere when hit is null. */
async function pass(u: TestUser, hit: number[] | null, day = daysAgo(1)) {
  const bins = Array.from({ length: 30 }, (_, i) => ({ i, cam: 1, rough: 0.1, crest: null, k: 0, bp: hit === null ? null : hit.includes(i) ? 1 : 0 }));
  return api(u, "POST", "/api/contribute", { way_id: 777, dir: 0, driven_on: day, drive_id: `drive-bump-${String(++seq).padStart(4, "0")}`, bins, shape: SHAPE, cls: "primary" });
}
const bumps = async (u: TestUser) => {
  const j = await (await ok(api(u, "GET", "/api/roads?ways=777"))).json() as Record<string, Record<string, { bp?: [number, number][] }>>;
  return j["777"]?.["0"]?.bp ?? [];
};
const row = (i: number) => env.DB.prepare("SELECT bump_hit, bump_pass, bump_drivers FROM road_bins WHERE way_id = 777 AND dir = 0 AND bin_idx = ?").bind(i)
  .first<{ bump_hit: number; bump_pass: number; bump_drivers: number }>();

describe("crowd-verified bumps (IDEAS Q-02)", () => {
  let a: TestUser, b: TestUser, c: TestUser;
  beforeEach(async () => {
    a = await makeUser("a"); b = await makeUser("b"); c = await makeUser("c");
    for (const u of [a, b, c]) await env.DB.prepare("UPDATE members SET contribute = 1 WHERE user_id = ?").bind(u.id).run();
  });

  it("one person's hits, however many, are not verified; a second person's are", async () => {
    await ok(pass(a, [10])); await ok(pass(a, [11])); await ok(pass(a, [10]));
    expect(await bumps(a)).toEqual([]);
    expect((await row(10))!.bump_drivers + (await row(11))!.bump_drivers).toBe(1);   // the same person 5 m off is one driver
    await ok(pass(b, [11]));
    const bp = await bumps(b);
    expect(bp.length).toBe(1);
    expect(bp[0][0]).toBe(10);                                      // the bin with the most hits
    expect(bp[0][1]).toBeGreaterThan(VERIFY.minP);
  });

  it("clean passes outvote the hits, and an older build's unknown counts for nothing", async () => {
    await ok(pass(a, [10])); await ok(pass(b, [10]));
    expect((await bumps(a)).length).toBe(1);
    await ok(pass(c, null));
    expect((await row(10))!.bump_pass).toBeCloseTo(2 * bumpWeight(daysAgo(1)), 6);
    await ok(pass(c, [])); await ok(pass(a, []));
    expect(await bumps(a)).toEqual([]);                             // 2 of 4: maybe filled, not called
  });

  it("an old hit counts less: the same evidence a half-life ago is not enough against fresh clean passes", () => {
    const old = new Date(Date.now() - BUMP.halfLifeDays * 2 * 86400_000).toISOString().slice(0, 10);
    const w = bumpWeight(old), f = bumpWeight(daysAgo(1));
    const rows = [{ bin_idx: 5, bump_hit: 3 * w, bump_pass: 3 * w + f, bump_drivers: 2 }];
    expect(verifiedBumps(rows, today)).toEqual([]);                 // three old hits, one fresh clean pass
    rows[0] = { bin_idx: 5, bump_hit: 3 * f, bump_pass: 4 * f, bump_drivers: 2 };
    expect(verifiedBumps(rows, today)).toEqual([]);                 // 3 of 4 fresh: 0.70, under the bar
    rows[0] = { bin_idx: 5, bump_hit: 3 * f, bump_pass: 3 * f, bump_drivers: 2 };
    expect(verifiedBumps(rows, today)[0][0]).toBe(5);
  });

  it("refuses a bad flag", async () => {
    const bins = Array.from({ length: 30 }, (_, i) => ({ i, cam: 1, rough: 0.1, crest: null, k: 0, bp: 2 }));
    const r = await api(a, "POST", "/api/contribute", { way_id: 777, dir: 0, driven_on: daysAgo(1), drive_id: "drive-bump-bad1", bins });
    expect(r.status).toBe(400);
  });
});
