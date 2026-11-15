// src/valhalla.ts: our own Valhalla router. The region check, the points a request names, the 503 that sends the phone
// to the public server, and what the container may read from R2. (The container itself is proven by
// .github/workflows/valhalla-tiles.yml, which runs it on each week's tiles.)
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ORIGIN } from "./helpers";
import { RELAYS } from "../src/ratelimit";
import { PATHS, TILE_KEY, inRegion, requestPoints, tileRead } from "../src/valhalla";

const DATA = (env as unknown as { DATA: R2Bucket }).DATA;
const enc6 = (pts: [number, number][]) => {   // polyline6
  let out = "", la = 0, lo = 0;
  const one = (v: number) => { let x = v < 0 ? ~(v << 1) : v << 1; while (x >= 0x20) { out += String.fromCharCode((0x20 | (x & 0x1f)) + 63); x >>= 5; } out += String.fromCharCode(x + 63); };
  for (const [a, b] of pts) { const A = Math.round(a * 1e6), B = Math.round(b * 1e6); one(A - la); one(B - lo); la = A; lo = B; }
  return out;
};
const post = (action: string, body: unknown, headers: Record<string, string> = { origin: ORIGIN }) =>
  exports.default.fetch(new Request(`${ORIGIN}/api/valhalla/${action}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", "x-apexnav": "1", ...headers } }));

describe("our Valhalla router", () => {
  it("knows its region: Ohio, Kentucky (with the Kentucky Bend) and Indiana, nothing round them", () => {
    for (const [la, lo] of [[39.1031, -84.512], [38.0406, -84.5037], [39.7684, -86.1581], [41.4993, -81.6944], [36.54, -89.51]]) expect(inRegion(la, lo)).toBe(true);
    for (const [la, lo] of [[41.8781, -87.6298], [40.4406, -79.9959], [36.1627, -86.7816], [42.3314, -83.0458], [38.3498, -81.6326], [NaN, -84]]) expect(inRegion(la, lo)).toBe(false);
  });

  it("reads every point a request names, and none from a request it can't read", () => {
    expect(requestPoints({ locations: [{ lat: 39.1, lon: -84.5 }, { lat: 38, lon: -84.5 }] })).toHaveLength(2);
    expect(requestPoints({ sources: [{ lat: 1, lon: 2 }], targets: [{ lat: 3, lon: 4 }, { lat: 5, lon: 6 }] })).toHaveLength(3);
    expect(requestPoints({ encoded_polyline: enc6([[39.1, -84.5], [39.2, -84.4]]) })).toEqual([[39.1, -84.5], [39.2, -84.4]]);
    expect(requestPoints({ shape: [{ lat: "39", lon: -84 }] })).toBeNull();
    expect(requestPoints({ locations: "x" })).toBeNull();
    expect(requestPoints({ costing: "auto" })).toBeNull();
  });

  it("answers 503 when it can't serve, so the phone asks the public server: off here (no container in tests or previews)", async () => {
    const r = await post("route", { locations: [{ lat: 39.1, lon: -84.5 }, { lat: 38.04, lon: -84.5 }], costing: "auto" });
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ error: "not_served", reason: "off" });
    expect(r.headers.get("x-router")).toBe("none");
    expect((await post("isochrone", { locations: [] })).status).toBe(404);
    const s = await exports.default.fetch(new Request(`${ORIGIN}/api/valhalla/status`));
    expect(await s.json()).toEqual({ own: false, reason: "off" });
  });

  it("takes the app signed out (a route asked for, nothing written), from our own pages, with the app's header", async () => {
    const body = { locations: [{ lat: 39.1, lon: -84.5 }], costing: "auto" };
    const app = await post("route", body, { origin: "apexnav://app" });
    expect(app.status).toBe(503);
    expect(app.headers.get("access-control-allow-origin")).toBe("apexnav://app");
    expect(app.headers.get("access-control-expose-headers")).toBe("x-router");
    expect((await post("route", body, { origin: "https://evil.example" })).status).toBe(403);
    const bare = await exports.default.fetch(new Request(`${ORIGIN}/api/valhalla/route`, { method: "POST", body: JSON.stringify(body), headers: { origin: ORIGIN } }));
    expect(bare.status).toBe(403);   // no x-apexnav
    expect(RELAYS.has("/api/valhalla/route") && PATHS.every((p) => RELAYS.has(p))).toBe(true);   // limited per IP like the relays
  });

  it("lets the container read only its tile parts and index, GET only", async () => {
    await DATA.put("valhalla/v1/b/w1/part-000", new Uint8Array([1, 2, 3]));
    await DATA.put("graph/v1/index.json", "{}");
    const ok = await tileRead({ DATA }, new Request("http://tiles.vetta/valhalla/v1/b/w1/part-000"));
    expect(ok.status).toBe(200);
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect((await tileRead({ DATA }, new Request("http://tiles.vetta/graph/v1/index.json"))).status).toBe(404);
    expect((await tileRead({ DATA }, new Request("http://tiles.vetta/valhalla/v1/b/w1/part-001"))).status).toBe(404);
    expect((await tileRead({ DATA }, new Request("http://tiles.vetta/valhalla/v1/b/w1/part-000", { method: "PUT", body: "x" }))).status).toBe(405);
    expect(TILE_KEY.test("valhalla/v1/b/w1/x/part-000") || TILE_KEY.test("valhalla/v2/index.json")).toBe(false);
    await DATA.delete(["valhalla/v1/b/w1/part-000", "graph/v1/index.json"]);
  });
});
