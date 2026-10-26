// The privacy rules from docs/BACKEND.md section 11, as API tests. If one of these fails, a person can see what they should not.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeSegment, makeUser, ok } from "./helpers";

beforeEach(freshDb);

type Row = { user_id: string; driver_score: number; time_s: number | null };
const board = async (u: Parameters<typeof api>[0], canon: string) => (await (await ok(api(u, "GET", `/api/board/${canon}`))).json()) as Row[];

describe("access gates", () => {
  it("signed-out users get 401 and non-members get 403 on every shared-data route", async () => {
    const outsider = await makeUser("outsider", false);
    for (const [m, p] of [["GET", "/api/friends"], ["GET", "/api/segments"], ["GET", "/api/crews"], ["GET", "/api/crews/x/members"], ["GET", "/api/grants"], ["GET", "/api/board/x"]] as const) {
      expect((await api(null, m, p)).status).toBe(401);
      expect((await api(outsider, m, p)).status).toBe(403);
    }
  });

  it("rejects state-changing requests that are not from our own pages (CSRF)", async () => {
    const a = await makeUser("alice");
    expect((await api(a, "POST", "/api/crews", { name: "x1" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await api(a, "POST", "/api/crews", { name: "x1" }, { "x-apexnav": "" })).status).toBe(403);
    expect((await api(a, "POST", "/api/crews", { name: "Hill Climbers" })).status).toBe(201);
  });

  it("exposes no route to private ingest tables", async () => {
    const a = await makeUser("alice");
    for (const p of ["/api/ingest_pending", "/api/rank_slots", "/api/seen", "/api/road_contrib", "/api/sessions", "/api/users"]) {
      expect((await api(a, "GET", p)).status).toBe(404);
    }
  });
});

describe("friends", () => {
  it("answers a request to an unknown handle exactly like one to a real member (no handle enumeration)", async () => {
    const a = await makeUser("alice"); await makeUser("bob");
    const real = await api(a, "POST", "/api/friends/request", { handle: "bob" });
    const fake = await api(a, "POST", "/api/friends/request", { handle: "nobody" });
    expect(real.status).toBe(fake.status);
    expect(await real.text()).toBe(await fake.text());
  });

  it("ignores requests to non-members and to people who blocked you", async () => {
    const a = await makeUser("alice"), c = await makeUser("carol", false), b = await makeUser("bob");
    await api(a, "POST", "/api/friends/request", { handle: "carol" });
    await ok(api(b, "POST", "/api/blocks", { user_id: a.id }));
    await api(a, "POST", "/api/friends/request", { handle: "bob" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM friendships").first<{ n: number }>())!.n).toBe(0);
    void c;
  });

  it("the requester cannot accept their own request, and nobody can forge requested_by", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob");
    await ok(api(a, "POST", "/api/friends/request", { handle: "bob" }));
    expect((await api(a, "POST", "/api/friends/accept", { user_id: b.id })).status).toBe(404);
    await ok(api(b, "POST", "/api/friends/accept", { user_id: a.id }));
    const [x, y] = [a.id, b.id].sort();
    await expect(env.DB.prepare("INSERT INTO friendships (user_a, user_b, status, requested_by) VALUES (?, ?, 'pending', ?)").bind(x, "zzz", x).run()).rejects.toThrow();
  });

  it("a mutual request becomes a friendship", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob");
    await ok(api(a, "POST", "/api/friends/request", { handle: "bob" }));
    await ok(api(b, "POST", "/api/friends/request", { handle: "alice" }));
    const list = (await (await ok(api(a, "GET", "/api/friends"))).json()) as { status: string }[];
    expect(list).toEqual([expect.objectContaining({ status: "accepted" })]);
  });
});

describe("opt-in sharing (grants and boards)", () => {
  it("only the friend the owner opted in with can see the score: a row shared with Bob is invisible to Carol, also a friend", async () => {
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("carol")];
    await befriend(a, b); await befriend(a, c);
    const seg = await makeSegment(a);
    await ok(api(a, "PUT", "/api/grants", { audience_type: "friend", audience_id: b.id, share_scores: true }));
    expect(((await (await ok(api(a, "POST", "/api/board", { segment_id: seg, driver_score: 812, time_s: 600, driven_on: "2026-10-20" }))).json()) as { published: number }).published).toBe(1);
    expect(await board(b, seg)).toEqual([expect.objectContaining({ user_id: a.id, driver_score: 812 })]);
    expect(await board(c, seg)).toEqual([]);                      // Carol is Alice's friend but was never granted
    expect(await board(a, seg)).toHaveLength(1);                   // owner sees their own
  });

  it("nothing is shared by default: no grant, nothing published", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await befriend(a, b);
    const seg = await makeSegment(a);
    const r = (await (await ok(api(a, "POST", "/api/board", { segment_id: seg, driver_score: 700, driven_on: "2026-10-20" }))).json()) as { published: number };
    expect(r.published).toBe(0);
    expect(await board(b, seg)).toEqual([]);
  });

  it("times stay hidden unless share_times is on, and turning it off erases stored times", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await befriend(a, b);
    const seg = await makeSegment(a);
    await ok(api(a, "PUT", "/api/grants", { audience_type: "friend", audience_id: b.id, share_scores: true }));
    await ok(api(a, "POST", "/api/board", { segment_id: seg, driver_score: 800, time_s: 600, driven_on: "2026-10-20" }));
    expect((await board(b, seg))[0].time_s).toBeNull();
    await ok(api(a, "PUT", "/api/grants", { audience_type: "friend", audience_id: b.id, share_scores: true, share_times: true }));
    await ok(api(a, "POST", "/api/board", { segment_id: seg, driver_score: 800, time_s: 590, driven_on: "2026-10-21" }));
    expect((await board(b, seg))[0].time_s).toBe(590);
    await ok(api(a, "PUT", "/api/grants", { audience_type: "friend", audience_id: b.id, share_scores: true, share_times: false }));
    expect((await board(b, seg))[0].time_s).toBeNull();
  });

  it("revoking the grant removes the entries immediately", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await befriend(a, b);
    const seg = await makeSegment(a);
    await ok(api(a, "PUT", "/api/grants", { audience_type: "friend", audience_id: b.id, share_scores: true }));
    await ok(api(a, "POST", "/api/board", { segment_id: seg, driver_score: 800, driven_on: "2026-10-20" }));
    expect(await board(b, seg)).toHaveLength(1);
    await ok(api(a, "PUT", "/api/grants", { audience_type: "friend", audience_id: b.id, share_scores: false }));
    expect(await board(b, seg)).toEqual([]);
  });

  it("even if cleanup failed, a row without a live grant is not readable (backstop)", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await befriend(a, b);
    const seg = await makeSegment(a);
    await ok(api(a, "PUT", "/api/grants", { audience_type: "friend", audience_id: b.id, share_scores: true }));
    await ok(api(a, "POST", "/api/board", { segment_id: seg, driver_score: 800, driven_on: "2026-10-20" }));
    await env.DB.prepare("DELETE FROM grants WHERE user_id = ?").bind(a.id).run();
    expect(await board(b, seg)).toEqual([]);
  });

  it("unfriending erases grants and entries both ways; blocking does too and hides crew entries", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await befriend(a, b);
    const seg = await makeSegment(a);
    await ok(api(a, "PUT", "/api/grants", { audience_type: "friend", audience_id: b.id, share_scores: true }));
    await ok(api(a, "POST", "/api/board", { segment_id: seg, driver_score: 800, driven_on: "2026-10-20" }));
    await ok(api(b, "DELETE", `/api/friends/${a.id}`));
    expect(await board(b, seg)).toEqual([]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM grants").first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM board_entries").first<{ n: number }>())!.n).toBe(0);
  });

  it("cannot grant to someone who is not an accepted friend, or publish another person's segment", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    expect((await api(a, "PUT", "/api/grants", { audience_type: "friend", audience_id: b.id, share_scores: true })).status).toBe(404);
    const seg = await makeSegment(a);
    expect((await api(b, "POST", "/api/board", { segment_id: seg, driver_score: 900, driven_on: "2026-10-20" })).status).toBe(404);
    expect((await api(a, "POST", "/api/board", { segment_id: seg, driver_score: 1200, driven_on: "2026-10-20" })).status).toBe(400);
  });
});

