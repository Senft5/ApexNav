// App health counts (src/health.ts, IDEAS Y-03): anonymous daily totals add up per day, app and metric; only known
// metrics, finished recent days and sane numbers are taken; the owner reads totals and other members can't.
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { api, freshDb, makeUser } from "./helpers";

beforeEach(freshDb);
const day = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
const post = (b: unknown) => api(null, "POST", "/api/app-health", b);

describe("health counts", () => {
  it("adds reports up, counts how many reports added to each, ignores unknown metrics, stores no person", async () => {
    expect((await post({ day: day(1), app: "ios", counts: { route_ok: 5, route_fail: 1, nonsense: 9, drives: 0 } })).status).toBe(204);
    expect((await post({ day: day(1), app: "ios", counts: { route_ok: 3 } })).status).toBe(204);
    expect((await post({ day: day(1), app: "web", counts: { route_ok: 2 } })).status).toBe(204);
    const rows = (await env.DB.prepare("SELECT * FROM health_counts ORDER BY app, metric").all()).results;
    expect(rows).toEqual([
      { day: day(1), app: "ios", metric: "route_fail", n: 1, reports: 1 },
      { day: day(1), app: "ios", metric: "route_ok", n: 8, reports: 2 },
      { day: day(1), app: "web", metric: "route_ok", n: 2, reports: 1 },
    ]);
  });

  it("refuses bad reports", async () => {
    for (const b of [{ day: day(1), app: "android", counts: {} }, { day: day(-1), app: "ios", counts: {} }, { day: day(20), app: "ios", counts: {} },
                     { day: "yesterday", app: "ios", counts: {} }, { day: day(1), app: "ios", counts: { route_ok: -1 } },
                     { day: day(1), app: "ios", counts: { route_ok: 1.5 } }, { day: day(1), app: "ios", counts: { route_ok: 1e9 } }, { day: day(1), app: "ios", counts: [] }])
      expect((await post(b)).status).toBe(400);
  });

  it("owner only summary", async () => {
    await post({ day: day(1), app: "ios", counts: { calib_locked: 2, calib_lock_s: 90 } });
    const owner = await makeUser("owner"), someone = await makeUser("someone");
    expect((await api(someone, "GET", "/api/ops/app-health?days=7")).status).toBe(404);
    const r = await api(owner, "GET", "/api/ops/app-health?days=7");
    expect(r.status).toBe(200);
    expect(((await r.json()) as { rows: unknown[] }).rows).toEqual([
      { metric: "calib_lock_s", app: "ios", n: 90, reports: 1 }, { metric: "calib_locked", app: "ios", n: 2, reports: 1 }]);
  });
});
