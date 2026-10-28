import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeUser } from "./helpers";

beforeEach(freshDb);

const seed = () => env.DB.batch([
  env.DB.prepare("INSERT INTO road_bins (way_id, dir, bin_idx, n, camber_mean, camber_m2, camber_n, rough_mean, rough_m2, crest_peak) VALUES (9, 0, 4, 2, 3.5, 0.5, 2, 0.1, 0.0002, 0.3)"),
  env.DB.prepare("INSERT INTO road_bins (way_id, dir, bin_idx, n, camber_mean, camber_m2, camber_n, rough_mean, rough_m2, crest_peak) VALUES (9, 0, 5, 1, NULL, NULL, 0, 0.2, 0, 0.1)"),
  env.DB.prepare("INSERT INTO road_bins (way_id, dir, bin_idx, n, camber_mean, camber_m2, camber_n, rough_mean, rough_m2, crest_peak) VALUES (9, 1, 4, 1, -2, 0, 1, 0.3, 0, 0.2)"),
]);

describe("GET /api/roads", () => {
  it("members only", async () => {
    await seed();
    expect((await api(null, "GET", "/api/roads?ways=9")).status).toBe(401);
    expect((await api(await makeUser("outsider", false), "GET", "/api/roads?ways=9")).status).toBe(403);
  });

  it("returns merged numbers per way and direction, null where unmeasured, and no contributor information", async () => {
    await seed();
    const r = await api(await makeUser("alice"), "GET", "/api/roads?ways=9,10");
    expect(r.status).toBe(200);
    const j = await r.json() as Record<string, Record<string, { i: number[]; n: number[]; cam: (number | null)[]; rough: number[]; cn: number[]; csd: (number | null)[]; rsd: (number | null)[] }>>;
    expect(Object.keys(j)).toEqual(["9"]);
    expect(j["9"]["0"]).toMatchObject({ i: [4, 5], n: [2, 1], cam: [3.5, null], rough: [0.1, 0.2] });
    expect(j["9"]["1"].cam).toEqual([-2]);
    // spread between passes: sample SD from the Welford sum of squares, null under two measuring passes
    expect(j["9"]["0"]).toMatchObject({ cn: [2, 0], csd: [0.7071, null], rsd: [0.0141, null] });
    expect(j["9"]["1"]).toMatchObject({ cn: [1], csd: [null], rsd: [null] });
    expect(JSON.stringify(j)).not.toMatch(/user|handle|email/i);
  });

  it.each(["", "ways=", "ways=abc", "ways=-1", "ways=1.5", `ways=${Array.from({ length: 51 }, (_, i) => i + 1).join(",")}`])("rejects bad query %s", async (q) => {
    expect((await api(await makeUser("alice"), "GET", `/api/roads?${q}`)).status).toBe(400);
  });
});

describe("sampleSd", () => {
  it("is the sample standard deviation and unknown under two passes", async () => {
    const { sampleSd } = await import("../src/roads");
    expect(sampleSd(8, 3)).toBe(2);
    expect(sampleSd(-1e-12, 2)).toBe(0);
    expect(sampleSd(1, 1)).toBeNull();
    expect(sampleSd(null, 4)).toBeNull();
  });
});
