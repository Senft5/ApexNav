// A friend request in says how many friends you share with who asks (screen inventory 2026-11-16): counted, never named,
// and only on a request; an accepted friend's row carries none.
import { beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeUser, ok } from "./helpers";

beforeEach(freshDb);

type Row = { handle: string; status: string; incoming: number; mutual: number | null };
const list = async (u: Parameters<typeof api>[0]) => (await (await ok(api(u, "GET", "/api/friends"))).json()) as Row[];

describe("friend requests", () => {
  it("a request in counts the friends you share, and names none", async () => {
    const [a, b, c, d, e] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara"), await makeUser("dan"), await makeUser("eve")];
    await befriend(a, b); await befriend(a, d);
    await befriend(c, b); await befriend(c, d); await befriend(c, e);   // eve is cara's friend only
    await ok(api(c, "POST", "/api/friends/request", { handle: "alice" }));
    const rows = await list(a);
    const req = rows.find((r) => r.handle === "cara")!;
    expect(req).toMatchObject({ status: "pending", incoming: 1, mutual: 2 });
    expect(JSON.stringify(req)).not.toMatch(/bob|dan|eve/);
    expect(rows.find((r) => r.handle === "bob")!.mutual).toBeNull();     // a friend, not a request: no count
  });

  it("a request from someone with no friends in common counts nothing", async () => {
    const [a, s] = [await makeUser("alice"), await makeUser("stranger")];
    await ok(api(s, "POST", "/api/friends/request", { handle: "alice" }));
    expect((await list(a))[0]).toMatchObject({ handle: "stranger", mutual: 0 });
  });
});