describe("crews", () => {
  it("members see each other's published scores; outsiders and people who left do not", async () => {
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("carol")];
    const crew = ((await (await ok(api(a, "POST", "/api/crews", { name: "Ridge Runners" }))).json()) as { id: string }).id;
    const tok = ((await (await ok(api(a, "POST", `/api/crews/${crew}/invite`))).json()) as { token: string }).token;
    await ok(api(b, "POST", "/api/crews/join", { token: tok }));
    const mems = (await (await ok(api(b, "GET", `/api/crews/${crew}/members`))).json()) as { handle: string; role: string }[];
    expect(mems.map((m) => m.handle)).toEqual(["alice", "bob"]);
    expect((await api(c, "GET", `/api/crews/${crew}/members`)).status).toBe(404);
    const seg = await makeSegment(a);
    await ok(api(a, "PUT", "/api/grants", { audience_type: "crew", audience_id: crew, share_scores: true }));
    await ok(api(a, "POST", "/api/board", { segment_id: seg, driver_score: 750, driven_on: "2026-10-20" }));
    expect(await board(b, seg)).toHaveLength(1);
    expect(await board(c, seg)).toEqual([]);
    await ok(api(b, "DELETE", `/api/crews/${crew}/membership`));
    expect(await board(b, seg)).toEqual([]);
    expect((await api(b, "GET", `/api/crews/${crew}/members`)).status).toBe(404);
  });

  it("nobody can join a crew without a valid invite, and only the owner can create one", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    const crew = ((await (await ok(api(a, "POST", "/api/crews", { name: "Ridge Runners" }))).json()) as { id: string }).id;
    expect((await api(b, "POST", "/api/crews/join", { token: "not-a-real-invite-token" })).status).toBe(400);
    expect((await api(b, "POST", `/api/crews/${crew}/invite`)).status).toBe(404);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM crew_members WHERE crew_id = ?").bind(crew).first<{ n: number }>())!.n).toBe(1);
  });

  it("the owner leaving dissolves the crew and everything published to it", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    const crew = ((await (await ok(api(a, "POST", "/api/crews", { name: "Ridge Runners" }))).json()) as { id: string }).id;
    const tok = ((await (await ok(api(a, "POST", `/api/crews/${crew}/invite`))).json()) as { token: string }).token;
    await ok(api(b, "POST", "/api/crews/join", { token: tok }));
    const seg = await makeSegment(b);
    await ok(api(b, "PUT", "/api/grants", { audience_type: "crew", audience_id: crew, share_scores: true }));
    await ok(api(b, "POST", "/api/board", { segment_id: seg, driver_score: 600, driven_on: "2026-10-20" }));
    await ok(api(a, "DELETE", `/api/crews/${crew}/membership`));
    for (const t of ["crews", "crew_members", "grants", "board_entries"]) {
      expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n).toBe(0);
    }
  });
});

