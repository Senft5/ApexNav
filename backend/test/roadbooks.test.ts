// Roadbooks (src/roadbooks.ts, migration 0046): collections of roads; private, friends or public; follows, stamps, reports.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeUser, ok, type TestUser } from "./helpers";
import { MAX_POINTS, MAX_ROADS } from "../src/roadbooks";

beforeEach(freshDb);
type Msg = Record<string, any>;
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as Msg;
// a road of about 5.5 km near Deals Gap, and one near Cincinnati
const road = (lat = 35.5, lon = -83.9, n = 60) => Array.from({ length: n }, (_, i) => [lon + i * 1e-3, lat + Math.sin(i / 5) * 1e-3]);
const book = async (u: TestUser, b: Msg = {}) => (await json(api(u, "POST", "/api/roadbooks", { name: "Smokies classics", ...b }))).id as string;
const add = (u: TestUser, id: string, b: Msg = {}) => api(u, "POST", `/api/roadbooks/${id}/roads`, { name: "The Dragon", geom: road(), ...b });
const get = (u: TestUser | null, id: string) => api(u, "GET", `/api/roadbooks/${id}`);

describe("roadbooks", () => {
  it("a book keeps its roads in order with their length, and only its owner changes it", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob");
    const id = await book(a, { about: "Three for a dry Saturday" });
    const r1 = await json(add(a, id)), r2 = await json(add(a, id, { name: "Cherohala", note: "Fuel in Tellico first", geom: road(35.3, -84.1) }));
    expect(r1.length_m).toBeGreaterThan(5000); expect(r1.length_m).toBeLessThan(6500);
    let got = await json(get(a, id));
    expect([got.name, got.about, got.visibility, got.mine, got.roads, got.by]).toEqual(["Smokies classics", "Three for a dry Saturday", "private", true, 2, "alice"]);
    expect(got.road_list.map((r: Msg) => [r.name, r.note, r.stamped, r.stamps])).toEqual([["The Dragon", null, false, 0], ["Cherohala", "Fuel in Tellico first", false, 0]]);
    expect(got.road_list[0].geom).toHaveLength(60);
    expect(got.length_m).toBe(r1.length_m + r2.length_m);
    expect(got.lat).toBeCloseTo(35.4, 1);                               // the middle of its two roads
    // reorder, rename, a new note
    await ok(api(a, "PUT", `/api/roadbooks/${id}`, { order: [r2.id, r1.id], name: "Smokies, the long way" }));
    await ok(api(a, "PUT", `/api/roadbooks/${id}/roads/${r1.id}`, { note: "318 corners" }));
    got = await json(get(a, id));
    expect([got.name, got.road_list.map((r: Msg) => r.name), got.road_list[1].note]).toEqual(["Smokies, the long way", ["Cherohala", "The Dragon"], "318 corners"]);
    expect((await api(a, "PUT", `/api/roadbooks/${id}`, { order: [r1.id] })).status).toBe(400);
    // bob can't see a private book, or touch it
    for (const res of [await get(b, id), await get(null, id), await add(b, id), await api(b, "PUT", `/api/roadbooks/${id}`, { name: "Mine now" }), await api(b, "DELETE", `/api/roadbooks/${id}`),
      await api(b, "DELETE", `/api/roadbooks/${id}/roads/${r1.id}`), await api(b, "PUT", `/api/roadbooks/${id}/follow`)]) expect(res.status).toBe(404);
    await ok(api(a, "DELETE", `/api/roadbooks/${id}/roads/${r2.id}`));
    got = await json(get(a, id));
    expect([got.roads, got.length_m]).toEqual([1, r1.length_m]);
    await ok(api(a, "DELETE", `/api/roadbooks/${id}`));
    expect((await get(a, id)).status).toBe(404);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM roadbook_roads").first<{ n: number }>())!.n).toBe(0);
  });

  it("friends see a friends book; a public one opens for anyone, signed out too; a block hides both ways", async () => {
    const a = await makeUser("alice"), f = await makeUser("friend"), s = await makeUser("stranger");
    await befriend(a, f);
    const id = await book(a, { visibility: "friends" });
    await ok(add(a, id));
    expect((await get(f, id)).status).toBe(200);
    for (const u of [s, null]) expect((await get(u, id)).status).toBe(404);
    await ok(api(a, "PUT", `/api/roadbooks/${id}`, { visibility: "public" }));
    const open = await json(get(null, id));
    expect([open.by, open.mine, open.following, open.road_list[0].stamped]).toEqual(["alice", false, false, false]);
    expect((await get(s, id)).status).toBe(200);
    await ok(api(s, "POST", "/api/blocks", { user_id: a.id }));
    expect((await get(s, id)).status).toBe(404);
    // unfriending closes a friends book again
    await ok(api(a, "PUT", `/api/roadbooks/${id}`, { visibility: "friends" }));
    await ok(api(a, "DELETE", `/api/friends/${f.id}`));
    expect((await get(f, id)).status).toBe(404);
  });

  it("your friends' books with a road in them are listed, newest first; private, empty, strangers' and blocked ones are not", async () => {
    const a = await makeUser("alice"), f = await makeUser("friend"), g = await makeUser("gina"), s = await makeUser("stranger");
    await befriend(a, f); await befriend(a, g);
    const fb = await book(f, { name: "Friend's Ohio", visibility: "friends" }); await ok(add(f, fb));
    const fp = await book(f, { name: "Friend's private" }); await ok(add(f, fp));
    await book(f, { name: "Friend's empty", visibility: "friends" });
    const gb = await book(g, { name: "Gina's public", visibility: "public" }); await ok(add(g, gb));
    const sb = await book(s, { name: "Stranger's public", visibility: "public" }); await ok(add(s, sb));
    const mine = await book(a, { visibility: "friends" }); await ok(add(a, mine));
    await env.DB.prepare("UPDATE roadbooks SET updated_at = '2026-01-01 00:00:00' WHERE id = ?").bind(fb).run();
    const list = await json(api(a, "GET", "/api/roadbooks/friends"));
    expect(list.map((x: Msg) => [x.name, x.by, x.roads, x.mine])).toEqual([["Gina's public", "gina", 1, false], ["Friend's Ohio", "friend", 1, false]]);
    expect(list[0].road_list).toBeUndefined();                          // cards only: the shapes come when one is opened
    await ok(api(a, "POST", "/api/blocks", { user_id: g.id }));
    expect((await json(api(a, "GET", "/api/roadbooks/friends"))).map((x: Msg) => x.name)).toEqual(["Friend's Ohio"]);
    expect((await api(null, "GET", "/api/roadbooks/friends")).status).toBe(401);
  });

  it("showing a book needs a handle; names, shapes and limits are checked", async () => {
    const a = await makeUser("alice");
    await env.DB.prepare("UPDATE users SET handle = NULL WHERE id = ?").bind(a.id).run();
    expect((await api(a, "POST", "/api/roadbooks", { name: "X road", visibility: "public" })).status).toBe(409);
    const id = await book(a);
    expect((await api(a, "PUT", `/api/roadbooks/${id}`, { visibility: "friends" })).status).toBe(409);
    for (const bad of [{ name: "" }, { name: "x".repeat(61) }, { visibility: "everyone" }, { about: "y".repeat(281) }]) expect((await api(a, "POST", "/api/roadbooks", { name: "Fine", ...bad })).status).toBe(400);
    for (const geom of [[[0, 0]], [[-83.9, 35.5], [-83.9, 35.5001]], [[-83.9, 95], [-83.8, 35]], road(35.5, -83.9, MAX_POINTS + 1), "no", [[-83.9, 35.5], [20, 35.5]]]) expect((await add(a, id, { geom })).status).toBe(400);
    expect((await add(a, id, { name: " " })).status).toBe(400);
    await env.DB.batch(Array.from({ length: MAX_ROADS }, (_, i) => env.DB.prepare(
      "INSERT INTO roadbook_roads (id, book_id, pos, name, geom, length_m, south, north, west, east) VALUES (?, ?, ?, 'r', '[]', 1000, 35, 35, -84, -84)").bind(`r${i}`, id, i)));
    await env.DB.prepare("UPDATE roadbooks SET roads_n = ? WHERE id = ?").bind(MAX_ROADS, id).run();
    expect((await add(a, id)).status).toBe(429);
  });

  it("public books are found near a coarse cell, most followed first; following lists them with each road's box and no shape", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob"), c = await makeUser("cara");
    const smoky = await book(a, { visibility: "public" }), second = await book(b, { name: "Foothills", visibility: "public" }), far = await book(a, { name: "Ohio", visibility: "public" });
    const empty = await book(a, { name: "Empty", visibility: "public" }), hidden = await book(a, { name: "Secret" });
    await ok(add(a, smoky)); await ok(add(b, second, { geom: road(35.7, -83.6) })); await ok(add(a, far, { geom: road(39.2, -84.6) })); await ok(add(a, hidden));
    await ok(api(c, "PUT", `/api/roadbooks/${second}/follow`));
    await ok(api(c, "PUT", `/api/roadbooks/${second}/follow`));                                // twice is once
    const near = await json(api(c, "GET", "/api/roadbooks/near?lat=35.6&lon=-83.8"));
    expect(near.map((x: Msg) => [x.name, x.by, x.followers, x.following])).toEqual([["Foothills", "bob", 1, true], ["Smokies classics", "alice", 0, false]]);
    expect(near[0].road_list).toBeUndefined();
    expect((await json(api(null, "GET", "/api/roadbooks/near?lat=35.6&lon=-83.8"))).length).toBe(2);   // no account needed to look
    expect((await json(api(a, "GET", "/api/roadbooks/near?lat=35.6&lon=-83.8"))).map((x: Msg) => x.name)).toEqual(["Foothills"]);   // never your own
    expect((await api(c, "GET", "/api/roadbooks/near")).status).toBe(400);
    expect([empty, hidden].length).toBe(2);
    const mine = await json(api(c, "GET", "/api/roadbooks"));
    expect(mine.mine).toEqual([]);
    expect(mine.following.map((x: Msg) => x.name)).toEqual(["Foothills"]);
    const r = mine.following[0].road_list[0];
    expect([r.name, r.stamped, r.geom, r.box.length]).toEqual(["The Dragon", false, undefined, 4]);
    expect(r.box[0]).toBeLessThan(r.box[1]); expect(r.box[2]).toBeLessThan(r.box[3]);
    expect((await api(b, "PUT", `/api/roadbooks/${second}/follow`)).status).toBe(400);         // not your own
    // made private: its followers are let go
    await ok(api(b, "PUT", `/api/roadbooks/${second}`, { visibility: "private" }));
    expect((await json(api(c, "GET", "/api/roadbooks"))).following).toEqual([]);
    expect((await json(api(a, "GET", "/api/roadbooks"))).mine.map((x: Msg) => x.name).sort()).toEqual(["Empty", "Ohio", "Secret", "Smokies classics"]);
  });

  it("a member with every book and follow allowed still gets their list (more than D1's 100 bound values a query)", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob");
    const ids = Array.from({ length: 130 }, (_, i) => `book${String(i).padStart(12, "0")}`);
    await env.DB.batch(ids.map((id, i) => env.DB.prepare("INSERT INTO roadbooks (id, owner, name, visibility) VALUES (?, ?, ?, 'public')").bind(id, i < 30 ? a.id : b.id, `Book ${i}`)));
    await env.DB.batch(ids.slice(30).map((id) => env.DB.prepare("INSERT INTO roadbook_follows (book_id, user_id) VALUES (?, ?)").bind(id, a.id)));
    await ok(add(a, ids[0])); await ok(add(b, ids[129]));
    const got = await json(api(a, "GET", "/api/roadbooks"));
    expect([got.mine.length, got.following.length]).toEqual([30, 100]);
    expect(got.mine.find((x: Msg) => x.id === ids[0]).road_list).toHaveLength(1);
    expect(got.following.find((x: Msg) => x.id === ids[129]).road_list).toHaveLength(1);
  });

  it("a stamp is counted once per member, comes back as yours, and the table never holds who", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob"), c = await makeUser("cara");
    const id = await book(a, { visibility: "public" });
    const rid = (await json(add(a, id))).id as string;
    expect(await json(api(b, "PUT", `/api/roadbooks/roads/${rid}/stamp`))).toEqual({ stamped: true, stamps: 1 });
    expect(await json(api(b, "PUT", `/api/roadbooks/roads/${rid}/stamp`))).toEqual({ stamped: true, stamps: 1 });
    expect((await json(api(c, "PUT", `/api/roadbooks/roads/${rid}/stamp`))).stamps).toBe(2);
    expect((await json(get(b, id))).road_list[0]).toMatchObject({ stamped: true, stamps: 2 });
    expect((await json(get(a, id))).road_list[0]).toMatchObject({ stamped: false, stamps: 2 });
    const rows = (await env.DB.prepare("SELECT hex(holder) AS h FROM roadbook_stamps").all<{ h: string }>()).results;
    expect(rows).toHaveLength(2);
    for (const r of rows) for (const u of [b, c]) expect(r.h.toLowerCase()).not.toContain(u.id.replace(/-/g, "").slice(0, 12));
    expect(((await json(api(b, "GET", "/api/me/export"))).roadbook_stamps)).toEqual([{ roadbook: "Smokies classics", road: "The Dragon" }]);
    expect(await json(api(b, "DELETE", `/api/roadbooks/roads/${rid}/stamp`))).toEqual({ stamped: false, stamps: 1 });
    // a road you can't see can't be stamped; leaving takes your stamps with you
    const secret = await book(a), srid = (await json(add(a, secret))).id;
    expect((await api(b, "PUT", `/api/roadbooks/roads/${srid}/stamp`)).status).toBe(404);
    await ok(api(c, "DELETE", "/api/me", { confirm: "DELETE" }));
    expect((await json(get(a, id))).road_list[0].stamps).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM roadbook_stamps").first<{ n: number }>())!.n).toBe(0);
  });

  it("the owner's export has their books; deleting the account removes them", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob");
    const id = await book(a, { visibility: "public" });
    await ok(add(a, id)); await ok(api(b, "PUT", `/api/roadbooks/${id}/follow`));
    const ex = await json(api(a, "GET", "/api/me/export"));
    expect(ex.roadbooks.map((x: Msg) => [x.name, x.visibility, x.roads])).toEqual([["Smokies classics", "public", 1]]);
    expect(ex.roadbook_roads[0].name).toBe("The Dragon");
    expect((await json(api(b, "GET", "/api/me/export"))).roadbooks_followed.map((x: Msg) => x.name)).toEqual(["Smokies classics"]);
    await ok(api(a, "DELETE", "/api/me", { confirm: "DELETE" }));
    for (const t of ["roadbooks", "roadbook_roads", "roadbook_follows"]) expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n).toBe(0);
  });

  it("reports take a public book off 'near you' and its link; the owner's removal makes it private for good", async () => {
    const a = await makeUser("alice"), owner = await makeUser("owner");
    await env.DB.prepare("UPDATE users SET email = 'owner@example.test' WHERE id = ?").bind(owner.id).run();
    const id = await book(a, { visibility: "public" });
    await ok(add(a, id));
    const reporters = [await makeUser("r1"), await makeUser("r2"), await makeUser("r3")];
    await ok(api(reporters[0], "PUT", `/api/roadbooks/${id}/follow`));
    expect((await api(a, "POST", "/api/reports", { kind: "roadbook", target: id, reason: "spam" })).status).toBe(404);   // not your own
    for (const r of reporters) await ok(api(r, "POST", "/api/reports", { kind: "roadbook", target: id, reason: "spam" }));
    expect((await get(reporters[0], id)).status).toBe(404);
    expect(await json(api(reporters[1], "GET", "/api/roadbooks/near?lat=35.5&lon=-83.9"))).toEqual([]);
    expect((await get(a, id)).status).toBe(200);                                               // its owner still has it
    const q = await json(api(owner, "GET", "/api/moderation"));
    expect(q.map((x: Msg) => [x.kind, x.label, x.hidden])).toEqual([["roadbook", 'roadbook "Smokies classics" (public, 1 roads) · @alice', true]]);
    await ok(api(owner, "POST", "/api/moderation/resolve", { kind: "roadbook", target: id, action: "remove" }));
    expect((await json(get(a, id))).visibility).toBe("private");
    expect((await api(a, "PUT", `/api/roadbooks/${id}`, { visibility: "public" })).status).toBe(403);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM roadbook_follows").first<{ n: number }>())!.n).toBe(0);
  });
});
