// Hazards reported by hand (src/hazards.ts, IDEAS Q-15) and "still there?" votes (Q-16).
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeUser, ok, type TestUser } from "./helpers";
import { LIFE_MIN, MAX_PER_DAY } from "../src/hazards";

beforeEach(freshDb);
type Msg = Record<string, any>;
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as Msg;
const report = (u: TestUser, b: Record<string, unknown>) => api(u, "POST", "/api/hazards", b);
const near = (u: TestUser, lat = 35.6, lon = -83.9, km = 5) => json(api(u, "GET", `/api/hazards?lat=${lat}&lon=${lon}&km=${km}`));
const vote = (u: TestUser, id: string, still: boolean) => api(u, "POST", `/api/hazards/${id}/vote`, { still });
const P = { lat: 35.6, lon: -83.9 };

describe("hand-reported hazards", () => {
  it("members report and see hazards nearby, never who reported them", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob");
    const r = await json(report(a, { kind: "gravel", ...P, heading: 92 }));
    expect(r.confirmed).toBe(false);
    const list = await near(b);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: r.id, kind: "gravel", heading: 92, confirms: 1, clears: 0, m: 0 });
    expect(JSON.stringify(list)).not.toMatch(/alice|reported_by/);
    expect(await near(b, 36.6, -83.9)).toEqual([]);                               // 110 km away
    expect((await api(null, "GET", `/api/hazards?lat=35.6&lon=-83.9`)).status).toBe(401);
  });

  it("the same kind within 50 m confirms the live one instead of adding another", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob");
    const first = await json(report(a, { kind: "debris", ...P }));
    const again = await json(report(b, { kind: "debris", lat: P.lat + 30 / 110540, lon: P.lon }));   // 30 m north
    expect(again).toEqual({ id: first.id, confirmed: true });
    const other = await json(report(b, { kind: "animal", ...P }));                    // another kind is its own report
    expect(other.confirmed).toBe(false);
    const list = await near(a);
    expect(list.find((h: Msg) => h.kind === "debris").confirms).toBe(2);
    expect(list).toHaveLength(2);
  });

  it("refuses bad reports and caps reports per day", async () => {
    const a = await makeUser("alice");
    expect((await report(a, { kind: "aliens", ...P })).status).toBe(400);
    expect((await report(a, { kind: "pothole", lat: 95, lon: 0 })).status).toBe(400);
    expect((await report(a, { kind: "pothole", ...P, heading: 400 })).status).toBe(400);
    for (let i = 0; i < MAX_PER_DAY; i++) await ok(report(a, { kind: "pothole", lat: P.lat + i * 0.01, lon: P.lon }));
    expect((await report(a, { kind: "pothole", lat: 40, lon: -80 })).status).toBe(429);
  });

  it("still-there votes extend it; two 'gone' votes outvoting confirmations end it; one vote per person", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob"), c = await makeUser("carol");
    const { id } = await json(report(a, { kind: "police", ...P }));
    const exp0 = (await env.DB.prepare("SELECT expires_at FROM hazard_reports WHERE id = ?").bind(id).first<{ expires_at: string }>())!.expires_at;
    await env.DB.prepare("UPDATE hazard_reports SET expires_at = datetime('now', '+5 minutes') WHERE id = ?").bind(id).run();
    await ok(vote(b, id, true));
    const exp1 = (await env.DB.prepare("SELECT expires_at, confirms FROM hazard_reports WHERE id = ?").bind(id).first<{ expires_at: string; confirms: number }>())!;
    expect(exp1.confirms).toBe(2);
    expect(exp1.expires_at >= exp0.slice(0, 16)).toBe(true);                         // pushed back out to a full LIFE_MIN.police
    await ok(vote(b, id, true));                                                      // the same vote twice counts once
    expect((await near(a))[0].confirms).toBe(2);
    await ok(vote(b, id, false)); await ok(vote(c, id, false));                      // bob changes his mind; carol agrees: 2 gone vs 1
    expect(await near(a)).toEqual([]);
    expect((await vote(c, id, true)).status).toBe(404);                               // ended
    expect(LIFE_MIN.police).toBe(60);
  });

  it("deleting the account keeps the report but not who made it", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob");
    await ok(report(a, { kind: "pothole", ...P }));
    await ok(api(a, "DELETE", "/api/me", { confirm: "DELETE" }));
    expect((await near(b))[0].kind).toBe("pothole");
    expect((await env.DB.prepare("SELECT reported_by FROM hazard_reports").first<{ reported_by: string | null }>())!.reported_by).toBeNull();
  });
});
