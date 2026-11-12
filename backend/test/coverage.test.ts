import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { shapeLength, validateShape } from "../src/contribute";
import * as contributorNs from "../../web/contributor.js";
import { api, freshDb, makeUser, ok } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = (globalThis as Any).ApexContributor ?? (contributorNs as Any).default ?? contributorNs;

beforeEach(freshDb);

const today = () => new Date().toISOString().slice(0, 10);
const bins = (n = 60) => Array.from({ length: n }, (_, j) => ({ i: j, cam: 1.5, rough: 0.05, crest: 0.1, k: 0.01 }));
// a 1 km road running north from 35.5, -83.5: 11 points 100 m apart
const line = Array.from({ length: 11 }, (_, k) => [35.5 + k * 100 / 110540, -83.5]);
const upload = (driveId: string, over: Record<string, unknown> = {}) => ({ way_id: 777, dir: 0, driven_on: today(), drive_id: driveId, bins: bins(), shape: line, cam_v: 2, ...over });
const optIn = async (...us: { id: string }[]) => { for (const u of us) await env.DB.prepare("UPDATE members SET contribute = 1 WHERE user_id = ?").bind(u.id).run(); };
const BOX = "/api/coverage?bbox=35.4,-83.6,35.6,-83.4";

describe("GET /api/coverage (IDEAS Q-14)", () => {
  it("shows a road that may be a lane once two people have driven it, as its map line with a confidence level, never a count", async () => {
    const a = await makeUser("a"), b = await makeUser("b");
    await optIn(a, b);
    await ok(api(a, "POST", "/api/contribute", upload("drive-aaaa-0001")));
    expect((await (await ok(api(a, "GET", BOX))).json() as { ways: unknown[] }).ways).toEqual([]);      // one driver: blank, like nobody
    await ok(api(b, "POST", "/api/contribute", upload("drive-bbbb-0001", { shape: [[0, 0], [0, 1]] })));   // a later, wrong shape doesn't replace it
    const j = await (await ok(api(a, "GET", BOX))).json() as { ways: { way: number; line: number[][]; conf: number[] }[] };
    expect(j.ways).toHaveLength(1);
    expect(j.ways[0]).toMatchObject({ way: 777, conf: [2, 0] });
    expect(j.ways[0]).not.toHaveProperty("passes");
    expect(j.ways[0].line[0]).toEqual([35.5, -83.5]);
    expect(JSON.stringify(j)).not.toMatch(/user|handle|holder|drive/i);
    expect((await (await ok(api(a, "GET", "/api/coverage?bbox=36,-83.6,36.2,-83.4"))).json() as { ways: unknown[] }).ways).toEqual([]);
  });

  it("shows an open road from its first pass, at the lowest confidence (owner decision 2026-10-28)", async () => {
    const a = await makeUser("a");
    await optIn(a);
    await ok(api(a, "POST", "/api/contribute", upload("drive-aaaa-0003", { cls: "tertiary" })));
    const j = await (await ok(api(a, "GET", BOX))).json() as { ways: { way: number; conf: number[] }[] };
    expect(j.ways).toEqual([expect.objectContaining({ way: 777, conf: [1, 0] })]);
  });

  it("a short unclassified road or an unknown class waits for a second driver", async () => {
    const a = await makeUser("a");
    await optIn(a);
    await ok(api(a, "POST", "/api/contribute", upload("drive-aaaa-0004", { cls: "unclassified" })));    // a 1 km line: could be a dead end
    expect((await (await ok(api(a, "GET", BOX))).json() as { ways: unknown[] }).ways).toEqual([]);
    await ok(api(a, "POST", "/api/contribute", upload("drive-aaaa-0005", { way_id: 778, cls: "motorway!" })));   // not a class: unknown
    expect((await (await ok(api(a, "GET", BOX))).json() as { ways: unknown[] }).ways).toEqual([]);
    const row = await env.DB.prepare("SELECT cls, len_m FROM road_ways WHERE way_id = 777").first<{ cls: string; len_m: number }>();
    expect(row?.cls).toBe("unclassified");
    expect(Math.abs((row?.len_m ?? 0) - 1000)).toBeLessThan(5);
  });

  it("a road's length is at least as far as the bins reach along it (its line is simplified, so a little short)", async () => {
    const a = await makeUser("a");
    await optIn(a);
    // a 1 km line, bins to 1.1 km (within validateShape's slack): the way is at least 1,100 m long
    const far = Array.from({ length: 60 }, (_, j) => ({ i: 160 + j, cam: 1.5, rough: 0.05, crest: 0.1, k: 0.01 }));
    await ok(api(a, "POST", "/api/contribute", upload("drive-aaaa-0006", { bins: far, cls: "unclassified" })));
    const row = await env.DB.prepare("SELECT len_m FROM road_ways WHERE way_id = 777").first<{ len_m: number }>();
    expect(row?.len_m).toBe(1100);
  });

  it("says what was measured per direction: mean roughness and banked / off-camber shares, null where unmeasured (IDEAS R-04)", async () => {
    const a = await makeUser("a"), b = await makeUser("b");
    await optIn(a, b);
    const mixed = bins().map((x, j) => ({ ...x, rough: 0.2, cam: j < 15 ? 4 : j < 30 ? -4 : 1 }));
    await ok(api(a, "POST", "/api/contribute", upload("drive-aaaa-0002", { bins: mixed })));
    await ok(api(b, "POST", "/api/contribute", upload("drive-bbbb-0002", { bins: mixed.map((x) => ({ ...x, rough: 0.4 })) })));
    const j = await (await ok(api(a, "GET", BOX))).json() as { ways: { rough: (number | null)[]; banked: (number | null)[]; offCamber: (number | null)[] }[] };
    expect(j.ways[0]).toMatchObject({ rough: [0.3, null], banked: [0.25, null], offCamber: [0.25, null] });
  });

  it("says the share of crests two passes measured and how many bumps the crowd verified, per direction (IDEAS R-04)", async () => {
    const a = await makeUser("a"), b = await makeUser("b");
    await optIn(a, b);
    const crested = (bp: boolean) => bins().map((x, j) => ({ ...x, crest: j < 20 ? 0.3 : 0.05, bp: bp && j === 10 ? 1 : 0 }));
    await ok(api(a, "POST", "/api/contribute", upload("drive-aaaa-0007", { bins: crested(true) })));
    let j = await (await ok(api(a, "GET", BOX))).json() as { ways: { crested: (number | null)[]; bumps: number[] }[] };
    expect(j.ways).toEqual([]);                                     // one driver on a lane: blank
    await ok(api(b, "POST", "/api/contribute", upload("drive-bbbb-0007", { bins: crested(true) })));
    j = await (await ok(api(a, "GET", BOX))).json() as { ways: { crested: (number | null)[]; bumps: number[] }[] };
    expect(j.ways[0]).toMatchObject({ crested: [0.333, null], bumps: [1, 0] });
  });

  it("one pass of crest data is no crest share, and a bump one person felt is not counted", async () => {
    const a = await makeUser("a");
    await optIn(a);
    const one = bins().map((x, j) => ({ ...x, crest: 0.3, bp: j === 10 ? 1 : 0 }));
    await ok(api(a, "POST", "/api/contribute", upload("drive-aaaa-0008", { bins: one, cls: "tertiary" })));
    const j = await (await ok(api(a, "GET", BOX))).json() as { ways: { crested: (number | null)[]; bumps: number[] }[] };
    expect(j.ways[0]).toMatchObject({ crested: [null, null], bumps: [0, 0] });
  });

  it("is for members, and the box must be small and real", async () => {
    expect((await api(null, "GET", BOX)).status).toBe(401);
    const a = await makeUser("a");
    for (const q of ["", "bbox=1,2,3", "bbox=35,-84,36,-83", "bbox=35.6,-83.6,35.4,-83.4", "bbox=a,b,c,d", "bbox=95,0,95.1,0.1"])
      expect((await api(a, "GET", `/api/coverage?${q}`)).status).toBe(400);
  });
});

