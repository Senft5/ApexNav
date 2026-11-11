// Sharing on by default (the owner, 2026-11-11; src/share_defaults.ts): friends and private crews start with Scores and
// Times shared, a public crew with nothing, a choice made (on or off) is never overwritten, never across a block.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeUser, ok, splitSql, type TestUser } from "./helpers";
import backfill from "../migrations/0050_share_backfill.sql?raw";

type G = { audience_type: string; audience_id: string; share_scores: number; share_times: number };
beforeEach(freshDb);
const grants = async (u: TestUser) => ((await (await ok(api(u, "GET", "/api/grants"))).json()) as G[]).map((g) => `${g.audience_type}:${g.audience_id}:${g.share_scores}${g.share_times}`).sort();

describe("sharing defaults", () => {
  it("a private crew: its owner and everyone who joins share Scores and Times with it; a public crew: nobody, until they say", async () => {
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara")];
    const priv = ((await (await ok(api(a, "POST", "/api/crews", { name: "Ridge Runners" }))).json()) as { id: string }).id;
    const tok = ((await (await ok(api(a, "POST", `/api/crews/${priv}/invite`))).json()) as { token: string }).token;
    await ok(api(b, "POST", "/api/crews/join", { token: tok }));
    expect(await grants(a)).toEqual([`crew:${priv}:11`, `friend:${b.id}:11`]);
    expect(await grants(b)).toEqual([`crew:${priv}:11`, `friend:${a.id}:11`]);
    const pub = ((await (await ok(api(c, "POST", "/api/crews", { name: "Open Road", visibility: "public", area: { name: "Knoxville", lat: 35.96, lon: -83.92 } }))).json()) as { id: string }).id;
    expect(await grants(c)).toEqual([]);
    const j = await (await ok(api(b, "POST", `/api/crews/${pub}/join`))).json();
    expect(j).toEqual({ id: pub });
    expect((await grants(b)).filter((g) => g.includes(pub))).toEqual([]);
    const link = ((await (await ok(api(c, "POST", `/api/crews/${pub}/invite`))).json()) as { token: string }).token;
    expect(await (await ok(api(a, "POST", "/api/crews/join", { token: link }))).json()).toEqual({ id: pub, friend: "cara", public: true });
    expect((await grants(a)).filter((g) => g.includes(pub))).toEqual([]);              // the phone asks
  });

  it("a private crew made public: members' sharing goes back to off and what they published to it goes; the owner's stays", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    const crew = ((await (await ok(api(a, "POST", "/api/crews", { name: "Ridge Runners" }))).json()) as { id: string }).id;
    const tok = ((await (await ok(api(a, "POST", `/api/crews/${crew}/invite`))).json()) as { token: string }).token;
    await ok(api(b, "POST", "/api/crews/join", { token: tok }));
    await env.DB.prepare(`INSERT INTO segments (id, owner, name, length_m, geom, start_lat, start_lon, end_lat, end_lon) VALUES ('s1', ?, 'Esses', 3000, '[[1,2]]', 1, 2, 3, 4), ('s2', ?, 'Esses', 3000, '[[1,2]]', 1, 2, 3, 4)`).bind(a.id, b.id).run();
    for (const [u, seg] of [[a, "s1"], [b, "s2"]] as const) {
      await ok(api(u, "POST", "/api/board", { segment_id: seg, driver_score: 800, time_s: 200, driven_on: "2026-11-01" }));
      await ok(api(u, "POST", "/api/drives/scores", { drives: [{ id: `d-${seg}`, score: 800, driven_on: "2026-11-01" }] }));
    }
    const count = async (sql: string, u: TestUser) => (await env.DB.prepare(sql).bind(crew, u.id).first<{ n: number }>())!.n;
    const published = (u: TestUser) => Promise.all([count("SELECT COUNT(*) AS n FROM board_entries WHERE audience_type = 'crew' AND audience_id = ? AND user_id = ?", u),
      count("SELECT COUNT(*) AS n FROM drive_scores WHERE crew_id = ? AND user_id = ?", u)]);
    expect([await published(a), await published(b)]).toEqual([[1, 1], [1, 1]]);
    await ok(api(a, "PUT", `/api/crews/${crew}`, { visibility: "public", area: { name: "Robbinsville", lat: 35.33, lon: -83.81 } }));
    expect((await grants(b)).filter((g) => g.includes(crew))).toEqual([`crew:${crew}:00`]);
    expect((await grants(a)).filter((g) => g.includes(crew))).toEqual([`crew:${crew}:11`]);    // the owner made it public
    expect([await published(a), await published(b)]).toEqual([[1, 1], [0, 0]]);
    const page = await (await ok(api(b, "GET", `/api/crews/${crew}/page`))).json() as { visibility: string; sharing_scores: boolean };
    expect([page.visibility, page.sharing_scores]).toEqual(["public", false]);                    // the page asks
    // public to private and back: only a flip from private clears; a member who said yes since keeps it until then
    await ok(api(b, "PUT", "/api/grants", { audience_type: "crew", audience_id: crew, share_scores: true }));
    await ok(api(a, "PUT", `/api/crews/${crew}`, { visibility: "public", area: { name: "Robbinsville", lat: 35.33, lon: -83.81 }, about: "Sundays" }));
    expect((await grants(b)).filter((g) => g.includes(crew))).toEqual([`crew:${crew}:10`]);
  });

  it("the backfill (migration 0050): existing friends and private crews share; a row already set stays; blocks and public crews don't", async () => {
    const [a, b, c, x] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara"), await makeUser("xavier")];
    // the old world: friendships and crews made with no grants
    const pair = (p: TestUser, q: TestUser) => (p.id < q.id ? [p.id, q.id] : [q.id, p.id]);
    for (const [p, q] of [[a, b], [a, c], [a, x]] as const)
      await env.DB.prepare("INSERT INTO friendships (user_a, user_b, status, requested_by) VALUES (?, ?, 'accepted', ?)").bind(...pair(p, q), p.id).run();
    await env.DB.prepare("INSERT INTO blocks (blocker, blocked) VALUES (?, ?)").bind(x.id, a.id).run();
    await env.DB.prepare("INSERT INTO crews (id, name, owner, visibility) VALUES ('kp', 'Private', ?, 'private'), ('kq', 'Public', ?, 'public')").bind(a.id, a.id).run();
    await env.DB.prepare("INSERT INTO crew_members (crew_id, user_id, role) VALUES ('kp', ?, 'owner'), ('kp', ?, 'member'), ('kq', ?, 'owner'), ('kq', ?, 'member')").bind(a.id, b.id, a.id, c.id).run();
    await env.DB.prepare("INSERT INTO grants (user_id, audience_type, audience_id, share_scores, share_times) VALUES (?, 'friend', ?, 0, 0)").bind(c.id, a.id).run();   // cara said no
    await env.DB.prepare("DELETE FROM grants WHERE NOT (user_id = ? AND audience_id = ?)").bind(c.id, a.id).run();
    await env.DB.batch(splitSql(backfill).map((q) => env.DB.prepare(q)));
    expect(await grants(a)).toEqual([`crew:kp:11`, `friend:${b.id}:11`, `friend:${c.id}:11`].sort());
    expect(await grants(b)).toEqual([`crew:kp:11`, `friend:${a.id}:11`].sort());
    expect(await grants(c)).toEqual([`friend:${a.id}:00`]);
    expect(await grants(x)).toEqual([]);
  });

  it("an off switch stays off; a block shares nothing", async () => {
    const [a, b, x] = [await makeUser("alice"), await makeUser("bob"), await makeUser("xavier")];
    await befriend(a, b);
    await ok(api(a, "PUT", "/api/grants", { audience_type: "friend", audience_id: b.id, share_scores: true, share_times: false }));
    await ok(api(b, "PUT", "/api/grants", { audience_type: "friend", audience_id: a.id, share_scores: false }));
    await ok(api(a, "POST", "/api/friends/request", { handle: "bob" }));               // asked again: nothing changes
    expect(await grants(a)).toEqual([`friend:${b.id}:10`]);
    expect(await grants(b)).toEqual([`friend:${a.id}:00`]);
    // a block between two people who would otherwise be befriended by a link: no friendship, no grant
    await ok(api(x, "POST", "/api/blocks", { handle: "alice" }));
    const { token } = (await (await ok(api(a, "POST", "/api/invites"))).json()) as { token: string };
    await api(x, "POST", "/api/invites/redeem", { token });
    expect(await grants(x)).toEqual([]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM grants WHERE user_id = ? AND audience_id = ?").bind(a.id, x.id).first<{ n: number }>())!.n).toBe(0);
  });
});
