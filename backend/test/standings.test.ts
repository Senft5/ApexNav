import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeSegment, makeUser, ok, type TestUser } from "./helpers";

beforeEach(freshDb);

const today = () => new Date().toISOString().slice(0, 10);
const month = () => new Date().toISOString().slice(0, 7);
const crew = async (u: TestUser, body: Record<string, unknown>) => ((await (await ok(api(u, "POST", "/api/crews", body))).json()) as { id: string }).id;
const area = { name: "Robbinsville", lat: 35.3, lon: -83.8 };
const km = (u: TestUser, n: number) => env.DB.prepare("INSERT INTO member_months (user_id, month, km) VALUES (?, ?, ?)").bind(u.id, month(), n).run();
async function run(u: TestUser, crewId: string, smoothness: number) {
  const seg = await makeSegment(u);
  await ok(api(u, "PUT", "/api/grants", { audience_type: "crew", audience_id: crewId, share_scores: true }));
  await ok(api(u, "POST", "/api/board", { segment_id: seg, driver_score: 700, driven_on: today(), smoothness }));
}
type Standings = { month: string; mine: { name: string; km: number; smoothness: number | null; km_rank: number | null; smooth_rank: number | null; of: number }[];
  top_km: { name: string; km: number; smoothness: number | null }[]; top_smooth: { name: string; smoothness: number }[] };

describe("crew standings this month (IDEAS S-11, S-08)", () => {
  it("ranks public crews of 3+ by km and by smoothness; private crews only for their members; never a person's own numbers", async () => {
    const [a, b, c, d, e] = await Promise.all(["a", "b", "c", "d", "e"].map((h) => makeUser(h)));
    const ridge = await crew(a, { name: "Ridge Runners", visibility: "public", area });
    const hollow = await crew(d, { name: "Hollow Crew", visibility: "public", area });
    const duo = await crew(e, { name: "Duo", visibility: "public", area });       // two members: not ranked
    const secret = await crew(a, { name: "Secret Squirrels" });
    for (const u of [b, c]) await ok(api(u, "POST", `/api/crews/${ridge}/join`));
    for (const u of [b, c]) await ok(api(u, "POST", `/api/crews/${hollow}/join`));
    await ok(api(a, "POST", `/api/crews/${duo}/join`));
    await km(a, 120); await km(b, 30); await km(c, 10); await km(d, 400);
    for (const [u, s] of [[a, 90], [b, 80], [c, 85]] as const) await run(u, ridge, s);
    await run(d, hollow, 60);                                                           // one run: no smoothness yet
    const j = await (await ok(api(b, "GET", "/api/crews/standings"))).json() as Standings;
    expect(j.month).toBe(month());
    expect(j.top_km.map((x) => [x.name, x.km])).toEqual([["Hollow Crew", 440], ["Ridge Runners", 160]]);
    expect(j.top_smooth.map((x) => [x.name, x.smoothness])).toEqual([["Ridge Runners", 85]]);
    expect(j.top_km.find((x) => x.name === "Hollow Crew")!.smoothness).toBeNull();
    expect(j.mine.map((x) => [x.name, x.km_rank, x.smooth_rank, x.of]).sort()).toEqual([["Hollow Crew", 1, null, 2], ["Ridge Runners", 2, 1, 2]]);
    expect(JSON.stringify(j)).not.toMatch(/handle|user_id|"a"|Secret/);
    // the private crew's members see it, with its totals, and no rank
    const ja = await (await ok(api(a, "GET", "/api/crews/standings"))).json() as Standings;
    expect(ja.mine.find((x) => x.name === "Secret Squirrels")).toMatchObject({ km: 120, km_rank: null });
    expect(ja.mine.find((x) => x.name === "Duo")).toMatchObject({ km_rank: null });
  });

  it("road data counts into your month, and the roads you were first on into pioneer km", async () => {
    const [a, b] = [await makeUser("a"), await makeUser("b")];
    for (const u of [a, b]) await env.DB.prepare("UPDATE members SET contribute = 1 WHERE user_id = ?").bind(u.id).run();
    const bins = Array.from({ length: 40 }, (_, i) => ({ i, cam: 1, rough: 0.1, crest: null, k: 0.01 }));
    await ok(api(a, "POST", "/api/contribute", { way_id: 55, dir: 0, driven_on: today(), drive_id: "drive-month-0001", bins }));
    await ok(api(b, "POST", "/api/contribute", { way_id: 55, dir: 0, driven_on: today(), drive_id: "drive-month-0002", bins }));
    const pa = await (await ok(api(a, "GET", "/api/points"))).json() as { month: { km: number; pioneer_km: number } };
    const pb = await (await ok(api(b, "GET", "/api/points"))).json() as { month: { km: number; pioneer_km: number } };
    expect(pa.month).toEqual({ km: 0.2, pioneer_km: 0.2 });
    expect(pb.month).toEqual({ km: 0.2, pioneer_km: 0 });                        // second on the road: not a pioneer km
  });

  it("smoothness is checked and members only", async () => {
    const a = await makeUser("a");
    const seg = await makeSegment(a);
    for (const s of [-1, 101, 50.5, "smooth"]) expect((await api(a, "POST", "/api/board", { segment_id: seg, driver_score: 700, driven_on: today(), smoothness: s })).status).toBe(400);
    expect((await api(null, "GET", "/api/crews/standings")).status).toBe(401);
  });
});
