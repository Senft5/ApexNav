// End-to-end road-data loop (IDEAS Q-07): drives -> /api/contribute -> D1 profile -> /api/roads -> route choice. The Worker
// and D1 are the real ones (isolated test database); the phone side is the app's own contributor.js and fun_route.js. Only the
// map services (Valhalla matching, Overpass geometry) are stubbed, with two straight test roads. Simulated sensors, not a device run.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import * as contributorNs from "../../web/contributor.js";
import * as funRouteNs from "../../web/fun_route.js";
import { api, freshDb, makeUser, type TestUser } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
// the UMD files land on globalThis or as a CommonJS export, depending on how the test pool loads them
const umd = (ns: Any, name: string) => (globalThis as Any)[name] ?? ns.default ?? ns;
const C = umd(contributorNs, "ApexContributor"), FR = umd(funRouteNs, "ApexFunRoute");

beforeEach(freshDb);

// Two parallel 2 km roads running north: way 101 (rough) and way 202 (smooth).
const ROADS: Record<number, number> = { 101: -84.0, 202: -83.99 };
const LAT0 = 39.0, N = 400, STEP = 5 / 110540;
const line = (lon: number) => Array.from({ length: N }, (_, i) => [LAT0 + i * STEP, lon] as [number, number]);
const wayAt = (lon: number) => Number(Object.keys(ROADS).find((w) => Math.abs(ROADS[+w] - lon) < 0.002));

async function mapStub(url: string, init: { body: string }): Promise<Response> {
  if (url.includes("trace_attributes")) {
    const shape = JSON.parse(init.body).shape as { lat: number; lon: number }[];
    return Response.json({ edges: [{ way_id: wayAt(shape[0].lon), road_class: "secondary" }], matched_points: shape.map(() => ({ type: "matched", edge_index: 0 })) });
  }
  const ids = (decodeURIComponent(init.body).match(/way\(id:([\d,]+)\)/) || [])[1].split(",").map(Number);
  return Response.json({ elements: ids.map((id) => ({ type: "way", id, geometry: line(ROADS[id]).map(([lat, lon]) => ({ lat, lon })) })) });
}

const today = new Date().toISOString().slice(0, 10);
function drive(id: string, way: number, rough: number) {
  const pts = line(ROADS[way]);
  return { id, date: today, lat: pts.map((p) => p[0]), lon: pts.map((p) => p[1]),
    rough: pts.map(() => rough), camber: pts.map(() => 1), crest: pts.map(() => 0.05), kappa: pts.map(() => 0) };
}
const post = (u: TestUser) => async (c: unknown) => (await api(u, "POST", "/api/contribute", c)).status === 202;
const lookup = (u: TestUser) => async (ids: number[]) => { const r = await api(u, "GET", `/api/roads?ways=${ids.join(",")}`); return r.ok ? r.json() : null; };
const route = (way: number) => { const p = line(ROADS[way]); return { lat: p.map((x) => x[0]), lon: p.map((x) => x[1]) }; };

describe("road-data loop (IDEAS Q-07)", () => {
  it("two members' drives change which route is chosen; one member alone changes nothing", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob"), reader = await makeUser("carol");
    for (const u of [a, b]) await env.DB.prepare("UPDATE members SET contribute = 1 WHERE user_id = ?").bind(u.id).run();

    // Before anything is measured: both candidates unadjusted, so the quicker one (way 101) wins.
    const cands = async () => Promise.all([101, 202].map(async (w, k) => {
      const m = await C.measuredAlong(route(w), lookup(reader), { fetch: mapStub });
      return { way: w, timeS: 600 + k * 30, fun: { fun: 50, good: 3 }, adjust: C.measuredAdjust(m), m };
    }));
    let ranked = FR.rank(await cands(), "fun");
    expect(ranked[0].way).toBe(101);
    expect(ranked.every((c: Any) => c.m.coveredKm === 0 && c.m.roughness === null && c.adjust === 0)).toBe(true);   // unknown stays unknown

    // Alice drives both roads: uploads are acknowledged, but one driver alone is never published (Z-08).
    for (const [w, r] of [[101, 0.4], [202, 0.03]] as const) {
      const res = await C.contributeDrive(drive(`a${w}`, w, r), post(a), { fetch: mapStub, trimM: 0 });
      expect(res.sent).toBeGreaterThan(0);
    }
    ranked = FR.rank(await cands(), "fun");
    expect(ranked.every((c: Any) => c.adjust === 0)).toBe(true);

    // Bob drives them too: the profile reads back and the smooth road now wins despite being 30 s slower.
    for (const [w, r] of [[101, 0.38], [202, 0.04]] as const)
      expect((await C.contributeDrive(drive(`b${w}`, w, r), post(b), { fetch: mapStub, trimM: 0 })).sent).toBeGreaterThan(0);
    const rows = (await lookup(reader)([101, 202])) as Any;
    expect(Object.keys(rows).sort()).toEqual(["101", "202"]);
    expect(rows["101"]["0"].n.every((n: number) => n === 2)).toBe(true);
    ranked = FR.rank(await cands(), "fun");
    const by = Object.fromEntries(ranked.map((c: Any) => [c.way, c]));
    expect(by[101].m.roughness).toBeGreaterThan(0.3);
    expect(by[202].m.roughness).toBeLessThan(0.08);
    expect(by[101].adjust).toBeLessThan(0);
    expect(by[202].adjust).toBeGreaterThan(0);
    expect(ranked[0].way).toBe(202);

    // A retried upload of the same drive is merged once (no third pass).
    await C.contributeDrive(drive("b101", 101, 0.38), post(b), { fetch: mapStub, trimM: 0 });
    expect(((await lookup(reader)([101])) as Any)["101"]["0"].n.every((n: number) => n === 2)).toBe(true);
  });
});
