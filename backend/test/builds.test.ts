// Build threads (src/builds.ts, REVIEW.md 5.3, roadmap 23): one per car, seen by whoever sees the car; numbered posts with
// parts and photos; replies and suggestions with "Tried it"; follows count new posts; reports, export, deletion.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeUser, ok, type TestUser } from "./helpers";

beforeEach(freshDb);
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as any;
const car = async (u: TestUser, shared = true) => (await json(api(u, "POST", "/api/garage", { make: "Mazda", model: "Miata", year: 2004, trim: "Mazdaspeed", mods: "1.8 turbo, 178 hp on the stock dyno sheet", shared }))).id as string;

describe("build threads", () => {
  it("the owner starts one per car, posts numbered steps; friends see it, strangers don't", async () => {
    const [a, b, out] = [await makeUser("nate"), await makeUser("sam"), await makeUser("outsider")];
    await befriend(a, b);
    const c = await car(a);
    const { id } = await json(api(a, "POST", "/api/builds", { car_id: c, stages: ["Wheels", "Brakes", "Suspension", "Power"] }));
    expect((await api(a, "POST", "/api/builds", { car_id: c, stages: [] })).status).toBe(409);       // one per car
    expect((await api(b, "POST", "/api/builds", { car_id: c, stages: [] })).status).toBe(404);       // not bob's car
    const p1 = await json(api(a, "POST", `/api/builds/${id}/posts`, { title: "Wheels and tyres", stage: 0, parts: ["RPF1 15x8", "RE-71RS"] }));
    const p2 = await json(api(a, "POST", `/api/builds/${id}/posts`, { title: "Coilovers in, and a first alignment", body: "Ohlins Road and Track, 7k/5k.", stage: 2,
      parts: ["Ohlins DFV R&T", "7k / 5k springs"], score: 702 }));
    expect([p1.n, p2.n]).toEqual([1, 2]);
    const t = await json(api(b, "GET", `/api/builds/${id}`));
    expect(t).toMatchObject({ mine: false, stages: ["Wheels", "Brakes", "Suspension", "Power"], make: "Mazda", handle: "nate", mods: "1.8 turbo, 178 hp on the stock dyno sheet", followers: 0, following: false });
    expect(t.posts.map((p: any) => [p.n, p.title, p.stage, p.score])).toEqual([[2, "Coilovers in, and a first alignment", 2, 702], [1, "Wheels and tyres", 0, null]]);
    expect(t.posts[0].parts).toEqual(["Ohlins DFV R&T", "7k / 5k springs"]);
    expect((await api(out, "GET", `/api/builds/${id}`)).status).toBe(404);
    expect((await json(api(b, "GET", `/api/builds?car=${c}`))).id).toBe(id);
    expect((await json(api(b, "GET", "/api/garage/people")))[0].cars[0].build_id).toBe(id);       // on a friend's car card
    // a car that isn't shown hides its thread too
    await ok(api(a, "PUT", `/api/garage/${c}`, { make: "Mazda", model: "Miata", shared: false, is_primary: true }));
    expect((await api(b, "GET", `/api/builds/${id}`)).status).toBe(404);
    // checks
    await ok(api(a, "PUT", `/api/garage/${c}`, { make: "Mazda", model: "Miata", shared: true, is_primary: true }));
    for (const bad of [{ title: "" }, { title: "x", stage: 9 }, { title: "x", score: 1200 }, { title: "x", parts: Array(13).fill("p") }])
      expect((await api(a, "POST", `/api/builds/${id}/posts`, bad)).status).toBe(400);
    expect((await api(b, "POST", `/api/builds/${id}/posts`, { title: "mine now" })).status).toBe(404);
    expect((await api(a, "PUT", `/api/builds/${id}`, { stages: Array(9).fill("s") })).status).toBe(400);
  });

  it("replies and suggestions: the owner answers a suggestion with Tried it; authors and the owner delete; blocks and reports hide", async () => {
    const [a, b, c, d] = [await makeUser("nate"), await makeUser("sam"), await makeUser("jules"), await makeUser("dee")];
    for (const u of [b, c, d]) await befriend(a, u);
    const { id } = await json(api(a, "POST", "/api/builds", { car_id: await car(a), stages: ["Suspension"] }));
    const post = await json(api(a, "POST", `/api/builds/${id}/posts`, { title: "Coilovers", stage: 0 }));
    const r1 = await json(api(b, "POST", `/api/builds/posts/${post.id}/replies`, { body: "Looks great" }));
    const s1 = await json(api(c, "POST", `/api/builds/posts/${post.id}/replies`, { body: "Try 1 click softer on the rear rebound", suggestion: true }));
    expect((await api(a, "PUT", `/api/builds/replies/${r1.id}/tried`, { tried: "x" })).status).toBe(404);   // only suggestions
    expect((await api(b, "PUT", `/api/builds/replies/${s1.id}/tried`, { tried: "x" })).status).toBe(404);   // only the owner
    await ok(api(a, "PUT", `/api/builds/replies/${s1.id}/tried`, { tried: "Calmer over the crests. Kept it." }));
    let t = await json(api(d, "GET", `/api/builds/${id}`));
    expect(t.posts[0].replies.map((r: any) => [r.handle, r.suggestion, r.tried])).toEqual([["sam", false, null], ["jules", true, "Calmer over the crests. Kept it."]]);
    // reports: three people hide a reply from others; its author still sees it
    const meme = await json(api(d, "POST", `/api/builds/posts/${post.id}/replies`, { body: "spam spam" }));
    for (const u of [a, b, c]) await ok(api(u, "POST", "/api/reports", { kind: "reply", target: meme.id, reason: "spam" }));
    expect((await json(api(b, "GET", `/api/builds/${id}`))).posts[0].replies.map((r: any) => r.handle)).toEqual(["sam", "jules"]);
    expect((await json(api(d, "GET", `/api/builds/${id}`))).posts[0].replies.map((r: any) => r.handle)).toContain("dee");
    // a block: the blocked person's replies leave the viewer's thread
    await ok(api(b, "POST", "/api/blocks", { handle: "jules" }));
    expect((await json(api(b, "GET", `/api/builds/${id}`))).posts[0].replies.map((r: any) => r.handle)).toEqual(["sam"]);
    // deletes: the author, or the build's owner; nobody else
    expect((await api(c, "DELETE", `/api/builds/replies/${r1.id}`)).status).toBe(404);
    await ok(api(b, "DELETE", `/api/builds/replies/${r1.id}`));
    await ok(api(a, "DELETE", `/api/builds/replies/${s1.id}`));
    t = await json(api(a, "GET", `/api/builds/${id}`));
    expect(t.posts[0].replies.map((r: any) => r.handle)).toEqual([]);                   // dee's is hidden by three reports
    // a post report and the moderator's remove (no moderator here: the report is filed and counted)
    await ok(api(b, "POST", "/api/reports", { kind: "post", target: post.id, reason: "other" }));
    expect((await api(a, "POST", "/api/reports", { kind: "post", target: post.id, reason: "other" })).status).toBe(404);   // your own
  });

  it("follow: new posts since you last looked, never your own build; photos on a post, eight at most; export and deletion", async () => {
    const [a, b] = [await makeUser("nate"), await makeUser("sam")];
    await befriend(a, b);
    const { id } = await json(api(a, "POST", "/api/builds", { car_id: await car(a), stages: [] }));
    await ok(api(a, "POST", `/api/builds/${id}/posts`, { title: "One" }));
    expect((await api(a, "PUT", `/api/builds/${id}/follow`)).status).toBe(400);
    await ok(api(b, "PUT", `/api/builds/${id}/follow`));
    expect((await json(api(b, "GET", "/api/builds/following"))).map((x: any) => [x.handle, x.new_posts])).toEqual([["nate", 0]]);
    await ok(api(a, "POST", `/api/builds/${id}/posts`, { title: "Two" }));
    await ok(api(a, "POST", `/api/builds/${id}/posts`, { title: "Three" }));
    expect((await json(api(b, "GET", "/api/builds/following")))[0].new_posts).toBe(2);
    expect((await json(api(b, "GET", `/api/builds/${id}`))).followers).toBe(1);                   // opening it marks them seen
    expect((await json(api(b, "GET", "/api/builds/following")))[0].new_posts).toBe(0);
    await ok(api(b, "DELETE", `/api/builds/${id}/follow`));
    expect(await json(api(b, "GET", "/api/builds/following"))).toEqual([]);
    const exp = await json(api(a, "GET", "/api/me/export"));
    expect(exp.build_posts.map((p: any) => p.title).sort()).toEqual(["One", "Three", "Two"]);
    // deleting a post takes its photos; deleting the build takes the posts
    const post = (await json(api(a, "GET", `/api/builds/${id}`))).posts[0].id;
    await env.DB.prepare("INSERT INTO photos (id, owner, kind, ref_id, bytes, w, h) VALUES ('ph1', ?, 'post', ?, 10, 1, 1)").bind(a.id, post).run();
    expect((await json(api(b, "GET", `/api/builds/${id}`))).posts[0].photos).toEqual(["ph1"]);
    await ok(api(a, "DELETE", `/api/builds/posts/${post}`));
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM photos").first<{ n: number }>())!.n).toBe(0);
    await ok(api(a, "DELETE", `/api/builds/${id}`));
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM build_posts").first<{ n: number }>())!.n).toBe(0);
  });
});
