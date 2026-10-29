// Friends on the map (src/presence.ts, REVIEW.md 5.4, roadmap 24): off by default, the delay applied on the server, the
// grid fuzz before storage, home zones dropped, crews vs friends, blocks, and nothing kept once it's off.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeUser, ok, type TestUser } from "./helpers";
import { GRID_DEG, snap } from "../src/presence";

beforeEach(freshDb);
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as any;
const set = (u: TestUser, s: Record<string, unknown>) => ok(api(u, "PUT", "/api/presence/settings", s));
const pub = (u: TestUser, lat: number, lon: number, road?: string) => ok(api(u, "POST", "/api/presence", { lat, lon, road }));
const age = (u: TestUser, s: number) => env.DB.prepare("UPDATE presence_samples SET at = datetime(at, ?) WHERE user_id = ?").bind(`-${s} seconds`, u.id).run();
const count = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM presence_samples").first<{ n: number }>())!.n;

describe("friends on the map", () => {
  it("the grid: fixed cells about a mile across; every point in a cell gives the same centre", () => {
    const a = snap(35.3612, -84.2901);
    for (const [dy, dx] of [[0.3, 0.004], [-0.4, -0.006], [0.45, 0]]) expect(snap(a.lat + GRID_DEG * dy, a.lon + dx)).toEqual(a);
    expect(Math.abs(a.lat - 35.3612) * 69).toBeLessThan(0.51);
    expect(snap(35.3612 + GRID_DEG, -84.2901)).not.toEqual(a);
  });

  it("nobody by default: nothing is stored until you choose who sees you", async () => {
    const [a, b] = [await makeUser("sam"), await makeUser("nate")];
    await befriend(a, b);
    expect(await json(api(a, "GET", "/api/presence/settings"))).toEqual({ audience: "nobody", delay_s: 600, fuzz: true });
    await pub(a, 35.36, -84.29);
    expect(await count()).toBe(0);
    expect(await json(api(b, "GET", "/api/presence"))).toEqual([]);
  });

  it("friends, within a mile, 10 min late: stored snapped, shown only once 10 minutes old, never newer", async () => {
    const [a, b, c] = [await makeUser("sam"), await makeUser("nate"), await makeUser("stranger")];
    await befriend(a, b);
    await set(a, { audience: "friends", delay_s: 600, fuzz: true });
    await pub(a, 35.3612, -84.2901, "Cherohala Skyway");
    const row = await env.DB.prepare("SELECT lat, lon, road FROM presence_samples").first<{ lat: number; lon: number; road: string | null }>();
    expect(row).toEqual({ ...snap(35.3612, -84.2901), road: null });                     // the exact point never stored; no road name
    expect(await json(api(b, "GET", "/api/presence"))).toEqual([]);                       // not 10 minutes old yet
    await age(a, 700);
    const [p] = await json(api(b, "GET", "/api/presence"));
    expect(p).toMatchObject({ handle: "sam", delay_s: 600, fuzz: true, ...snap(35.3612, -84.2901), road: null });
    expect(await json(api(c, "GET", "/api/presence"))).toEqual([]);                       // not a friend
    // a newer sample doesn't show until it is old enough; the older one stands
    await pub(a, 35.5, -84.0);
    expect((await json(api(b, "GET", "/api/presence")))[0].lat).toBe(snap(35.3612, -84.2901).lat);
    // stale: half an hour past the delay, gone
    await age(a, 3000);
    expect(await json(api(b, "GET", "/api/presence"))).toEqual([]);
  });

  it("crew, live and exact: crew-mates see the road; friends who aren't crew-mates don't; home zones and blocks", async () => {
    const [a, b, f] = [await makeUser("jules"), await makeUser("nate"), await makeUser("friendonly")];
    await befriend(a, f);
    const crew = (await json(api(a, "POST", "/api/crews", { name: "Ridge Runners" }))).id;
    const tok = (await json(api(a, "POST", `/api/crews/${crew}/invite`))).token;
    await ok(api(b, "POST", "/api/crews/join", { token: tok }));
    await set(a, { audience: "crew", delay_s: 0, fuzz: false, zones: [{ lat: 35.4, lon: -84.1, r: 500 }] });
    await pub(a, 35.4002, -84.1001);                                                      // at home: dropped
    expect(await count()).toBe(0);
    await pub(a, 35.36123, -84.29011, "Cherohala Skyway");
    const [p] = await json(api(b, "GET", "/api/presence"));
    expect(p).toMatchObject({ handle: "jules", lat: 35.36123, lon: -84.29011, road: "Cherohala Skyway", delay_s: 0, fuzz: false });
    expect(await json(api(f, "GET", "/api/presence"))).toEqual([]);
    await ok(api(b, "POST", "/api/blocks", { handle: "jules" }));
    expect(await json(api(b, "GET", "/api/presence"))).toEqual([]);
    // samples come no closer than 20 s apart
    await pub(a, 35.37, -84.3);
    expect(await count()).toBe(1);
  });

  it("switching to within a mile drops exact samples; turning it off keeps nothing; checks", async () => {
    const [a] = [await makeUser("sam")];
    await set(a, { audience: "friends", delay_s: 0, fuzz: false });
    await pub(a, 35.36123, -84.29011);
    await set(a, { audience: "friends", delay_s: 0, fuzz: true });
    expect(await count()).toBe(0);
    await pub(a, 35.36123, -84.29011);
    await set(a, { audience: "nobody" });
    expect(await count()).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM presence_settings").first<{ n: number }>())!.n).toBe(0);
    for (const bad of [{ audience: "everyone", delay_s: 0, fuzz: true }, { audience: "crew", delay_s: 5, fuzz: true }, { audience: "crew", delay_s: 0, fuzz: "yes" },
      { audience: "crew", delay_s: 0, fuzz: true, zones: Array(11).fill({ lat: 1, lon: 1, r: 200 }) }])
      expect((await api(a, "PUT", "/api/presence/settings", bad)).status).toBe(400);
  });
});
