import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { correlation, isReplay, isoWeek, mergeStat, nightlyMerge } from "../src/nightly";
import { api, freshDb, makeUser, ok } from "./helpers";

beforeEach(freshDb);

const DAY = 86400_000, NOW = Date.UTC(2026, 9, 25, 7, 0, 0);          // Sunday 2026-10-25 (ISO week 43)
const day = (offset: number) => new Date(NOW - offset * DAY).toISOString().slice(0, 10);
const packed = (n = 60, f: (j: number) => { cam?: number | null; rough?: number; crest?: number; k?: number } = () => ({})) => JSON.stringify({
  i: Array.from({ length: n }, (_, j) => j),
  cam: Array.from({ length: n }, (_, j) => (f(j).cam === undefined ? 2 : f(j).cam)),
  rough: Array.from({ length: n }, (_, j) => f(j).rough ?? 0.05),
  crest: Array.from({ length: n }, (_, j) => f(j).crest ?? 0.1),
  k: Array.from({ length: n }, (_, j) => f(j).k ?? 0.01 * Math.sin(j / 5)),
});
async function stage(userId: string, drivenOn: string, receivedAt: string, bins = packed(), way = 5001, dir = 0) {
  await env.DB.prepare("INSERT INTO ingest_pending (user_id, way_id, dir, driven_on, km, bins, received_at) VALUES (?, ?, ?, ?, 0.3, ?, ?)").bind(userId, way, dir, drivenOn, bins, receivedAt).run();
}
const ledger = async (u: string) => (await env.DB.prepare("SELECT COALESCE(SUM(octane), 0) AS s FROM points_ledger WHERE user_id = ?").bind(u).first<{ s: number }>())!.s;
const count = async (t: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n;

describe("helpers", () => {
  it("isoWeek, correlation, replay detection and the running mean/variance", () => {
    expect(isoWeek(NOW)).toBe("2026-W43");
    expect(isoWeek(Date.UTC(2027, 0, 1))).toBe("2026-W53");
    expect(correlation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
    const a = JSON.parse(packed()), b = JSON.parse(packed()), c = JSON.parse(packed(60, (j) => ({ k: 0.02 * Math.cos(j / 3) })));
    expect(isReplay(a, b)).toBe(true);
    expect(isReplay(a, c)).toBe(false);
    let s = mergeStat(0, null, null, 2); s = mergeStat(s.n, s.mean, s.m2, 4);
    expect(s).toMatchObject({ n: 2, mean: 3 }); expect(s.m2).toBeCloseTo(2);
  });
});

describe("nightlyMerge", () => {
  it("holds a road until 14 days after the earliest drive, then ranks by drive date and pays 3x / 2x / 1x", async () => {
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("carol")];
    await stage(a.id, day(13), "2026-10-13 10:00:00", packed(60, (j) => ({ k: 0.01 * Math.sin(j / 5) })));
    await stage(b.id, day(12), "2026-10-14 10:00:00", packed(60, (j) => ({ k: 0.02 * Math.cos(j / 3) })));
    await stage(c.id, day(11), "2026-10-15 10:00:00", packed(60, (j) => ({ k: 0.015 * Math.sin(j / 7 + 1) })));
    expect(await nightlyMerge(env, NOW)).toMatchObject({ frozen: 0 });                    // earliest drive was 13 days ago: still inside the window
    expect(await count("ingest_pending")).toBe(3);
    expect(await count("road_bins")).toBe(0);
    const r = await nightlyMerge(env, NOW + 2 * DAY);                                   // 15 days after the first drive
    expect(r).toMatchObject({ frozen: 1, quarantined: 0 });
    expect(await ledger(a.id)).toBeCloseTo(0.9);                                        // 0.3 km x 3
    expect(await ledger(b.id)).toBeCloseTo(0.6);                                        // x 2
    expect(await ledger(c.id)).toBeCloseTo(0.3);                                        // x 1
    expect(await count("ingest_pending")).toBe(0);
    expect(await count("road_bins")).toBe(60);
    const slots = (await env.DB.prepare("SELECT slot, user_id, driven_on FROM rank_slots ORDER BY slot").all<{ slot: number; user_id: string | null; driven_on: string }>()).results;
    expect(slots).toHaveLength(2);
    expect(slots.every((s) => s.user_id === null)).toBe(true);                         // who held a slot is not kept
  });

  it("a phone that was offline still takes first place if it drove first", async () => {
    const [early, later] = [await makeUser("early"), await makeUser("later")];
    await stage(later.id, day(10), "2026-10-15 09:00:00", packed(60, (j) => ({ k: 0.02 * Math.cos(j / 3) })));
    await stage(early.id, day(14), "2026-10-25 06:00:00", packed(60, (j) => ({ k: 0.01 * Math.sin(j / 5) })));   // uploaded last, drove first
    await nightlyMerge(env, NOW + DAY);
    expect(await ledger(early.id)).toBeCloseTo(0.9);
    expect(await ledger(later.id)).toBeCloseTo(0.6);
  });

  it("two drives on the same day are ordered by upload time", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await stage(b.id, day(14), "2026-10-12 12:00:00", packed(60, (j) => ({ k: 0.02 * Math.cos(j / 3) })));
    await stage(a.id, day(14), "2026-10-12 08:00:00", packed(60, (j) => ({ k: 0.01 * Math.sin(j / 5) })));
    await nightlyMerge(env, NOW + DAY);
    expect(await ledger(a.id)).toBeGreaterThan(await ledger(b.id));
  });

  it("a contribution after the road is frozen is worth 1x and changes nobody else's points", async () => {
    const [a, b, late] = [await makeUser("alice"), await makeUser("bob"), await makeUser("late")];
    await stage(a.id, day(15), "2026-10-11 10:00:00"); await nightlyMerge(env, NOW);
    const before = await ledger(a.id);
    await stage(late.id, day(1), "2026-10-24 10:00:00", packed(60, (j) => ({ k: 0.02 * Math.cos(j / 3) })));
    await stage(b.id, day(2), "2026-10-23 10:00:00", packed(60, (j) => ({ k: 0.015 * Math.sin(j / 7 + 1) })));
    expect(await nightlyMerge(env, NOW + DAY)).toMatchObject({ frozen: 0, late: 2 });
    expect(await ledger(a.id)).toBe(before);
    expect(await ledger(late.id)).toBeCloseTo(0.3);
    expect(await ledger(b.id)).toBeCloseTo(0.3);
    expect(await count("rank_slots")).toBe(1);                                          // slots were not reassigned
  });

  it("merges bins with a running mean and variance, and keeps going after a null camber", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await stage(a.id, day(14), "2026-10-12 08:00:00", packed(60, (j) => ({ cam: 2, rough: 0.04, k: 0.01 * Math.sin(j / 5) })));
    await stage(b.id, day(13), "2026-10-13 08:00:00", packed(60, (j) => ({ cam: j === 0 ? null : 4, rough: 0.08, k: 0.02 * Math.cos(j / 3) })));
    await nightlyMerge(env, NOW + DAY);
    const bin0 = await env.DB.prepare("SELECT * FROM road_bins WHERE bin_idx = 0").first<Record<string, number>>();
    expect(bin0).toMatchObject({ n: 2, camber_n: 1, camber_mean: 2 });                  // second pass had no camber for bin 0
    expect(bin0!.rough_mean).toBeCloseTo(0.06);
    const bin1 = await env.DB.prepare("SELECT * FROM road_bins WHERE bin_idx = 1").first<Record<string, number>>();
    expect(bin1).toMatchObject({ n: 2, camber_n: 2, camber_mean: 3 });
    expect(bin1!.camber_m2).toBeCloseTo(2);
  });

  it("a replayed drive from another account is discarded: no merge, no points", async () => {
    const [a, copy] = [await makeUser("alice"), await makeUser("copycat")];
    await stage(a.id, day(14), "2026-10-12 08:00:00");
    await stage(copy.id, day(13), "2026-10-13 08:00:00");                                // identical curvature
    expect(await nightlyMerge(env, NOW + DAY)).toMatchObject({ quarantined: 1 });
    expect(await ledger(copy.id)).toBe(0);
    expect((await env.DB.prepare("SELECT n FROM road_bins WHERE bin_idx = 0").first<{ n: number }>())!.n).toBe(1);
  });

  it("is idempotent: running again changes nothing", async () => {
    const a = await makeUser("alice");
    await stage(a.id, day(14), "2026-10-12 08:00:00");
    await nightlyMerge(env, NOW + DAY);
    const before = await ledger(a.id);
    await nightlyMerge(env, NOW + 2 * DAY);
    expect(await ledger(a.id)).toBe(before);
    expect(await count("road_bins")).toBe(60);
  });
});

describe("GET /api/points", () => {
  it("returns my weekly totals and a board of handle + total only", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await stage(a.id, day(14), "2026-10-12 08:00:00", packed(60, (j) => ({ k: 0.01 * Math.sin(j / 5) })));
    await stage(b.id, day(13), "2026-10-13 08:00:00", packed(60, (j) => ({ k: 0.02 * Math.cos(j / 3) })));
    await nightlyMerge(env, NOW + DAY);
    const mine = (await (await ok(api(b, "GET", "/api/points"))).json()) as { total: number; weeks: unknown[]; board: { handle: string; total: number }[] };
    expect(mine.total).toBeCloseTo(0.6);
    expect(mine.board.map((r) => r.handle)).toEqual(["alice", "bob"]);
    const raw = JSON.stringify(mine);
    expect(raw).not.toContain("slot"); expect(raw).not.toContain("driven_on"); expect(raw).not.toContain(a.id);
    expect((await api(null, "GET", "/api/points")).status).toBe(401);
  });
});
