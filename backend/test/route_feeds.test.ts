import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "./helpers";
import { inTiles, parseTiles, WZDX_FEEDS } from "../src/route_feeds";

// A piece of KYTC's real WZDx v4.1 feed (2026-11-03): KY-8 in Campbell County (all lanes closed) and I-65 in Louisville.
const KY8 = { type: "Feature", properties: { core_details: { event_type: "work-zone", road_names: ["KY-8"], direction: "eastbound", description: "KY-8 between MM 15.9 and 19.3 in Campbell County" }, start_date: "2026-08-05T11:00:00Z", end_date: "2026-11-30T23:00:00Z", vehicle_impact: "unknown", lanes: [{ order: 1, type: "general", status: "closed" }, { order: 2, type: "general", status: "closed" }] }, geometry: { type: "LineString", coordinates: [[-84.3905, 39.0396], [-84.3712, 39.0322]] } };
const I65 = { type: "Feature", properties: { core_details: { event_type: "work-zone", road_names: ["I-65"], direction: "southbound", description: "I-65 South between MM 136.0 and 130.0" } }, geometry: { type: "LineString", coordinates: [[-85.7547, 38.2493], [-85.7601, 38.2101]] } };

const real = globalThis.fetch;
afterEach(() => { globalThis.fetch = real; delete (env as { CTX_KEYS?: string }).CTX_KEYS; });
const stubFeed = (body: unknown, status = 200, seen: string[] = []) => {
  globalThis.fetch = (async (url: string) => { seen.push(String(url)); return new Response(JSON.stringify(body), { status }); }) as typeof fetch;
  return seen;
};

describe("route feeds relay (/api/ctx/workzones)", () => {
  it("returns only the features touching the asked 0.5° tiles, unchanged, without signing in", async () => {
    const seen = stubFeed({ type: "FeatureCollection", feed_info: { publisher: "KYTC" }, features: [KY8, I65] });
    const r = await api(null, "GET", "/api/ctx/workzones?state=KY&tiles=78_-169");          // 39.0-39.5 N, 84.5-84.0 W
    expect(r.status).toBe(200);
    const body = (await r.json()) as { features: unknown[]; feed_info: unknown };
    expect(body.features).toEqual([KY8]);
    expect(body.feed_info).toEqual({ publisher: "KYTC" });
    expect(seen).toEqual([WZDX_FEEDS.KY]);                                                    // the phone's tiles never leave
  });

  it("refuses unknown states and malformed or oversized tile lists", async () => {
    stubFeed({ features: [] });
    expect((await api(null, "GET", "/api/ctx/workzones?state=XX&tiles=78_-169")).status).toBe(400);
    expect((await api(null, "GET", "/api/ctx/workzones?state=KY&tiles=78.2_-169")).status).toBe(400);
    expect((await api(null, "GET", "/api/ctx/workzones?state=KY")).status).toBe(400);
    const many = Array.from({ length: 41 }, (_, i) => `78_${-200 + i}`).join(",");
    expect((await api(null, "GET", `/api/ctx/workzones?state=KY&tiles=${many}`)).status).toBe(400);
  });

  it("says the feed is unavailable when it is", async () => {
    stubFeed({}, 503);
    expect((await api(null, "GET", "/api/ctx/workzones?state=KY&tiles=78_-169")).status).toBe(502);
  });

  it("tile maths", () => {
    expect(parseTiles("78_-169")).toEqual([[39, -84.5, 39.5, -84]]);
    expect(inTiles([KY8, I65] as never, parseTiles("76_-172"))).toEqual([I65]);
  });

  it("hands the app only the known client keys, and nothing when none is set", async () => {
    expect(await (await api(null, "GET", "/api/ctx/keys")).json()).toEqual({ keys: {} });
    (env as { CTX_KEYS?: string }).CTX_KEYS = JSON.stringify({ seatgeekClientId: "abc", other: "x", ohgoApiKey: "" });
    expect(await (await api(null, "GET", "/api/ctx/keys")).json()).toEqual({ keys: { seatgeekClientId: "abc" } });
    (env as { CTX_KEYS?: string }).CTX_KEYS = "{ broken";
    expect(await (await api(null, "GET", "/api/ctx/keys")).json()).toEqual({ keys: {} });
  });
});
