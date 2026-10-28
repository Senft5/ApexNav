import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { validateShape } from "../src/contribute";
import { api, freshDb, makeUser, ok } from "./helpers";

beforeEach(freshDb);

const today = () => new Date().toISOString().slice(0, 10);
const bins = (n = 60) => Array.from({ length: n }, (_, j) => ({ i: j, cam: 1.5, rough: 0.05, crest: 0.1, k: 0.01 }));
// a 1 km road running north from 35.5, -83.5: 11 points 100 m apart
const line = Array.from({ length: 11 }, (_, k) => [35.5 + k * 100 / 110540, -83.5]);
const upload = (driveId: string, over: Record<string, unknown> = {}) => ({ way_id: 777, dir: 0, driven_on: today(), drive_id: driveId, bins: bins(), shape: line, ...over });
const optIn = async (...us: { id: string }[]) => { for (const u of us) await env.DB.prepare("UPDATE members SET contribute = 1 WHERE user_id = ?").bind(u.id).run(); };
const BOX = "/api/coverage?bbox=35.4,-83.6,35.6,-83.4";

describe("GET /api/coverage (IDEAS Q-14)", () => {
  it("shows a road once two people have driven it, as its map line with passes per direction", async () => {
    const a = await makeUser("a"), b = await makeUser("b");
    await optIn(a, b);
    await ok(api(a, "POST", "/api/contribute", upload("drive-aaaa-0001")));
    expect((await (await ok(api(a, "GET", BOX))).json() as { ways: unknown[] }).ways).toEqual([]);      // one driver: blank, like nobody
    await ok(api(b, "POST", "/api/contribute", upload("drive-bbbb-0001", { shape: [[0, 0], [0, 1]] })));   // a later, wrong shape doesn't replace it
    const j = await (await ok(api(a, "GET", BOX))).json() as { ways: { way: number; line: number[][]; passes: number[] }[] };
    expect(j.ways).toHaveLength(1);
    expect(j.ways[0]).toMatchObject({ way: 777, passes: [2, 0] });
    expect(j.ways[0].line[0]).toEqual([35.5, -83.5]);
    expect(JSON.stringify(j)).not.toMatch(/user|handle|holder|drive/i);
    expect((await (await ok(api(a, "GET", "/api/coverage?bbox=36,-83.6,36.2,-83.4"))).json() as { ways: unknown[] }).ways).toEqual([]);
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
});
