// Route context (docs/ROUTING.md "Route context", migration 0045): flow confidence, loved roads, busy times behind the
// quiet_hours flag, the car's fuel and range, and fair crew meeting points. Each test is also a privacy rule.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CAM_V, validateContribution } from "../src/contribute";
import { cellOf } from "../src/crew_meet";
import { chargers, parseNrel } from "../src/chargers";
import { loveLevel } from "../src/roads";
import { api, freshDb, makeUser, ok } from "./helpers";

beforeEach(freshDb);
afterEach(() => { delete (env as { FLAGS?: string }).FLAGS; });

const today = () => new Date().toISOString().slice(0, 10);
const optIn = async (...us: { id: string }[]) => { for (const u of us) await env.DB.prepare("UPDATE members SET contribute = 1 WHERE user_id = ?").bind(u.id).run(); };
const bins = (fl: number | null, hb: 0 | 1 | null, n = 30) => Array.from({ length: n }, (_, j) => ({ i: j, cam: 1, rough: 0.05, crest: 0.1, k: 0.01, fl, hb }));
const upload = (drive: string, over: Record<string, unknown> = {}) => ({ way_id: 777, dir: 0, driven_on: today(), drive_id: drive, bins: bins(0.9, 0), cam_v: CAM_V, cls: "tertiary",
  shape: [[35.5, -83.5], [35.5015, -83.5]], ...over });
type Dir = { fl: (number | null)[]; hb: (number | null)[]; fn: number[]; ag?: number; hr?: number[] };
const roads = async (u: Awaited<ReturnType<typeof makeUser>>) => (await (await ok(api(u, "GET", "/api/roads?ways=777"))).json()) as Record<string, Record<string, Dir>>;

describe("flow confidence per bin", () => {
  it("validates fl (0..1) and hb (0/1), and an older build without them is unknown", () => {
    const base = { way_id: 1, dir: 0, driven_on: today(), drive_id: "drive-aaaa-0001", cam_v: CAM_V };
    const c = validateContribution({ ...base, bins: bins(0.12345, 1) });
    expect(c.bins[0]).toMatchObject({ fl: 0.123, hb: 1 });
    expect(validateContribution({ ...base, bins: bins(null, null) }).bins[0]).toMatchObject({ fl: null, hb: null });
    const old = Array.from({ length: 30 }, (_, j) => ({ i: j, cam: 1, rough: 0.05, crest: 0.1, k: 0.01 }));
    expect(validateContribution({ ...base, bins: old }).bins[0]).toMatchObject({ fl: null, hb: null });
    expect(() => validateContribution({ ...base, bins: bins(1.5, 0) })).toThrow("bad_flow");
    expect(() => validateContribution({ ...base, bins: bins(0.5, 2 as 1) })).toThrow("bad_brake");
    expect(() => validateContribution({ ...base, bins: bins(0.5, 0), hr: 12 })).toThrow("bad_hour_bucket");
  });

  it("merges flow and hard brakes as running means and sends them with no speed and no person", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")]; await optIn(a, b);
    await ok(api(a, "POST", "/api/contribute", upload("drive-aaaa-0001", { bins: bins(1, 0) })));
    await ok(api(b, "POST", "/api/contribute", upload("drive-bbbb-0001", { bins: bins(0.5, 1) })));
    const d = (await roads(a))["777"]["0"];
    expect(d.fl[0]).toBe(0.75); expect(d.hb[0]).toBe(0.5); expect(d.fn[0]).toBe(2);
    expect(JSON.stringify(d)).not.toMatch(/speed|user|handle/i);
  });

  it("a pass with no flow leaves flow alone", async () => {
    const a = await makeUser("alice"); await optIn(a);
    await ok(api(a, "POST", "/api/contribute", upload("drive-aaaa-0001", { bins: bins(null, null) })));
    const d = (await roads(a))["777"]["0"];           // a tertiary road shows from one pass (open roads)
    expect(d.fl[0]).toBeNull(); expect(d.fn[0]).toBe(0);
  });
});

describe("loved roads: members coming back to a road", () => {
  it("counts a person once, only on a second, different recorded drive, and shows a level from two people", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")]; await optIn(a, b);
    expect(loveLevel(1)).toBe(0); expect(loveLevel(2)).toBe(1); expect(loveLevel(4)).toBe(2); expect(loveLevel(9)).toBe(3);
    await ok(api(a, "POST", "/api/contribute", upload("drive-aaaa-0001", { rec: 1 })));
    await ok(api(a, "POST", "/api/contribute", upload("drive-aaaa-0002", { rec: 0 })));            // ambient sharing: not a choice to come back
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM road_love").first<{ n: number }>())!.n).toBe(0);
    await ok(api(a, "POST", "/api/contribute", upload("drive-aaaa-0003", { rec: 1 })));
    await ok(api(a, "POST", "/api/contribute", upload("drive-aaaa-0004", { rec: 1 })));            // the same person again: still one
    expect((await env.DB.prepare("SELECT again_n FROM road_love WHERE way_id = 777").first<{ again_n: number }>())!.again_n).toBe(1);
    expect((await roads(a))["777"]["0"].ag).toBeUndefined();                                       // one person is never shown
    await ok(api(b, "POST", "/api/contribute", upload("drive-bbbb-0001", { rec: 1 })));
    await ok(api(b, "POST", "/api/contribute", upload("drive-bbbb-0002", { rec: 1 })));
    expect((await roads(a))["777"]["0"].ag).toBe(1);
  });
});

