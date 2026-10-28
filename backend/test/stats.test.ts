// Server latency and error rates (src/stats.ts, IDEAS Y-17): samples add up weighted, 5xx exactly, into latency buckets;
// the owner reads per-route rates and a p95 estimate; nobody else can.
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { api, freshDb, makeUser } from "./helpers";
import { p95, recordStat } from "../src/stats";

beforeEach(freshDb);

describe("route stats", () => {
  it("adds weighted samples into buckets and counts 5xx exactly", async () => {
    await recordStat(env, "GET /api/me", 200, 40, 10);
    await recordStat(env, "GET /api/me", 200, 250, 10);
    await recordStat(env, "GET /api/me", 404, 20, 10);
    await recordStat(env, "GET /api/me", 500, 1500, 0);                  // an error not in the sample: counted, not weighted
    const row = await env.DB.prepare("SELECT n, s4xx, s5xx, ms_sum, lt100, lt300, lt1000, ge1000 FROM route_stats WHERE route = 'GET /api/me'").first();
    expect(row).toEqual({ n: 30, s4xx: 10, s5xx: 1, ms_sum: 400 + 2500 + 200, lt100: 20, lt300: 10, lt1000: 0, ge1000: 0 });
  });

  it("the owner reads it; others can't", async () => {
    for (let i = 0; i < 19; i++) await recordStat(env, "GET /api/roads", 200, 50, 10);
    await recordStat(env, "GET /api/roads", 200, 2000, 10);
    const owner = await makeUser("owner"), someone = await makeUser("someone");
    expect((await api(someone, "GET", "/api/ops/latency")).status).toBe(404);
    const r = (await (await api(owner, "GET", "/api/ops/latency?days=7")).json()) as { rows: Array<Record<string, unknown>> };
    expect(r.rows.find((x) => x.route === "GET /api/roads")).toEqual({ route: "GET /api/roads", n: 200, s4xx: 0, s5xx: 0, mean_ms: 148, p95_ms: "<100" });
  });

  it("p95 from buckets", () => {
    expect(p95({ n: 100, lt100: 50, lt300: 46, lt1000: 3, ge1000: 1 })).toBe("<300");
    expect(p95({ n: 100, lt100: 10, lt300: 10, lt1000: 10, ge1000: 70 })).toBe(">1000");
    expect(p95({ n: 0, lt100: 0, lt300: 0, lt1000: 0, ge1000: 0 })).toBeNull();
  });
});
