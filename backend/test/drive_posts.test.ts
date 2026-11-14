// Drive posts and the feed (src/drive_posts.ts): a post reaches friends or one crew, never anyone else; its line loses both
// ends; kudos once per person; comments with delete by their author or the post's; blocks hide both ways; reports hide and
// the owner's queue removes; Delete account takes it all and Download my data lists it.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeUser, ok, type TestUser } from "./helpers";
import { CUT_M, cutLine, decodeLine, encodeLine } from "../src/drive_posts";

beforeEach(freshDb);
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as any;
const today = new Date().toISOString().slice(0, 10);
// a straight 10 km line north, a point every ~111 m
const LINE: [number, number][] = Array.from({ length: 91 }, (_, i) => [35 + i * 0.001, -84]);
const POST = { title: "Cherohala Skyway", caption: "Fog on top, dry below.", driven_on: today, length_m: 10000, score: 812, roads: ["Cherohala Skyway"], stages: [{ name: "Esses", score: 840 }], line: encodeLine(LINE) };
const post = (u: TestUser, b: Record<string, unknown> = {}) => json(api(u, "POST", "/api/posts", { ...POST, ...b }));
const feedOf = async (u: TestUser) => (await json(api(u, "GET", "/api/feed"))) as any[];

describe("drive posts", () => {
  it("a post to friends reaches friends only, with its card; its line starts and ends 500 m in", async () => {
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara")];
    await befriend(a, b);
    const { id } = await post(a);
    const [p] = await feedOf(b);
    expect(p).toMatchObject({ id, handle: "alice", mine: false, crew: null, title: "Cherohala Skyway", caption: "Fog on top, dry below.", driven_on: today,
      length_m: 10000, score: 812, roads: ["Cherohala Skyway"], stages: [{ name: "Esses", score: 840 }], kudos: 0, my_kudos: false, comments: 0 });
    const pts = decodeLine(p.line);
    expect(pts[0][0]).toBeGreaterThan(35 + 0.0044);                          // about 500 m north of the start
    expect(pts[pts.length - 1][0]).toBeLessThan(35.09 - 0.0044);
    expect((await feedOf(a))[0]).toMatchObject({ id, mine: true });
    expect(await feedOf(c)).toEqual([]);
    expect((await api(c, "GET", `/api/posts/${id}`)).status).toBe(404);
  });

  it("a stage keeps its ends only where both lie on the line as kept: never in the cut ends, never off the line", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await befriend(a, b);
    await post(a, { stages: [
      { name: "Middle", score: 800, ends: [35.02, -84, 35.05, -84.0003] },          // on the line, 30 m off at the end: kept
      { name: "From home", score: 790, ends: [35.0005, -84, 35.03, -84] },          // starts inside the first 500 m: dropped
      { name: "Elsewhere", score: null, ends: [35.02, -84.01, 35.05, -84.01] }] });   // 900 m off the line: dropped
    const [p] = await feedOf(b);
    expect(p.stages).toEqual([{ name: "Middle", score: 800, ends: [35.02, -84, 35.05, -84.0003] }, { name: "From home", score: 790 },
      { name: "Elsewhere", score: null }]);
    expect((await api(a, "POST", "/api/posts", { ...POST, stages: [{ name: "x", score: 1, ends: "35,-84" }] })).status).toBe(201);   // odd ends: no ends, still posted
  });

  it("a friend's profile lists only their posts you can see (?author=), never a crew post from a crew you're not in", async () => {
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara")];
    await befriend(a, b); await befriend(b, c);
    const mine = (await post(a)).id;
    await post(c);                                                               // a friend of bob's, not of alice's
    const crew = (await json(api(a, "POST", "/api/crews", { name: "Ridge Runners" }))).id;
    await post(a, { crew_id: crew });                                            // bob isn't in it
    const of = async (who: TestUser, author: string) => (await json(api(who, "GET", `/api/feed?author=${author}`))).map((p: any) => p.id);
    expect(await of(b, a.id)).toEqual([mine]);
    expect(await of(a, c.id)).toEqual([]);                                       // not alice's friend: nothing
    expect((await api(b, "GET", "/api/feed?author=bad%20id")).status).toBe(400);
  });

  it("a post to a crew reaches that crew's members only; not to a crew you're not in", async () => {
    const [a, b, c, d] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara"), await makeUser("dan")];
    await befriend(a, d);
    const crew = (await json(api(a, "POST", "/api/crews", { name: "Ridge Runners" }))).id;
    const tok = (await json(api(a, "POST", `/api/crews/${crew}/invite`))).token;
    await ok(api(b, "POST", "/api/crews/join", { token: tok }));
    const { id } = await post(a, { crew_id: crew });
    expect((await feedOf(b))[0]).toMatchObject({ id, crew: { id: crew, name: "Ridge Runners" } });
    expect(await feedOf(d)).toEqual([]);                                       // a friend outside the crew doesn't see a crew post
    expect((await api(c, "POST", "/api/posts", { ...POST, crew_id: crew })).status).toBe(404);
  });

  it("a friend you turned sharing off for sees none of your posts; leaving a crew takes your posts out of it", async () => {
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara")];
    await befriend(a, b);
    await befriend(a, c);
    const { id } = await post(a);
    await ok(api(a, "PUT", "/api/grants", { audience_type: "friend", audience_id: b.id, share_scores: false }));
    expect(await feedOf(b)).toEqual([]);
    expect((await api(b, "GET", `/api/posts/${id}`)).status).toBe(404);
    expect((await feedOf(c)).map((p) => p.id)).toEqual([id]);                  // still shared with cara
    const crew = (await json(api(c, "POST", "/api/crews", { name: "Ridge Runners" }))).id;
    const tok = (await json(api(c, "POST", `/api/crews/${crew}/invite`))).token;
    await ok(api(a, "POST", "/api/crews/join", { token: tok }));
    const cp = (await post(a, { crew_id: crew })).id;
    expect((await feedOf(c)).map((p) => p.id)).toContain(cp);
    await ok(api(a, "DELETE", `/api/crews/${crew}/membership`));
    expect((await feedOf(c)).map((p) => p.id)).not.toContain(cp);
    expect((await feedOf(a)).map((p) => p.id)).toContain(cp);                // the author still has it
  });

  it("kudos once each, not on your own; comments, deleted by their author or the post's author", async () => {
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara")];
    await befriend(a, b); await befriend(a, c);
    const { id } = await post(a);
    for (let i = 0; i < 2; i++) expect((await api(b, "POST", `/api/posts/${id}/kudos`)).status).toBe(204);
    expect((await api(a, "POST", `/api/posts/${id}/kudos`)).status).toBe(400);
    const { id: c1 } = await json(api(b, "POST", `/api/posts/${id}/comments`, { body: "That fog!" }));
    const { id: c2 } = await json(api(c, "POST", `/api/posts/${id}/comments`, { body: "Next time." }));
    let full = await json(api(b, "GET", `/api/posts/${id}`));
    expect([full.kudos, full.my_kudos, full.comments]).toEqual([1, true, 2]);
    expect(full.comment_list.map((x: any) => [x.handle, x.body, x.mine, x.can_delete])).toEqual([["bob", "That fog!", true, true], ["cara", "Next time.", false, false]]);
    expect((await api(b, "DELETE", `/api/comments/${c2}`)).status).toBe(404);   // not bob's to delete
    expect((await api(a, "DELETE", `/api/comments/${c2}`)).status).toBe(204);   // the post's author may
    expect((await api(b, "DELETE", `/api/comments/${c1}`)).status).toBe(204);
    await ok(api(b, "DELETE", `/api/posts/${id}/kudos`));
    full = await json(api(b, "GET", `/api/posts/${id}`));
    expect([full.kudos, full.comments]).toEqual([0, 0]);
    expect((await api(b, "POST", `/api/posts/${id}/comments`, { body: "" })).status).toBe(400);
    expect((await api(b, "DELETE", `/api/posts/${id}`)).status).toBe(404);     // not bob's post
    expect((await api(a, "DELETE", `/api/posts/${id}`)).status).toBe(204);
    expect(await feedOf(b)).toEqual([]);
  });

  it("a block hides posts and comments both ways; reports hide a post and the owner's queue removes it", async () => {
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara")];
    await befriend(a, b); await befriend(a, c); await befriend(b, c);
    const { id } = await post(a);
    await ok(api(c, "POST", `/api/posts/${id}/comments`, { body: "Nice" }));
    await ok(api(b, "POST", "/api/blocks", { handle: "cara" }));
    const seen = await json(api(b, "GET", `/api/posts/${id}`));
    expect([seen.comments, seen.comment_list.length]).toEqual([0, 0]);      // cara's comment is gone for bob
    await ok(api(c, "POST", `/api/posts/${id}/kudos`));
    await env.DB.prepare("UPDATE drive_post_kudos SET created_at = datetime('now', '-1 minute')").run();   // cara's came first
    await ok(api(b, "POST", `/api/posts/${id}/kudos`));
    expect((await json(api(a, "GET", `/api/posts/${id}`))).kudos_from.map((k: any) => k.handle)).toEqual(["bob", "cara"]);   // newest first
    expect((await json(api(b, "GET", `/api/posts/${id}`))).kudos_from.map((k: any) => k.handle)).toEqual(["bob"]);           // never someone blocked
    const { id: mine } = await post(c);
    expect((await feedOf(b)).map((p) => p.id)).toEqual([id]);                  // and cara's post
    expect((await api(b, "POST", "/api/reports", { kind: "drive", target: id, reason: "spam" })).status).toBe(204);
    const owner = await makeUser("owner");
    const q = await json(api(owner, "GET", "/api/moderation"));
    expect(q.find((r: any) => r.kind === "drive")).toMatchObject({ target: id, label: expect.stringContaining("Cherohala Skyway") });
    await ok(api(owner, "POST", "/api/moderation/resolve", { kind: "drive", target: id, action: "remove" }));
    expect((await api(a, "GET", `/api/posts/${id}`)).status).toBe(404);
    expect(mine).toBeTruthy();
  });

  it("refuses what isn't a card: no title, a long caption, a day a month back, ten posts a day", async () => {
    const a = await makeUser("alice");
    for (const bad of [{ title: "" }, { caption: "x".repeat(281) }, { driven_on: "2020-01-01" }, { score: 1001 }, { roads: Array(9).fill("A") }, { line: "not a line" }])
      expect((await api(a, "POST", "/api/posts", { ...POST, ...bad })).status).toBe(400);
    for (let i = 0; i < 10; i++) await post(a);
    expect((await api(a, "POST", "/api/posts", POST)).status).toBe(429);
  });

  it("a line too short to show without its ends shows none", () => {
    expect(cutLine(LINE.slice(0, 9))).toBeNull();                           // under 1 km
    expect(CUT_M).toBe(500);
  });

  it("Download my data lists your posts and comments; Delete account takes them", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await befriend(a, b);
    const { id } = await post(a);
    await ok(api(b, "POST", `/api/posts/${id}/comments`, { body: "Good one" }));
    const mine = await json(api(b, "GET", "/api/me/export"));
    expect(mine.drive_post_comments).toEqual([expect.objectContaining({ on_post_by: "alice", post: "Cherohala Skyway", body: "Good one" })]);
    const hers = await json(api(a, "GET", "/api/me/export"));
    expect(hers.drive_posts).toEqual([expect.objectContaining({ title: "Cherohala Skyway", score: 812 })]);
    await ok(api(a, "DELETE", "/api/me", { confirm: "DELETE" }));
    const left = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM drive_posts) + (SELECT COUNT(*) FROM drive_comments) AS n").first<{ n: number }>();
    expect(left!.n).toBe(0);
  });
});