describe("busy times (Quiet hours, the owner's open decision): off by default", () => {
  const five = async () => { const us = []; for (const h of ["a1", "a2", "a3", "a4", "a5"]) us.push(await makeUser(h)); await optIn(...us); return us; };

  it("with the flag off (the default) no hour is stored or shown, and the flag reads off", async () => {
    const us = await five();
    for (const [k, u] of us.entries()) await ok(api(u, "POST", "/api/contribute", upload(`drive-hour-000${k}`, { hr: 3 })));
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM road_hours").first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM road_hour_holders").first<{ n: number }>())!.n).toBe(0);
    expect((await roads(us[0]))["777"]["0"].hr).toBeUndefined();
    expect(((await (await api(null, "GET", "/api/flags")).json()) as { flags: Record<string, boolean> }).flags.quiet_hours).toBe(false);
  });

  it("with the flag on: one count per drive, shown as shares only once five people drove it", async () => {
    (env as { FLAGS?: string }).FLAGS = JSON.stringify({ quiet_hours: { on: true } });
    const us = await five();
    for (const [k, u] of us.slice(0, 4).entries()) {
      await ok(api(u, "POST", "/api/contribute", upload(`drive-hour-000${k}`, { hr: 3 })));
      await ok(api(u, "POST", "/api/contribute", upload(`drive-hour-000${k}`, { hr: 3, bins: bins(0.9, 0).map((b) => ({ ...b, i: b.i + 30 })) })));   // a later chunk of the same drive
    }
    expect((await roads(us[0]))["777"]["0"].hr).toBeUndefined();                                    // four people: not yet
    await ok(api(us[4], "POST", "/api/contribute", upload("drive-hour-0009", { hr: 9 })));
    const hr = (await roads(us[0]))["777"]["0"].hr!;
    expect(hr).toHaveLength(12); expect(hr[3]).toBe(0.8); expect(hr[9]).toBe(0.2);
  });
});

describe("the car's fuel and range", () => {
  it("are kept on the car, validated, exported, and never shown to friends", async () => {
    const a = await makeUser("alice");
    const car = { make: "Mazda", model: "MX-5", fuel: "petrol", range_km: 420, shared: true };
    const { id } = (await (await ok(api(a, "POST", "/api/garage", car))).json()) as { id: string };
    const mine = (await (await ok(api(a, "GET", "/api/garage"))).json()) as { fuel: string; range_km: number }[];
    expect(mine[0]).toMatchObject({ fuel: "petrol", range_km: 420 });
    await ok(api(a, "PUT", `/api/garage/${id}`, { ...car, fuel: "electric", range_km: 300 }));
    expect(((await (await ok(api(a, "GET", "/api/garage"))).json()) as { fuel: string }[])[0].fuel).toBe("electric");
    expect((await api(a, "POST", "/api/garage", { ...car, fuel: "steam" })).status).toBe(400);
    expect((await api(a, "POST", "/api/garage", { ...car, range_km: 5 })).status).toBe(400);
    const exp = (await (await ok(api(a, "GET", "/api/me/export"))).json()) as { cars: { range_km: number }[] };
    expect(exp.cars[0].range_km).toBe(300);
  });
});

