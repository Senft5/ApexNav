// Hazards reported by hand (src/hazards.ts, IDEAS Q-15) and "still there?" votes (Q-16).
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeUser, ok, type TestUser } from "./helpers";
import { LIFE_MIN, MAX_PER_DAY, REVIEW_USER_ID } from "../src/hazards";
import { sha256hex } from "../src/util";

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

  it("a report sent late (made with no signal, IDEAS F-05) lives from when it was made; one past its life is refused", async () => {
    const a = await makeUser("alice");
    const r = await json(report(a, { kind: "animal", ...P, age_s: 20 * 60 }));     // animals live 30 min: 10 min left
    const row = await env.DB.prepare("SELECT (julianday(expires_at) - julianday('now')) * 1440 AS left_min FROM hazard_reports WHERE id = ?")
      .bind(r.id).first<{ left_min: number }>();
    expect(row!.left_min).toBeGreaterThan(9); expect(row!.left_min).toBeLessThan(11);
    expect((await report(a, { kind: "animal", lat: 36, lon: -83, age_s: LIFE_MIN.animal * 60 })).status).toBe(410);
    expect((await report(a, { kind: "animal", lat: 36, lon: -83, age_s: -5 })).status).toBe(400);
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

  it("the review recording's account (U-94): its reports and votes are answered as taken and change nothing", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob");
    const review: TestUser = { id: REVIEW_USER_ID, handle: "vetta_review", token: "tok-review" };   // the real account's id
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, google_sub, email, handle, display_name) VALUES (?, 'review:vetta-recording', 'review@example.test', 'vetta_review', 'Vetta Review')").bind(REVIEW_USER_ID),
      env.DB.prepare("INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))").bind(await sha256hex(review.token), REVIEW_USER_ID),
      env.DB.prepare("INSERT INTO members (user_id) VALUES (?)").bind(REVIEW_USER_ID),
    ]);
    const r = await json(report(review, { kind: "gravel", ...P, heading: 92 }));   // 201, as for anyone
    expect(r.confirmed).toBe(false);
    expect(r.id).toMatch(/^review_/);
    expect(await near(b)).toEqual([]);                                              // nobody hears about it
    const real = await json(report(a, { kind: "pothole", ...P }));
    expect(await json(report(review, { kind: "pothole", ...P }))).toMatchObject({ confirmed: false });   // never confirms a real one
    await ok(vote(review, real.id, true)); await ok(vote(review, real.id, false));
    expect((await near(b))[0]).toMatchObject({ id: real.id, confirms: 1, clears: 0 });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM hazard_votes").first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM hazard_reports WHERE reported_by = ?").bind(REVIEW_USER_ID).first<{ n: number }>())!.n).toBe(0);
    expect((await report(review, { kind: "aliens", ...P })).status).toBe(400);    // still the same checks
  });
});
