// People you may know (src/social.ts friendSuggestions): crew-mates and friends of two or more friends, never a friend,
// a request either way, or someone blocked either way.
import { beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeUser, ok } from "./helpers";

beforeEach(freshDb);
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as any;

describe("people you may know", () => {
  it("a crew-mate (named by the crew) and a friend of two friends (counted); not a friend of one; gone once asked or blocked", async () => {
    const [a, b, c, d, e, f] = await Promise.all(["alice", "bob", "cara", "dave", "erin", "fred"].map((h) => makeUser(h)));
    await befriend(a, b); await befriend(a, c);
    await befriend(d, b); await befriend(d, c);                 // dave: friends with two of alice's friends
    await befriend(f, b);                                       // fred: one
    const crew = (await json(api(b, "POST", "/api/crews", { name: "Ridge Runners" }))).id as string;
    for (const u of [a, e]) { const t = (await json(api(b, "POST", `/api/crews/${crew}/invite`))).token; await ok(api(u, "POST", "/api/crews/join", { token: t })); }
    const got = await json(api(a, "GET", "/api/friends/suggested"));
    expect(got).toEqual([{ handle: "erin", photo_id: null, crew: "Ridge Runners", mutual: 1 }, { handle: "dave", photo_id: null, crew: null, mutual: 2 }]);
    await ok(api(a, "POST", "/api/friends/request", { handle: "dave" }));
    await ok(api(e, "POST", "/api/blocks", { handle: "alice" }));
    expect(await json(api(a, "GET", "/api/friends/suggested"))).toEqual([]);
    expect((await api(null, "GET", "/api/friends/suggested")).status).toBe(401);
  });
});

describe("find people by handle", () => {
  it("handles starting with what you type, the exact one first then friends, with where you stand; never you or someone blocked", async () => {
    const [a] = await Promise.all(["sam", "samuel", "sam_r", "samx", "salt", "samuel2", "sam_r2", "samx2"].map((h) => makeUser(h)));
    const me = await makeUser("me_too");
    await befriend(me, a);                                                   // sam is a friend
    await ok(api(me, "POST", "/api/friends/request", { handle: "samx" }));  // a request sent
    const q = async (s: string) => (await json(api(me, "GET", `/api/users/search?q=${encodeURIComponent(s)}`))).map((r: any) => [r.handle, r.you]);
    expect(await q("@Sam")).toEqual([["sam", "friend"], ["sam_r", null], ["sam_r2", null], ["samuel", null], ["samuel2", null], ["samx", "sent"], ["samx2", null]]);
    expect(await q("sam_")).toEqual([["sam_r", null], ["sam_r2", null]]);  // "_" is a letter here, not a wildcard
    expect(await q("s")).toEqual([]);                                         // two characters at least
    expect(await q("me")).toEqual([]);                                        // never you
    await ok(api(a, "POST", "/api/blocks", { handle: "me_too" }));
    expect((await q("sam")).map((r: any[]) => r[0])).not.toContain("sam");
  });
});