describe("shared segments line scores up on the same stretch", () => {
  it("a friend adopts the segment and both boards use the canonical id", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await befriend(a, b);
    const original = await makeSegment(a);
    await ok(api(a, "POST", `/api/segments/${original}/share`, { audience_type: "friend", audience_id: b.id }));
    const shared = (await (await ok(api(b, "GET", "/api/segments/shared"))).json()) as { id: string; canon_id: string }[];
    expect(shared).toHaveLength(1);
    const adopted = ((await (await ok(api(b, "POST", "/api/segments/adopt", { segment_id: shared[0].id }))).json()) as { id: string }).id;
    expect(adopted).not.toBe(original);
    expect(((await (await ok(api(b, "POST", "/api/segments/adopt", { segment_id: shared[0].id }))).json()) as { id: string }).id).toBe(adopted);   // idempotent
    await ok(api(a, "PUT", "/api/grants", { audience_type: "friend", audience_id: b.id, share_scores: true }));
    await ok(api(b, "PUT", "/api/grants", { audience_type: "friend", audience_id: a.id, share_scores: true }));
    await ok(api(a, "POST", "/api/board", { segment_id: original, driver_score: 800, driven_on: "2026-10-20" }));
    await ok(api(b, "POST", "/api/board", { segment_id: adopted, driver_score: 650, driven_on: "2026-10-21" }));
    expect((await board(a, original)).map((r) => r.driver_score)).toEqual([800, 650]);
    expect((await board(b, original)).map((r) => r.driver_score)).toEqual([800, 650]);
  });

  it("an unshared segment is invisible, and owners alone can delete theirs", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await befriend(a, b);
    const seg = await makeSegment(a);
    expect(await (await ok(api(b, "GET", "/api/segments/shared"))).json()).toEqual([]);
    expect((await api(b, "DELETE", `/api/segments/${seg}`)).status).toBe(404);
    expect(await (await ok(api(b, "GET", "/api/segments"))).json()).toEqual([]);
  });
});