describe("this week on the Feed", () => {
  it("each driver's drives, distance and best Score since Monday, most distance first; a drive posted twice counts once; never a stranger or someone blocked", async () => {
    const [a, b, c, d] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara"), await makeUser("dan")];
    await befriend(a, b); await befriend(a, c);
    const crew = (await json(api(a, "POST", "/api/crews", { name: "Ridge Runners" }))).id;
    const t = (await json(api(a, "POST", `/api/crews/${crew}/invite`))).token;
    await ok(api(b, "POST", "/api/crews/join", { token: t }));
    await post(a, { length_m: 20000, score: 700 });
    await post(b, { length_m: 30000, score: 650 });
    await post(b, { length_m: 30000, score: 650, crew_id: crew });          // the same drive to the crew: once
    await post(b, { title: "Tail of the Dragon", length_m: 15000, score: 790 });
    await post(c, { length_m: 5000, score: null });
    await post(d, { length_m: 99000 });                                      // a stranger
    const old = new Date(Date.now() - 10 * 86400_000).toISOString().slice(0, 10);
    await post(c, { title: "Old one", driven_on: old, length_m: 90000 });  // before this week
    const week = await json(api(a, "GET", "/api/feed/week"));
    expect(week.map((r: any) => [r.handle, r.you, r.drives, r.length_m, r.best])).toEqual([
      ["bob", false, 2, 45000, 790], ["alice", true, 1, 20000, 700], ["cara", false, 1, 5000, null]]);
    await ok(api(a, "POST", "/api/blocks", { handle: "bob" }));
    expect((await json(api(a, "GET", "/api/feed/week"))).map((r: any) => r.handle)).toEqual(["alice", "cara"]);
  });
});

describe("a crew's posted drives", () => {
  it("?crew= lists only the posts to that crew, and only for its members", async () => {
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara")];
    await befriend(a, b); await befriend(a, c);
    const crew = (await json(api(a, "POST", "/api/crews", { name: "Ridge Runners" }))).id;
    const t = (await json(api(a, "POST", `/api/crews/${crew}/invite`))).token;
    await ok(api(b, "POST", "/api/crews/join", { token: t }));
    await post(a, { title: "To friends" });
    await post(a, { title: "To the crew", crew_id: crew });
    await post(b, { title: "Bob to the crew", crew_id: crew });
    expect((await json(api(b, "GET", `/api/feed?crew=${crew}`))).map((p: any) => p.title)).toEqual(["Bob to the crew", "To the crew"]);
    expect(await json(api(c, "GET", `/api/feed?crew=${crew}`))).toEqual([]);      // not a member
    expect((await api(b, "GET", "/api/feed?crew=bad%20id")).status).toBe(400);
  });
});
