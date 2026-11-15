// src/road_insights.ts: the road insights API (data.vettadrive.com). Real data only with a key; partner keys only once the
// owner opens them; ten distinct drivers and a through road before any figure; noised, the same draw each time; nothing
// about a person. And the contribution path now counts up to FLOOR_CAP distinct drivers so the floor can be checked.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { DATA_K, FLOOR_CAP, RANGE, keyAccess, laplace, release } from "../src/road_insights";
import { CAM_V } from "../src/contribute";
import { routeHost } from "../src/hosts";
import type { Env } from "../src/util";
import { api, freshDb, makeUser, ok } from "./helpers";

beforeEach(freshDb);

const INTERNAL = "vk_test_internal_key_0123456789abcdefghij";   // its hash is DATA_OWNER_KEYS in wrangler.test.jsonc
const PARTNER = "vk_test_partner_key_0123456789abcdefghijk";    // ...and DATA_API_KEYS
const BOX = "bbox=39.0,-84.6,39.5,-84.1";
const get = (key: string | null, q = BOX) => api(null, "GET", `/api/data/v1/roads.geojson?${q}`, undefined, key ? { authorization: `Bearer ${key}` } : {});

/** A road with `drivers` distinct holders on direction 0, a few measured bins, of class `cls`. */
async function road(way: number, cls: string, drivers: number, lenM = 3000) {
  const shape = JSON.stringify([[39.2, -84.4], [39.21, -84.39]]);
  const st: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO road_ways (way_id, s, w, n, e, shape, cls, len_m) VALUES (?, 39.2, -84.4, 39.21, -84.39, ?, ?, ?)").bind(way, shape, cls, lenM),
  ];
  for (const i of [0, 1, 2, 3]) {
    st.push(env.DB.prepare(`INSERT INTO road_bins (way_id, dir, bin_idx, n, camber_mean, camber_m2, camber_n, rough_mean, rough_m2, crest_peak, last_on, flow_mean, brake_mean, flow_n)
                            VALUES (?, 0, ?, 12, 4, 0, 12, 0.1, 0, ?, '2026-10-20', 0.8, 0.05, 12)`).bind(way, i, i === 0 ? 0.3 : 0.05));
  }
  for (let d = 0; d < drivers; d++) st.push(env.DB.prepare("INSERT INTO road_floor (way_id, dir, holder) VALUES (?, 0, ?)").bind(way, new Uint8Array([way & 255, d]).buffer));
  await env.DB.batch(st);
}

describe("GET /api/data/v1/roads.geojson", () => {
  it("needs a key: none, malformed or unknown is 401", async () => {
    await road(1, "secondary", DATA_K);
    expect((await get(null)).status).toBe(401);
    expect((await get("not-a-key")).status).toBe(401);
    expect((await get("vk_" + "x".repeat(40))).status).toBe(401);
  });

  it("a partner key is refused until the owner turns road_data_partners on", async () => {
    await road(1, "secondary", DATA_K);
    const r = await get(PARTNER);
    expect(r.status).toBe(403);
    expect((await r.json() as { error: string }).error).toBe("partner_access_not_open");
    const req = new Request("https://x/", { headers: { authorization: `Bearer ${PARTNER}` } });
    const opened = { ...env, FLAGS: JSON.stringify({ road_data_partners: { on: true } }) } as unknown as Env;
    expect(await keyAccess(req, opened)).toBe("partner");
  });

  it("an internal key gets the through roads ten or more drivers drove, and nothing else", async () => {
    await road(1, "secondary", DATA_K);          // released
    await road(2, "secondary", DATA_K - 1);      // nine drivers: withheld
    await road(3, "residential", 30);            // never a residential street
    await road(4, "unclassified", 30, 800);      // a short unclassified road may be a lane: withheld
    await road(5, "unclassified", 30, 2000);     // a long back road: released
    const j = await (await ok(get(INTERNAL))).json() as { sample: boolean; access: string; k: number; features: { properties: Record<string, unknown> }[] };
    expect(j.sample).toBe(false);
    expect(j.access).toBe("internal");
    expect(j.k).toBe(DATA_K);
    expect(j.features.map((f) => f.properties.way).sort()).toEqual([1, 5]);
    const p = j.features[0].properties;
    expect(p).toMatchObject({ way: 1, dir: 0, cls: "secondary", confidence: "fair", last_month: "2026-10" });
    for (const k of ["rough_g", "banked", "off_camber", "crests_per_km", "flow", "hard_brake"]) expect(typeof p[k]).toBe("number");
    // only facts about the road: no count, holder, person, day or drive
    expect(Object.keys(p).sort()).toEqual(["banked", "cls", "confidence", "crests_per_km", "dir", "flow", "hard_brake", "last_month", "off_camber", "rough_g", "way"]);
    expect(JSON.stringify(j)).not.toMatch(/user|handle|email|holder|passes|2026-10-20/i);
  });

  it("the noise is the same draw on every ask, so asking again can't average it away", async () => {
    await road(1, "primary", 25);
    const a = await (await ok(get(INTERNAL))).json() as { features: { properties: Record<string, unknown> }[] };
    const b = await (await ok(get(INTERNAL))).json() as { features: { properties: Record<string, unknown> }[] };
    expect(a.features[0].properties).toEqual(b.features[0].properties);
    expect(a.features[0].properties.confidence).toBe("good");
  });

  it("refuses a box over one degree a side", async () => {
    expect((await get(INTERNAL, "bbox=39,-85,40.5,-84")).status).toBe(400);
    expect((await get(INTERNAL, "bbox=nope")).status).toBe(400);
  });
});