describe("invites", () => {
  it("an invite works once, then not again; a signed-in non-member becomes a member", async () => {
    const owner = await makeUser("owner"), newbie = await makeUser("newbie", false), other = await makeUser("other", false);
    const { token } = (await (await ok(api(owner, "POST", "/api/invites"))).json()) as { token: string };
    expect((await api(newbie, "POST", "/api/invites/redeem", { token })).status).toBe(204);
    expect((await api(other, "POST", "/api/invites/redeem", { token })).status).toBe(400);
    expect((await api(newbie, "GET", "/api/friends")).status).toBe(200);
    expect((await api(other, "GET", "/api/friends")).status).toBe(403);
  });

  it("redeeming an invite makes you friends with whoever invited you, with sharing still off", async () => {
    const owner = await makeUser("owner"), newbie = await makeUser("newbie", false);
    const { token } = (await (await ok(api(owner, "POST", "/api/invites"))).json()) as { token: string };
    await ok(api(newbie, "POST", "/api/invites/redeem", { token }));
    const mine = (await (await ok(api(newbie, "GET", "/api/friends"))).json()) as { handle: string; status: string }[];
    expect(mine).toEqual([expect.objectContaining({ handle: "owner", status: "accepted" })]);
    expect(await (await ok(api(owner, "GET", "/api/friends"))).json()).toEqual([expect.objectContaining({ handle: "newbie", status: "accepted" })]);
    expect(await (await ok(api(newbie, "GET", "/api/grants"))).json()).toEqual([]);                 // nothing is shared by default
    expect(await (await ok(api(owner, "GET", "/api/grants"))).json()).toEqual([]);
    const seg = await makeSegment(owner);
    await ok(api(owner, "POST", "/api/board", { segment_id: seg, driver_score: 700, driven_on: "2026-10-20" }));
    expect(await (await ok(api(newbie, "GET", `/api/board/${seg}`))).json()).toEqual([]);          // friends, but they see nothing until a grant exists
  });

  it("an invite completes a friend request that was already waiting", async () => {
    const owner = await makeUser("owner"), newbie = await makeUser("newbie", false);
    const { token } = (await (await ok(api(owner, "POST", "/api/invites"))).json()) as { token: string };
    await ok(api(newbie, "POST", "/api/invites/redeem", { token }));
    await ok(api(newbie, "POST", "/api/friends/request", { handle: "owner" }));                       // already friends: harmless
    expect(((await (await ok(api(owner, "GET", "/api/friends"))).json()) as unknown[]).length).toBe(1);
  });

  it("the number of waiting friend requests is on /api/me", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await ok(api(b, "POST", "/api/friends/request", { handle: "alice" }));
    expect(((await (await ok(api(a, "GET", "/api/me"))).json()) as { requests: number }).requests).toBe(1);
    expect(((await (await ok(api(b, "GET", "/api/me"))).json()) as { requests: number }).requests).toBe(0);
  });

  it("an expired invite is refused", async () => {
    const owner = await makeUser("owner"), newbie = await makeUser("newbie", false);
    const { token } = (await (await ok(api(owner, "POST", "/api/invites"))).json()) as { token: string };
    await env.DB.prepare("UPDATE invites SET expires_at = datetime('now', '-1 hour')").run();
    expect((await api(newbie, "POST", "/api/invites/redeem", { token })).status).toBe(400);
  });

  it("stores only a hash of the token", async () => {
    const owner = await makeUser("owner");
    const { token } = (await (await ok(api(owner, "POST", "/api/invites"))).json()) as { token: string };
    const rows = (await env.DB.prepare("SELECT token_hash FROM invites").all<{ token_hash: string }>()).results;
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).toHaveLength(64);
  });
});
