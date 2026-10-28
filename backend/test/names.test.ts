// Real names (the Google display name) reach only yourself and accepted friends. Crew-mates, boards and anyone
// who sends a request to a handle see the handle. A public crew can be joined by anyone, so it must not be a way in.
import { beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeSegment, makeUser, ok } from "./helpers";

beforeEach(freshDb);

type Named = { handle: string | null; name: string | null };
const get = async <T>(u: Parameters<typeof api>[0], path: string) => (await (await ok(api(u, "GET", path))).json()) as T;
const PUBLIC = { visibility: "public", area: { name: "Robbinsville", lat: 35.3, lon: -83.8 } };

describe("real names", () => {
  it("a stranger who joins a public crew sees handles, not names; friends still see names", async () => {
    const [a, b, s] = [await makeUser("alice"), await makeUser("bob"), await makeUser("stranger")];
    await befriend(a, b);
    const crew = (await (await ok(api(a, "POST", "/api/crews", { name: "Ridge Runners", ...PUBLIC }))).json() as { id: string }).id;
    await ok(api(b, "POST", `/api/crews/${crew}/join`));
    await ok(api(s, "POST", `/api/crews/${crew}/join`));
    const seen = await get<Named[]>(s, `/api/crews/${crew}/members`);
    expect(seen.map((m) => [m.handle, m.name])).toEqual(
      expect.arrayContaining([["alice", null], ["bob", null], ["stranger", "STRANGER"]]));
    const byFriend = await get<Named[]>(b, `/api/crews/${crew}/members`);
    expect(byFriend.find((m) => m.handle === "alice")!.name).toBe("ALICE");
    expect(byFriend.find((m) => m.handle === "stranger")!.name).toBeNull();
  });

  it("a crew board shows a non-friend's handle without their name", async () => {
    const [a, s] = [await makeUser("alice"), await makeUser("stranger")];
    const crew = (await (await ok(api(a, "POST", "/api/crews", { name: "Ridge Runners", ...PUBLIC }))).json() as { id: string }).id;
    await ok(api(s, "POST", `/api/crews/${crew}/join`));
    const seg = await makeSegment(a);
    await ok(api(a, "PUT", "/api/grants", { audience_type: "crew", audience_id: crew, share_scores: true }));
    await ok(api(a, "POST", "/api/board", { segment_id: seg, driver_score: 750, driven_on: "2026-10-20" }));
    const rows = await get<Named[]>(s, `/api/board/${seg}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ handle: "alice", name: null });
    expect((await get<Named[]>(a, `/api/board/${seg}`))[0].name).toBe("ALICE");   // your own row keeps your name
  });

  it("sending a request to a handle does not reveal the person's real name until they accept", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await ok(api(a, "POST", "/api/friends/request", { handle: "bob" }));
    expect((await get<Named[]>(a, "/api/friends"))[0]).toMatchObject({ handle: "bob", name: null });
    expect((await get<Named[]>(b, "/api/friends"))[0]).toMatchObject({ handle: "alice", name: "ALICE" });   // the one who reached out
    await ok(api(b, "POST", "/api/friends/accept", { user_id: a.id }));
    expect((await get<Named[]>(a, "/api/friends"))[0].name).toBe("BOB");
  });
});

describe("crew invite links", () => {
  it("joining by invite respects the 10-crew cap", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    for (let i = 0; i < 10; i++) await ok(api(b, "POST", "/api/crews", { name: `Crew ${i}` }));
    const crew = (await (await ok(api(a, "POST", "/api/crews", { name: "Ridge Runners" }))).json() as { id: string }).id;
    const tok = (await (await ok(api(a, "POST", `/api/crews/${crew}/invite`))).json() as { token: string }).token;
    expect((await api(b, "POST", "/api/crews/join", { token: tok })).status).toBe(429);
  });
});
