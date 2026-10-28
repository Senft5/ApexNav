import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeUser } from "./helpers";

beforeEach(freshDb);

const seed = () => env.DB.batch([
  env.DB.prepare("INSERT INTO road_bins (way_id, dir, bin_idx, n, camber_mean, camber_m2, camber_n, rough_mean, rough_m2, crest_peak) VALUES (9, 0, 4, 2, 3.5, 0.5, 2, 0.1, 0.0002, 0.3)"),
  env.DB.prepare("INSERT INTO road_bins (way_id, dir, bin_idx, n, camber_mean, camber_m2, camber_n, rough_mean, rough_m2, crest_peak) VALUES (9, 0, 5, 1, NULL, NULL, 0, 0.2, 0, 0.1)"),
  env.DB.prepare("INSERT INTO road_bins (way_id, dir, bin_idx, n, camber_mean, camber_m2, camber_n, rough_mean, rough_m2, crest_peak) VALUES (9, 1, 4, 1, -2, 0, 1, 0.3, 0, 0.2)"),
  // two different drivers on way 9 both ways (IDEAS Z-08)
  ...[0, 1].flatMap((dir) => [1, 2].map((slot) => env.DB.prepare("INSERT INTO rank_slots (way_id, dir, slot, user_id, driven_on, holder) VALUES (9, ?, ?, NULL, '2026-10-01', ?)")
    .bind(dir, slot, new Uint8Array([dir, slot]).buffer))),
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

  it("hides a road direction only one person has driven (IDEAS Z-08)", async () => {
    await seed();
    await env.DB.prepare("DELETE FROM rank_slots WHERE dir = 1 AND slot = 2").run();
    await env.DB.prepare("INSERT INTO road_bins (way_id, dir, bin_idx, n, camber_mean, camber_m2, camber_n, rough_mean, rough_m2, crest_peak) VALUES (11, 0, 1, 5, 1, 0, 5, 0.1, 0, 0.1)").run();
    const j = await (await api(await makeUser("alice"), "GET", "/api/roads?ways=9,11")).json() as Record<string, Record<string, unknown>>;
    expect(Object.keys(j)).toEqual(["9"]);                      // way 11: five passes, nobody counted as a second driver
    expect(Object.keys(j["9"])).toEqual(["0"]);                 // way 9 the other way: one driver
  });

  it("shows an open road from one driver; a short unclassified road or an unknown class keeps the two-driver rule", async () => {
    const shape = JSON.stringify([[35.5, -83.5], [35.51, -83.5]]);
    const way = (id: number, cls: string | null, len: number | null) => env.DB.prepare("INSERT INTO road_ways (way_id, s, w, n, e, shape, cls, len_m) VALUES (?, 35.5, -83.5, 35.51, -83.5, ?, ?, ?)").bind(id, shape, cls, len).run();
    const bin = (id: number) => env.DB.prepare("INSERT INTO road_bins (way_id, dir, bin_idx, n, camber_mean, camber_m2, camber_n, rough_mean, rough_m2, crest_peak) VALUES (?, 0, 1, 1, 1, 0, 1, 0.1, 0, 0.1)").bind(id).run();
    for (const [id, cls, len] of [[21, "tertiary", 300], [22, "unclassified", 2000], [23, "unclassified", 600], [24, null, 5000], [25, "residential", 5000]] as const) { await way(id, cls, len); await bin(id); }
    const j = await (await api(await makeUser("alice"), "GET", "/api/roads?ways=21,22,23,24,25")).json() as Record<string, unknown>;
    expect(Object.keys(j).sort()).toEqual(["21", "22"]);
  });

  it("the owner's GeoJSON export: open-road rule, confidence not counts, nothing about people", async () => {
    await seed();
    await env.DB.prepare("INSERT INTO road_ways (way_id, s, w, n, e, shape, cls, len_m) VALUES (9, 35.5, -83.5, 35.51, -83.49, ?, 'secondary', 1500)")
      .bind(JSON.stringify([[35.5, -83.5], [35.51, -83.49]])).run();
    await env.DB.prepare("UPDATE road_bins SET last_on = '2026-10-12' WHERE way_id = 9").run();
    const owner = await makeUser("owner"), someone = await makeUser("someone");
    const url = "/api/ops/roads.geojson?bbox=35.4,-83.6,35.6,-83.4";
    expect((await api(someone, "GET", url)).status).toBe(404);
    expect((await api(owner, "GET", "/api/ops/roads.geojson?bbox=1,2,3")).status).toBe(400);
    const g = await (await api(owner, "GET", url)).json() as { type: string; method_version: string; features: { geometry: { coordinates: number[][] }; properties: Record<string, unknown> }[] };
    expect(g.type).toBe("FeatureCollection");
    expect(g.features).toHaveLength(2);
    const [fwd, back] = g.features;
    expect(fwd.properties).toEqual({ way: 9, dir: 0, cls: "secondary", confidence: 0.667, rough_g: 0.133, banked: 1, off_camber: 0, last_month: "2026-10", method_version: g.method_version });
    expect(fwd.geometry.coordinates[0]).toEqual([-83.5, 35.5]);
    expect(back.geometry.coordinates[0]).toEqual([-83.49, 35.51]);               // the other direction, drawn the way it was driven
    expect(JSON.stringify(g)).not.toMatch(/user|handle|holder|drive|email|"n"|passes|2026-10-12/i);
  });

  it("one person can't hold both slots, so can't meet the two-driver rule alone", async () => {
    await env.DB.prepare("INSERT INTO rank_slots (way_id, dir, slot, user_id, driven_on, holder) VALUES (12, 0, 1, NULL, '2026-10-01', X'01')").run();
    await expect(env.DB.prepare("INSERT INTO rank_slots (way_id, dir, slot, user_id, driven_on, holder) VALUES (12, 0, 2, NULL, '2026-10-01', X'01')").run()).rejects.toThrow();
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
