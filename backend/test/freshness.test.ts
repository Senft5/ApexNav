import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { FRESH } from "../src/contribute";
import { api, freshDb, makeUser, ok, type TestUser } from "./helpers";

beforeEach(freshDb);

const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
const bins = (rough: number) => Array.from({ length: 30 }, (_, j) => ({ i: j, cam: 2, rough, crest: null, k: 0.01 }));
let seq = 0;
async function pass(u: TestUser, rough: number, day = daysAgo(1)) {
  await ok(api(u, "POST", "/api/contribute", { way_id: 4242, dir: 0, driven_on: day, drive_id: `drive-fresh-${String(++seq).padStart(4, "0")}`, bins: bins(rough) }));
}
const bin0 = () => env.DB.prepare("SELECT n, rough_mean, rough_m2, changed_on, smooth_run, last_on FROM road_bins WHERE way_id = 4242 AND dir = 0 AND bin_idx = 0")
  .first<{ n: number; rough_mean: number; rough_m2: number; changed_on: string | null; smooth_run: number; last_on: string }>();

describe("road freshness (IDEAS Q-12)", () => {
  let a: TestUser, b: TestUser;
  beforeEach(async () => {
    a = await makeUser("a"); b = await makeUser("b");
    for (const u of [a, b]) await env.DB.prepare("UPDATE members SET contribute = 1 WHERE user_id = ?").bind(u.id).run();
  });

  it("is the plain mean under the memory, and leans on recent passes past it", async () => {
    for (const r of [0.4, 0.42, 0.38]) await pass(a, r);
    expect((await bin0())!.rough_mean).toBeCloseTo(0.4, 6);
    for (let k = 0; k < FRESH.memory; k++) await pass(a, 0.4);
    for (let k = 0; k < 10; k++) await pass(b, 0.6);                // the road wore: ten rougher passes after 23 at 0.4
    const r = (await bin0())!;
    expect(r.n).toBe(33);
    expect(r.rough_mean).toBeCloseTo(0.4 + 0.2 * (1 - (20 / 21) ** 10), 4);   // 0.477; a plain mean of 33 would say 0.46
    expect(r.rough_m2 / (r.n - 1)).toBeGreaterThan(0);              // the spread is still a variance
  });

  it("two much smoother passes in a row: repaved, the bin starts again and says when", async () => {
    for (const r of [0.5, 0.52, 0.48, 0.5]) await pass(a, r, daysAgo(5));
    await pass(b, 0.1, daysAgo(3));
    let r = (await bin0())!;
    expect([r.smooth_run, r.changed_on]).toEqual([1, null]);       // one smooth pass could be a different phone: wait
    await pass(a, 0.5, daysAgo(2));
    expect((await bin0())!.smooth_run).toBe(0);                     // the next one wasn't: back to normal
    await pass(b, 0.1, daysAgo(2)); await pass(a, 0.09, daysAgo(1));
    r = (await bin0())!;
    expect(r.n).toBe(1);
    expect(r.rough_mean).toBeCloseTo(0.09, 6);
    expect(r.changed_on).toBe(daysAgo(1));
    expect(r.last_on).toBe(daysAgo(1));
    const j = await (await ok(api(a, "GET", "/api/roads?ways=4242"))).json() as Record<string, Record<string, { ch: (string | null)[]; n: number[] }>>;
    expect(j["4242"]["0"].ch[0]).toBe(daysAgo(1).slice(0, 7));     // the month, never the day
  });

  it("a rough pass on a smooth road is just a pass", async () => {
    for (const r of [0.1, 0.1, 0.12, 0.6, 0.6]) await pass(a, r);
    expect((await bin0())!).toMatchObject({ n: 5, changed_on: null, smooth_run: 0 });
  });
});