describe("the release rules", () => {
  it("Laplace noise is seeded and centred; a released value stays in its range", async () => {
    expect(await laplace("a", 1)).toBe(await laplace("a", 1));
    let sum = 0;
    for (let i = 0; i < 400; i++) sum += await laplace(`s${i}`, 1);
    expect(Math.abs(sum / 400)).toBeLessThan(0.3);
    for (let i = 0; i < 50; i++) {
      const v = (await release(0.29, "rough_g", DATA_K, `r${i}`))!;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(RANGE.rough_g);
    }
    expect(await release(null, "flow", 30, "x")).toBeNull();
  });

  it("more drivers means less noise", async () => {
    const spread = async (d: number) => { let s = 0; for (let i = 0; i < 200; i++) s += Math.abs((await release(0.5, "flow", d, `n${i}`))! - 0.5); return s / 200; };
    expect(await spread(FLOOR_CAP)).toBeLessThan(await spread(DATA_K));
  });
});

describe("GET /api/data/v1/meta and the site", () => {
  it("the meta is public and says the sample is made up", async () => {
    const j = await (await ok(api(null, "GET", "/api/data/v1/meta"))).json() as { rules: { min_drivers: number }; status: string; fields: Record<string, string> };
    expect(j.rules.min_drivers).toBe(DATA_K);
    expect(j.status).toMatch(/made up/);
    expect(Object.keys(j.fields)).toContain("rough_g");
  });

  it("data.vettadrive.com's front page is the viewer", async () => {
    const fakeEnv = { ASSETS: { fetch: async (r: Request) => new Response(`asset ${new URL(r.url).pathname}`) } } as unknown as Env;
    expect(await (await routeHost(new Request("https://data.vettadrive.com/"), fakeEnv))!.text()).toBe("asset /insights");
    expect(await routeHost(new Request("https://data.vettadrive.com/api/data/v1/meta"), fakeEnv)).toBeNull();
  });
});

describe("POST /api/contribute counts distinct drivers past two", () => {
  it("keeps up to FLOOR_CAP established holders per road and direction (hmacs, never ids)", async () => {
    const users = [];
    for (let i = 0; i < 4; i++) users.push(await makeUser(`d${i}`));
    for (const u of users) await env.DB.prepare("UPDATE members SET contribute = 1, joined_at = datetime('now', '-30 days') WHERE user_id = ?").bind(u.id).run();
    const today = new Date().toISOString().slice(0, 10);
    const bins = Array.from({ length: 60 }, (_, j) => ({ i: j, cam: 1.5, rough: 0.05, crest: 0.1, k: 0.01 }));
    for (const [n, u] of users.entries()) {
      await ok(api(u, "POST", "/api/contribute", { way_id: 777, dir: 0, driven_on: today, drive_id: `drive-aaaa-000${n}`, bins, cam_v: CAM_V }));
    }
    const c = await env.DB.prepare("SELECT COUNT(*) AS c FROM road_floor WHERE way_id = 777 AND dir = 0").first<{ c: number }>();
    expect(c!.c).toBe(4);
  });
});