describe("fair meeting points: rough home areas, opt-in per crew", () => {
  it("coarsens to the 0.1-degree cell centre", () => {
    expect(cellOf(35.9612, -83.9207)).toBe("35.95,-83.95");
    expect(cellOf(-0.04, 0.04)).toBe("-0.05,0.05");
    expect(cellOf("35", -83)).toBeNull(); expect(cellOf(95, 0)).toBeNull();
  });

  it("is off by default, members only, no names, and empty until two share", async () => {
    const [a, b, c, out] = [await makeUser("alice"), await makeUser("bob"), await makeUser("carol"), await makeUser("mallory")];
    const crew = ((await (await ok(api(a, "POST", "/api/crews", { name: "Ridge Runners" }))).json()) as { id: string }).id;
    for (const u of [b, c]) await env.DB.prepare("INSERT INTO crew_members (crew_id, user_id) VALUES (?, ?)").bind(crew, u.id).run();
    const meet = async (u: typeof a) => (await (await ok(api(u, "GET", `/api/crews/${crew}/meet`))).json()) as { cells: number[][]; sharing: number; mine: boolean; need: number };
    expect(await meet(a)).toEqual({ cells: [], sharing: 0, mine: false, need: 2 });
    expect(((await (await ok(api(a, "GET", `/api/crews/${crew}/page`))).json()) as { home_shared: boolean }).home_shared).toBe(false);
    expect((await api(out, "PUT", `/api/crews/${crew}/home`, { on: true, lat: 35.9, lon: -83.9 })).status).toBe(404);
    expect((await api(out, "GET", `/api/crews/${crew}/meet`)).status).toBe(404);
    expect((await api(a, "PUT", `/api/crews/${crew}/home`, { on: true })).status).toBe(400);
    await ok(api(a, "PUT", `/api/crews/${crew}/home`, { on: true, lat: 35.96123, lon: -83.92071 }));   // even a precise point is kept coarse
    expect((await env.DB.prepare("SELECT home_cell FROM crew_members WHERE user_id = ?").bind(a.id).first<{ home_cell: string }>())!.home_cell).toBe("35.95,-83.95");
    expect(await meet(b)).toEqual({ cells: [], sharing: 1, mine: false, need: 2 });                  // one alone is never shown
    await ok(api(b, "PUT", `/api/crews/${crew}/home`, { on: true, lat: 35.55, lon: -84.21 }));
    // alice shares too, so her own cell would give bob's away: she needs two others sharing
    expect(await meet(a)).toEqual({ cells: [], sharing: 2, mine: true, need: 3 });
    const m = await meet(c);
    expect(m.cells).toEqual([[35.55, -84.25], [35.95, -83.95]]); expect(m.mine).toBe(false);
    expect(JSON.stringify(m)).not.toMatch(/alice|bob|user/i);
    expect(((await (await ok(api(a, "GET", `/api/crews/${crew}/page`))).json()) as { home_shared: boolean }).home_shared).toBe(true);
    const exp = (await (await ok(api(a, "GET", "/api/me/export"))).json()) as { crews: { home_area: string | null }[] };
    expect(exp.crews[0].home_area).toBe("35.95,-83.95");
    await ok(api(a, "PUT", `/api/crews/${crew}/home`, { on: false }));
    expect((await meet(c)).cells).toEqual([]);
  });
});

describe("EV chargers by tile (NREL, the key stays on the server)", () => {
  it("validates tiles, needs a member, and says no_key until the owner adds one", async () => {
    const a = await makeUser("alice");
    expect((await api(null, "GET", "/api/chargers?tiles=143_-336")).status).toBe(401);
    expect((await api(a, "GET", "/api/chargers?tiles=x")).status).toBe(400);
    expect((await api(a, "GET", `/api/chargers?tiles=${Array.from({ length: 41 }, (_, k) => `1_${k}`).join(",")}`)).status).toBe(400);
    const r = await api(a, "GET", "/api/chargers?tiles=143_-336");
    expect(r.status).toBe(503); expect(((await r.json()) as { error: string }).error).toBe("no_key");
  });

  it("asks NREL once per tile from its centre and keeps the stations inside it", async () => {
    (env as { NREL_API_KEY?: string }).NREL_API_KEY = "test-key";
    try {
      const asked: string[] = [];
      const fake = (async (u: string) => { asked.push(u); return new Response(JSON.stringify({ fuel_stations: [
        { latitude: 35.81, longitude: -83.9, ev_dc_fast_num: 2 }, { latitude: 35.9, longitude: -83.95, ev_dc_fast_num: null }, { latitude: 36.4, longitude: -83.9 }] })); }) as unknown as typeof fetch;
      const j = await chargers(env, new URL("https://x/api/chargers?tiles=143_-336"), fake);
      expect(asked).toHaveLength(1);
      expect(asked[0].startsWith("https://developer.nlr.gov/api/alt-fuel-stations/v1/nearest.json?")).toBe(true);
      expect(asked[0]).toContain("latitude=35.875"); expect(asked[0]).toContain("longitude=-83.875"); expect(asked[0]).toContain("fuel_type=ELEC");
      expect(j.stations).toEqual([{ lat: 35.81, lon: -83.9, dc: true }, { lat: 35.9, lon: -83.95, dc: false }]);
      expect(JSON.stringify(j)).not.toContain("test-key");
    } finally { delete (env as { NREL_API_KEY?: string }).NREL_API_KEY; }
  });

  it("parses NREL's answer to the stations inside the tile", () => {
    const j = { fuel_stations: [{ latitude: 35.81, longitude: -83.9, ev_dc_fast_num: 2 }, { latitude: 35.9, longitude: -83.95, ev_dc_fast_num: null }, { latitude: 36.4, longitude: -83.9 }, { latitude: "x" }] };
    expect(parseNrel(j, [143, -336])).toEqual([{ lat: 35.81, lon: -83.9, dc: true }, { lat: 35.9, lon: -83.95, dc: false }]);
  });
});
