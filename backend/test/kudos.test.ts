// Kudos (src/kudos.ts, IDEAS S-07): only on a run you can see; once per run; undo; the owner sees who and where; blocks
// hide them; they go with either account.
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { api, befriend, freshDb, makeSegment, makeUser, ok, type TestUser } from "./helpers";

beforeEach(freshDb);
const today = new Date().toISOString().slice(0, 10);
async function setup() {
  const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("carol")];
  await befriend(a, b);
  const seg = await makeSegment(a, "Esses");
  await ok(api(a, "POST", `/api/segments/${seg}/share`, { audience_type: "friend", audience_id: b.id }));
  const adopted = ((await (await ok(api(b, "POST", "/api/segments/adopt", { segment_id: seg }))).json()) as { id: string }).id;
  await ok(api(b, "PUT", "/api/grants", { audience_type: "friend", audience_id: a.id, share_scores: true }));
  await ok(api(b, "POST", "/api/board", { segment_id: adopted, driver_score: 812, driven_on: today }));
  return { a, b, c, seg };
}
const give = (u: TestUser, body: unknown) => api(u, "POST", "/api/kudos", body);

describe("kudos", () => {
  it("a friend gives kudos on a run they see, once; it shows in activity and to the owner", async () => {
    const { a, b, seg } = await setup();
    const run = { handle: "bob", canon_id: seg, driven_on: today };
    expect((await give(a, run)).status).toBe(204);
    expect((await give(a, run)).status).toBe(204);                                   // twice is still one
    const act = (await (await ok(api(a, "GET", "/api/board/activity"))).json()) as Array<Record<string, unknown>>;
    expect(act[0]).toMatchObject({ handle: "bob", kudos: 1, my_kudos: true });
    // bob doesn't have alice's stage name for it unless he has the stage: he adopted it, so it's named
    const got = (await (await ok(api(b, "GET", "/api/kudos"))).json()) as Array<Record<string, unknown>>;
    expect(got).toEqual([expect.objectContaining({ from_handle: "alice", stage: "Esses", canon_id: seg, driven_on: today })]);
    expect((await api(a, "DELETE", "/api/kudos", run)).status).toBe(204);
    expect(((await (await ok(api(b, "GET", "/api/kudos"))).json()) as unknown[]).length).toBe(0);
  });

  it("not on runs you can't see, your own, or made-up ones", async () => {
    const { a, c, seg } = await setup();
    expect((await give(c, { handle: "bob", canon_id: seg, driven_on: today })).status).toBe(404);          // not bob's friend
    expect((await give(a, { handle: "bob", canon_id: seg, driven_on: "2020-01-01" })).status).toBe(404);   // no run that day
    expect((await give(a, { handle: "alice", canon_id: seg, driven_on: today })).status).toBe(404);        // yourself
    expect((await give(a, { handle: "nobody", canon_id: seg, driven_on: today })).status).toBe(404);
    expect((await give(a, { handle: "bob", canon_id: seg, driven_on: "today" })).status).toBe(400);
  });

  it("a block hides kudos; deleting an account takes its kudos with it", async () => {
    const { a, b, seg } = await setup();
    await give(a, { handle: "bob", canon_id: seg, driven_on: today });
    await ok(api(b, "POST", "/api/blocks", { user_id: a.id }));
    expect(((await (await ok(api(b, "GET", "/api/kudos"))).json()) as unknown[]).length).toBe(0);
    await ok(api(a, "DELETE", "/api/me", { confirm: "DELETE" }));
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM kudos").first<{ n: number }>())!.n).toBe(0);
  });
});
