import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeUser, ok, type TestUser } from "./helpers";

beforeEach(freshDb);

const day = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400e3).toISOString().slice(0, 10);
async function crewOf(owner: TestUser, ...others: TestUser[]) {
  const crew = ((await (await ok(api(owner, "POST", "/api/crews", { name: "Ridge Runners" }))).json()) as { id: string }).id;
  for (const o of others) {
    const tok = ((await (await ok(api(owner, "POST", `/api/crews/${crew}/invite`))).json()) as { token: string }).token;
    await ok(api(o, "POST", "/api/crews/join", { token: tok }));
  }
  return crew;
}
const share = (u: TestUser, crew: string, on = true) => ok(api(u, "PUT", "/api/grants", { audience_type: "crew", audience_id: crew, share_scores: on }));
const publish = (u: TestUser, drives: { id: string; score: number; driven_on: string }[]) => api(u, "POST", "/api/drives/scores", { drives });
const board = async (u: TestUser, crew: string, period?: string) =>
  ((await (await ok(api(u, "GET", `/api/crews/${crew}/board${period ? `?period=${period}` : ""}`))).json()) as { period: string; rows: any[] });

describe("crew board: total of drive Scores over a period", () => {
  it("adds up each member's drive Scores shared with the crew; -- for those who share none; only what was shared counts", async () => {
    const [a, b, c, out] = [await makeUser("alice"), await makeUser("bob"), await makeUser("carol"), await makeUser("outsider")];
    const crew = await crewOf(a, b, c);
    await share(b, crew); await share(a, crew);
    await ok(publish(b, [{ id: "d1", score: 640, driven_on: day() }, { id: "d2", score: 702, driven_on: day() }, { id: "old", score: 900, driven_on: "2020-01-05" }]));
    await ok(publish(b, [{ id: "d2", score: 710, driven_on: day() }]));   // the same drive again replaces, never doubles
    await ok(publish(a, [{ id: "a1", score: 500, driven_on: day() }]));
    expect((await (await publish(c, [{ id: "c1", score: 999, driven_on: day() }])).json())).toEqual({ published: 0, crews: [] });   // carol shares nothing
    const m = await board(a, crew);
    expect(m.period).toBe("month");
    expect(m.rows.map((r) => [r.handle, r.total, r.drives, r.mine])).toEqual([["bob", 1350, 2, false], ["alice", 500, 1, true], ["carol", null, 0, false]]);
    expect(m.rows[0]).toHaveProperty("photo_id");
    expect((await board(a, crew, "all")).rows[0]).toMatchObject({ handle: "bob", total: 2250, drives: 3 });
    // the old page board is unchanged for old builds
    expect(((await (await ok(api(a, "GET", `/api/crews/${crew}/page`))).json()) as any).board.map((r: any) => r.handle)).toEqual(["alice", "bob", "carol"]);
    expect((await api(out, "GET", `/api/crews/${crew}/board`)).status).toBe(404);
    expect((await api(a, "GET", `/api/crews/${crew}/board?period=decade`)).status).toBe(400);
    // switching the grant off takes the totals with it; carol switching on later doesn't bring back what she sent before
    await share(b, crew, false); await share(c, crew);
    expect((await board(a, crew, "all")).rows.map((r) => [r.handle, r.total])).toEqual([["alice", 500], ["bob", null], ["carol", null]]);
    // leaving the crew removes yours
    await ok(publish(c, [{ id: "c2", score: 300, driven_on: day() }]));
    await ok(api(c, "DELETE", `/api/crews/${crew}/membership`));
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM drive_scores WHERE user_id = ?").bind(c.id).first<{ n: number }>())!.n).toBe(0);
  });

  it("week, month, year, all time", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    const crew = await crewOf(a, b);
    await share(b, crew);
    const now = new Date(), y = now.getUTCFullYear();
    await ok(publish(b, [{ id: "t", score: 100, driven_on: day() }, { id: "w", score: 200, driven_on: day(-8) }, { id: "y", score: 400, driven_on: `${y}-01-01` }, { id: "o", score: 800, driven_on: `${y - 3}-06-01` }]));
    const tot = async (p: string) => (await board(a, crew, p)).rows.find((r) => r.handle === "bob").total;
    const inMonth = (d: string) => d.slice(0, 7) === day().slice(0, 7), inYear = (d: string) => d.slice(0, 4) === String(y);
    expect(await tot("week")).toBe(100);
    expect(await tot("month")).toBe(100 + (inMonth(day(-8)) ? 200 : 0) + (inMonth(`${y}-01-01`) ? 400 : 0));
    expect(await tot("year")).toBe(100 + (inYear(day(-8)) ? 200 : 0) + 400);
    expect(await tot("all")).toBe(1500);
  });

  it("bad input; blocked people left out; account deletion and export", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    const crew = await crewOf(a, b);
    await share(b, crew);
    expect((await publish(b, [{ id: "x", score: 1001, driven_on: day() }])).status).toBe(400);
    expect((await publish(b, [{ id: "x", score: 10, driven_on: "yesterday!" }])).status).toBe(400);
    expect((await api(b, "POST", "/api/drives/scores", { drives: Array.from({ length: 51 }, (_, i) => ({ id: `d${i}`, score: 1, driven_on: day() })) })).status).toBe(400);
    await ok(publish(b, [{ id: "x", score: 10, driven_on: day() }]));
    const ex = (await (await ok(api(b, "GET", "/api/me/export"))).json()) as any;
    expect(ex.drive_scores_shared).toEqual([expect.objectContaining({ crew: "Ridge Runners", score: 10 })]);
    await ok(api(a, "POST", "/api/blocks", { handle: "bob" }));
    expect((await board(a, crew)).rows.map((r) => r.handle)).toEqual(["alice"]);
    await ok(api(b, "DELETE", "/api/me", { confirm: "DELETE" }));
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM drive_scores").first<{ n: number }>())!.n).toBe(0);
  });
});
