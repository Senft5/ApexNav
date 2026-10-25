import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeSegment, makeUser, ok } from "./helpers";

beforeEach(freshDb);

const count = async (sql: string, ...a: unknown[]) => (await env.DB.prepare(sql).bind(...a).first<{ n: number }>())!.n;

async function world() {
  const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("carol")];
  await befriend(a, b); await befriend(a, c);
  const seg = await makeSegment(a);
  await ok(api(a, "PUT", "/api/grants", { audience_type: "friend", audience_id: b.id, share_scores: true }));
  await ok(api(a, "POST", "/api/board", { segment_id: seg, driver_score: 800, driven_on: "2026-10-20" }));
  await ok(api(b, "PUT", "/api/grants", { audience_type: "friend", audience_id: a.id, share_scores: true }));
  const crew = ((await (await ok(api(a, "POST", "/api/crews", { name: "Ridge Runners" }))).json()) as { id: string }).id;
  const tok = ((await (await ok(api(a, "POST", `/api/crews/${crew}/invite`))).json()) as { token: string }).token;
  await ok(api(b, "POST", "/api/crews/join", { token: tok }));
  await ok(api(b, "PUT", "/api/grants", { audience_type: "crew", audience_id: crew, share_scores: true }));
  const bSeg = await makeSegment(b, "Bob's stretch");
  await ok(api(b, "POST", "/api/board", { segment_id: bSeg, driver_score: 600, driven_on: "2026-10-20" }));
  await ok(api(a, "POST", "/api/highlights", { name: "Hawk Overlook", category: "overlook", lat: 39.26, lon: -84.6 }));
  await env.DB.prepare("INSERT INTO points_ledger (user_id, iso_week, octane) VALUES (?, '2026-W43', 3)").bind(a.id).run();
  return { a, b, c, seg, bSeg, crew };
}

describe("data export", () => {
  it("contains my own data and no other person's email or private rows", async () => {
    const { a, b } = await world();
    const raw = await (await ok(api(a, "GET", "/api/me/export"))).text();
    const data = JSON.parse(raw);
    expect(data.profile.email).toBe("alice@example.test");
    expect(data.segments).toHaveLength(1);
    expect(data.friends.map((f: { handle: string }) => f.handle).sort()).toEqual(["bob", "carol"]);
    expect(data.points_by_week[0].octane).toBe(3);
    expect(raw).not.toContain("bob@example.test");
    expect(raw).not.toContain(b.id);                                  // other people appear only as the handle they already show me
    expect(raw).not.toContain("Bob's stretch");
    expect((await api(null, "GET", "/api/me/export")).status).toBe(401);
  });
});

describe("account deletion", () => {
  it("needs an explicit confirmation", async () => {
    const { a } = await world();
    expect((await api(a, "DELETE", "/api/me", {})).status).toBe(400);
    expect((await api(a, "DELETE", "/api/me", { confirm: "yes" })).status).toBe(400);
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE id = ?", a.id)).toBe(1);
  });

  it("removes everything tied to the person and leaves other people's data intact", async () => {
    const { a, b, c, crew, seg } = await world();
    expect((await api(a, "DELETE", "/api/me", { confirm: "DELETE" })).status).toBe(204);
    expect(await (await api(a, "GET", "/api/me")).json()).toEqual({ signed_in: false });          // the session is gone too

    // no table keeps a row that points at Alice
    const checks: [string, string][] = [["users", "id"], ["sessions", "user_id"], ["members", "user_id"], ["segments", "owner"], ["grants", "user_id"],
      ["board_entries", "user_id"], ["highlights", "author_id"], ["points_ledger", "user_id"], ["crew_members", "user_id"], ["crews", "owner"],
      ["invites", "created_by"], ["ingest_pending", "user_id"]];
    for (const [t, col] of checks) expect(await count(`SELECT COUNT(*) AS n FROM ${t} WHERE ${col} = ?`, a.id), `${t}.${col}`).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM friendships WHERE user_a = ?1 OR user_b = ?1", a.id)).toBe(0);
    // what others had pointed at her (no foreign key) is gone
    expect(await count("SELECT COUNT(*) AS n FROM grants WHERE audience_id = ?", a.id)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM board_entries WHERE audience_id = ?", a.id)).toBe(0);
    // the crew she owned is dissolved, with grants and results published to it
    expect(await count("SELECT COUNT(*) AS n FROM crews WHERE id = ?", crew)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM grants WHERE audience_id = ?", crew)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM board_entries WHERE audience_id = ?", crew)).toBe(0);
    // Bob and Carol are untouched
    for (const u of [b, c]) expect(await (await api(u, "GET", "/api/me")).json()).toMatchObject({ signed_in: true });
    expect(await (await ok(api(b, "GET", "/api/segments"))).json()).toHaveLength(1);
    expect(await (await ok(api(b, "GET", `/api/board/${seg}`))).json()).toEqual([]);              // Alice's published result is gone from Bob's view
  });

  it("promotes nothing it should not: a frozen road's anonymous merged data stays", async () => {
    const { a } = await world();
    await env.DB.prepare("INSERT INTO road_bins (way_id, dir, bin_idx, n, rough_mean) VALUES (5001, 0, 0, 2, 0.05)").run();
    await ok(api(a, "DELETE", "/api/me", { confirm: "DELETE" }));
    expect(await count("SELECT COUNT(*) AS n FROM road_bins")).toBe(1);
  });
});
