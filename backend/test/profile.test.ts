// A friend's profile (src/profile.ts, IDEAS S-15): friends only, never across a block; made only of what they already show
// you (name, shared cars, crews in common, stages they publish to you with best score and days this month); never times.
import { beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeSegment, makeUser, ok, type TestUser } from "./helpers";

beforeEach(freshDb);
const today = new Date().toISOString().slice(0, 10);
const profile = (u: TestUser, of: TestUser) => api(u, "GET", `/api/friends/${of.id}/profile`);

describe("friend profiles", () => {
  it("shows a friend what the other already shows them, and no times", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await befriend(a, b);
    await ok(api(b, "POST", "/api/garage", { make: "Mazda", model: "MX-5", year: 1990, shared: true }));
    await ok(api(b, "POST", "/api/garage", { make: "Honda", model: "S2000", year: 2001 }));             // not shown to friends
    const crew = ((await (await ok(api(a, "POST", "/api/crews", { name: "Ridge Runners", visibility: "public", area: { name: "Robbinsville", lat: 35.3, lon: -83.8 } }))).json()) as { id: string }).id;
    await ok(api(b, "POST", `/api/crews/${crew}/join`));
    const seg = await makeSegment(b, "Esses");
    await ok(api(b, "PUT", "/api/grants", { audience_type: "friend", audience_id: a.id, share_scores: true, share_times: true }));
    await ok(api(b, "POST", "/api/board", { segment_id: seg, driver_score: 812, time_s: 600, driven_on: today }));
    const p = (await (await ok(profile(a, b))).json()) as Record<string, any>;
    expect(p).toMatchObject({ handle: "bob", name: "BOB", crews: ["Ridge Runners"], totals: { stages: 1, days_month: 1, best: 812 } });
    expect(p.cars.map((c: Record<string, unknown>) => c.model)).toEqual(["MX-5"]);
    expect(p.stages).toEqual([{ stage: "Esses", best: 812, days_month: 1, last: today }]);
    expect(JSON.stringify(p)).not.toMatch(/time_s|600|email/);
  });

  it("scores they don't share with you aren't there", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await befriend(a, b);
    await ok(api(b, "POST", "/api/board", { segment_id: await makeSegment(b), driver_score: 700, driven_on: today }));
    const p = (await (await ok(profile(a, b))).json()) as Record<string, any>;
    expect(p.stages).toEqual([]);
    expect(p.totals).toEqual({ stages: 0, days_month: 0, best: null });
  });

  it("strangers, pending requests, blocks and yourself get nothing", async () => {
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("carol")];
    expect((await profile(a, b)).status).toBe(404);
    await ok(api(a, "POST", "/api/friends/request", { handle: "bob" }));
    expect((await profile(a, b)).status).toBe(404);
    await befriend(a, c);
    await ok(api(c, "POST", "/api/blocks", { user_id: a.id }));
    expect((await profile(a, c)).status).toBe(404);
    expect((await profile(a, a)).status).toBe(404);
  });
});