describe("validateShape", () => {
  it("keeps a sane map line and drops anything else", () => {
    expect(validateShape(line, 59)).toHaveLength(11);
    expect(validateShape(line, 400)).toBeNull();                         // bins say the way is 2 km; the line is 1 km
    expect(validateShape([[35, -83]], 1)).toBeNull();
    expect(validateShape(Array(65).fill([35, -83]), 0)).toBeNull();
    expect(validateShape([[35, -83], [36, -83]], 1)).toBeNull();         // over 0.5° across
    expect(validateShape([[35, "x"], [35.001, -83]], 1)).toBeNull();
    expect(validateShape(undefined, 1)).toBeNull();
  });

  // A 10 km mountain road as OSM draws it: corners of 15-75 m radius and 30-180 degrees with a node every 5 m, straights
  // of up to 60 m with nodes only at their ends (deterministic). The phone sends at most 64 of its ~1,600 nodes.
  const twisty = (() => {
    let seed = 1, x = 0, y = 0, h = 0, total = 0, sign = 1;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, pts: [number, number][] = [[0, 0]];
    while (total < 10000) {
      const L = rnd() * 60; x += L * Math.cos(h); y += L * Math.sin(h); total += L; pts.push([x, y]);
      const R = 15 + rnd() * 60, A = (30 + rnd() * 150) * Math.PI / 180, step = 5 / R; sign = rnd() < 0.8 ? -sign : sign;
      for (let a = step; a <= A; a += step) { h += sign * step; x += 5 * Math.cos(h); y += 5 * Math.sin(h); total += 5; pts.push([x, y]); }
    }
    const mLon = 111320 * Math.cos(35.6 * Math.PI / 180);
    return pts.map(([px, py]) => [35.6 + py / 110540, -83.4 + px / mLon] as [number, number]);
  })();

  it("keeps a long twisty road the phone simplified (the bins reach its far end)", () => {
    const full = shapeLength(twisty), hiBin = Math.floor(full / 5) - 1;                  // driven end to end
    const sent = C.shapeOf(twisty) as [number, number][];
    expect(sent.length).toBeLessThanOrEqual(64);
    expect(sent[0]).toEqual([+twisty[0][0].toFixed(5), +twisty[0][1].toFixed(5)]);
    expect(validateShape(sent, hiBin)).toHaveLength(sent.length);
    expect(shapeLength(sent) / full).toBeGreaterThan(0.88);
    // what the phone used to send (64 nodes picked by index) cut the corners and was dropped
    const byIndex = Array.from({ length: 64 }, (_, k) => twisty[Math.round(k * (twisty.length - 1) / 63)]);
    expect(validateShape(byIndex, hiBin)).toBeNull();
  });
});
