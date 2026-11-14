// For you (src/inbox.ts): one list of what happened to you socially, made from what each part already shows you.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeSegment, makeUser, ok, type TestUser } from "./helpers";
import { duelOutcome, perPost } from "../src/inbox";
import { encodeLine, mentionsOf } from "../src/drive_posts";

beforeEach(freshDb);
type Msg = Record<string, any>;
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as any;
const inbox = async (u: TestUser) => (await json(api(u, "GET", "/api/inbox"))) as { items: Msg[]; waiting: number; now: string };
const kinds = (b: { items: Msg[] }) => b.items.map((i) => i.kind).sort();
const today = new Date().toISOString().slice(0, 10);
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const road = (lat = 35.5, lon = -83.9, n = 60) => Array.from({ length: n }, (_, i) => [lon + i * 1e-3, lat + Math.sin(i / 5) * 1e-3]);

describe("For you", () => {
  it("a friend tops your Score, gives kudos, accepts your duel; a request waits; blocks hide all of it", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob"), c = await makeUser("cara");
    await befriend(a, b);                                          // sharing is on by default between friends
    const seg = await makeSegment(a, "Dry Ridge climb");
    const { id } = await json(api(a, "POST", "/api/duels", { handle: "bob", segment_id: seg, days: 7 }));
    expect((await inbox(b)).items.map((i) => [i.kind, i.handle, i.stage, i.waiting])).toEqual([["duel_ask", "alice", "Dry Ridge climb", true]]);
    await ok(api(b, "POST", `/api/duels/${id}/accept`));
    const bSeg = ((await json(api(b, "GET", "/api/segments"))) as Msg[]).find((s) => s.origin_id === seg)!.id;
    await ok(api(a, "POST", "/api/board", { segment_id: seg, driver_score: 800, driven_on: today }));
    await ok(api(b, "POST", "/api/board", { segment_id: bSeg, driver_score: 850, driven_on: today }));
    await ok(api(b, "POST", "/api/kudos", { handle: "alice", canon_id: seg, driven_on: today }));
    await ok(api(c, "POST", "/api/friends/request", { handle: "alice" }));
    let got = await inbox(a);
    expect(kinds(got)).toEqual(["duel_on", "kudos", "request", "topped"]);
    expect(got.waiting).toBe(1);
    expect(got.items.find((i) => i.kind === "topped")).toMatchObject({ handle: "bob", stage: "Dry Ridge climb", score: 850, yours: 800, canon_id: seg });
    expect(got.items.find((i) => i.kind === "duel_on")).toMatchObject({ handle: "bob", stage: "Dry Ridge climb", have_stage: true });
    expect(got.items.find((i) => i.kind === "request")).toMatchObject({ handle: "cara", waiting: true });
    // newest first, by a sortable UTC time
    expect(got.items.map((i) => i.at)).toEqual([...got.items.map((i) => i.at)].sort().reverse());
    // beat it back: no longer topped
    await ok(api(a, "POST", "/api/board", { segment_id: seg, driver_score: 900, driven_on: today }));
    expect(kinds(await inbox(a))).not.toContain("topped");
    // bob's Scores no longer reach alice: his run can't top her
    await ok(api(a, "POST", "/api/board", { segment_id: seg, driver_score: 700, driven_on: today }));
    await env.DB.prepare("UPDATE board_entries SET driver_score = 700 WHERE user_id = ?").bind(a.id).run();
    expect(kinds(await inbox(a))).toContain("topped");
    await ok(api(b, "PUT", "/api/grants", { audience_type: "friend", audience_id: a.id, share_scores: false }));
    expect(kinds(await inbox(a))).not.toContain("topped");
    // the duel ends: a result from each side (bob still shows alice nothing, so alice wins on hers alone)
    await env.DB.prepare("UPDATE duels SET starts_on = date('now', '-7 days'), ends_on = date('now', '-1 days')").run();
    await env.DB.prepare("UPDATE board_entries SET driven_on = date('now', '-2 days')").run();
    expect((await inbox(a)).items.find((i) => i.kind === "duel_over")).toMatchObject({ handle: "bob", stage: "Dry Ridge climb", result: "won" });
    expect((await inbox(b)).items.find((i) => i.kind === "duel_over")).toMatchObject({ handle: "alice", result: "lost" });
    // blocks: cara's request and bob's kudos go
    await ok(api(a, "POST", "/api/blocks", { handle: "cara" }));
    await ok(api(a, "POST", "/api/blocks", { handle: "bob" }));
    got = await inbox(a);
    expect(got.items).toEqual([]);
    expect(got.waiting).toBe(0);
  });

  it("a crew drive you haven't answered, new followers of your roadbook, and a time attack you were passed in", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob"), out = await makeUser("outsider");
    const crew = (await json(api(a, "POST", "/api/crews", { name: "Ridge Runners" }))).id as string;
    const tok = (await json(api(a, "POST", `/api/crews/${crew}/invite`))).token as string;
    await ok(api(b, "POST", "/api/crews/join", { token: tok }));
    const ev = (await json(api(b, "POST", `/api/crews/${crew}/events`, { title: "Cherohala Saturday", starts_at: inHours(48), meet: { name: "Shell", lat: 35.36, lon: -84.29 } }))).id;
    expect((await inbox(a)).items).toMatchObject([{ kind: "crew_drive", event_id: ev, title: "Cherohala Saturday", crew: "Ridge Runners", crew_id: crew }]);
    expect(kinds(await inbox(b))).toEqual([]);                      // your own drive isn't news to you
    expect(kinds(await inbox(out))).toEqual([]);
    await ok(api(a, "POST", `/api/events/${ev}/rsvp`, { status: "maybe" }));
    expect(kinds(await inbox(a))).toEqual([]);
    // a public roadbook followed by two people: counted, never named
    const book = (await json(api(a, "POST", "/api/roadbooks", { name: "Smokies classics" }))).id as string;
    await ok(api(a, "POST", `/api/roadbooks/${book}/roads`, { name: "The Dragon", geom: road() }));
    await ok(api(a, "PUT", `/api/roadbooks/${book}`, { visibility: "public" }));
    await ok(api(b, "PUT", `/api/roadbooks/${book}/follow`));
    await ok(api(out, "PUT", `/api/roadbooks/${book}/follow`));
    const f = (await inbox(a)).items.find((i) => i.kind === "follows")!;
    expect(f).toMatchObject({ book_id: book, book: "Smokies classics", n: 2 });
    expect(JSON.stringify(f)).not.toMatch(/bob|outsider/);
    // time attack: bob goes quicker than alice after her time went up
    const week = (await env.DB.prepare("SELECT date('now', '-6 days', 'weekday 1') AS w").first<{ w: string }>())!.w;
    // (the week's loop is named on its row, migration 0054, and has no stage of its own)
    await env.DB.prepare("INSERT INTO ta_weeks (week, cell, segment_id, name, length_m, geom) VALUES (?, '35,-84', 'ta-x', 'Tail of the Dragon loop', 10000, '[]')").bind(week).run();
    await env.DB.prepare("INSERT INTO ta_entries (week, cell, user_id, time_s, driven_on, updated_at) VALUES (?, '35,-84', ?, 300, ?, datetime('now', '-1 hour'))").bind(week, a.id, today).run();
    await env.DB.prepare("INSERT INTO ta_entries (week, cell, user_id, time_s, driven_on) VALUES (?, '35,-84', ?, 291, ?)").bind(week, b.id, today).run();
    expect((await inbox(a)).items.find((i) => i.kind === "passed")).toMatchObject({ handle: "bob", stage: "Tail of the Dragon loop", gap_s: 9, place: 2 });
    expect(kinds(await inbox(b))).not.toContain("passed");
    // a loop a moderator took down says nothing more
    await env.DB.prepare("UPDATE ta_weeks SET removed = 1").run();
    expect(kinds(await inbox(a))).not.toContain("passed");
    await env.DB.prepare("UPDATE ta_weeks SET removed = 0").run();
  });

  it("kudos and comments on your drive post; a comment after yours on a friend's post; blocks hide them", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob"), c = await makeUser("cara");
    await befriend(a, b); await befriend(a, c);
    const line = encodeLine(Array.from({ length: 91 }, (_, i) => [35 + i * 0.001, -84] as [number, number]));
    const { id } = await json(api(a, "POST", "/api/posts", { title: "Cherohala Skyway", driven_on: today, length_m: 10000, line }));
    await ok(api(b, "POST", `/api/posts/${id}/kudos`));
    await ok(api(b, "POST", `/api/posts/${id}/comments`, { body: "That fog!" }));
    await env.DB.prepare("UPDATE drive_comments SET created_at = datetime('now', '-1 minute')").run();   // bob's comment came first
    await ok(api(c, "POST", `/api/posts/${id}/kudos`));
    await ok(api(c, "POST", `/api/posts/${id}/comments`, { body: "Next time I'm in" }));
    const mine = (await inbox(a)).items;
    expect(mine.find((i) => i.kind === "post_kudos")).toMatchObject({ post_id: id, title: "Cherohala Skyway", others: 1, yours: true });
    expect(mine.find((i) => i.kind === "post_comment")).toMatchObject({ post_id: id, handle: "cara", others: 1, yours: true });
    expect((await inbox(b)).items.filter((i) => i.kind.startsWith("post_"))).toEqual([expect.objectContaining({ kind: "post_comment", handle: "cara", owner: "alice", yours: false, others: 0 })]);
    expect((await inbox(c)).items.filter((i) => i.kind.startsWith("post_"))).toEqual([]);   // nothing came after her comment
    await ok(api(b, "POST", "/api/blocks", { handle: "cara" }));
    expect((await inbox(b)).items.filter((i) => i.kind.startsWith("post_"))).toEqual([]);
    await ok(api(a, "POST", "/api/blocks", { handle: "cara" }));
    expect((await inbox(a)).items.find((i) => i.kind === "post_comment")).toMatchObject({ handle: "bob", others: 0 });
  });

  it("an @mention on a friend's post you can see; reads only real mentions; your own posts' comments stay comments", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob"), c = await makeUser("cara");
    await befriend(a, b); await befriend(a, c);
    const line = encodeLine(Array.from({ length: 91 }, (_, i) => [35 + i * 0.001, -84] as [number, number]));
    const { id } = await json(api(a, "POST", "/api/posts", { title: "Cherohala Skyway", driven_on: today, length_m: 10000, line }));
    await ok(api(c, "POST", `/api/posts/${id}/comments`, { body: "first" }));
    await env.DB.prepare("UPDATE drive_comments SET created_at = datetime('now', '-1 minute')").run();
    await ok(api(b, "POST", `/api/posts/${id}/comments`, { body: "@cara look, and @alice" }));
    await ok(api(b, "POST", `/api/posts/${id}/comments`, { body: "mail me at x@carab.com" }));
    const cs = (await inbox(c)).items.filter((i) => i.kind.startsWith("post_"));
    expect(cs).toEqual([expect.objectContaining({ kind: "post_mention", post_id: id, handle: "bob", owner: "alice", others: 0 })]);   // not "also commented" too
    expect(cs[0].body).toBeUndefined();
    expect((await inbox(a)).items.filter((i) => i.kind.startsWith("post_")).map((i) => i.kind)).toEqual(["post_comment"]);
    expect(mentionsOf("@Sam hi @sam, @al @bob_1 x@y.com @me", "me")).toEqual(["sam", "bob_1"]);
  });

  it("groups a post's rows: the newest person, how many others, at most ten posts", () => {
    const r = (post_id: string, handle: string, at: string) => ({ post_id, title: post_id, handle, at, yours: 1, owner: null });
    expect(perPost([r("p", "cara", "3"), r("p", "bob", "2"), r("p", "cara", "1"), r("q", "bob", "1")])).toEqual([
      { post_id: "p", title: "p", handle: "cara", at: "3", yours: true, owner: null, others: 1 },
      { post_id: "q", title: "q", handle: "bob", at: "1", yours: true, owner: null, others: 0 }]);
    expect(perPost(Array.from({ length: 12 }, (_, i) => r(`p${i}`, "bob", "1"))).length).toBe(10);
  });

  it("a duel's outcome from your side, by Score or by time", () => {
    const s = (score: number, time_s: number | null = null) => ({ score, time_s });
    expect(duelOutcome({ kind: "score", you: s(800), them: s(790) })).toBe("won");
    expect(duelOutcome({ kind: "score", you: s(780), them: s(790) })).toBe("lost");
    expect(duelOutcome({ kind: "score", you: null, them: null })).toBe("none");
    expect(duelOutcome({ kind: "score", you: s(800), them: null })).toBe("won");
    expect(duelOutcome({ kind: "time", you: s(700, 290), them: s(900, 300) })).toBe("won");
    expect(duelOutcome({ kind: "time", you: s(700, 300), them: s(900, 300) })).toBe("draw");
    expect(duelOutcome({ kind: "time", you: s(900, null), them: s(700, 310) })).toBe("lost");
  });
});
