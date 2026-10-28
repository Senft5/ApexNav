// Friends' activity in the Log (src/social.ts boardActivity, IDEAS S-03): who drove one of your stages lately, from what
// was published to you, with where you stand on it. Times never appear; a friend you can't see on the board isn't here.
import { beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeSegment, makeUser, ok, type TestUser } from "./helpers";

beforeEach(freshDb);
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
const activity = async (u: TestUser) => (await (await ok(api(u, "GET", "/api/board/activity"))).json()) as Array<Record<string, any>>;
const publish = (u: TestUser, seg: string, score: number, day = today) => ok(api(u, "POST", "/api/board", { segment_id: seg, driver_score: score, time_s: 600, driven_on: day }));
async function stageShared(owner: TestUser, other: TestUser) {
  const seg = await makeSegment(owner, "Esses");
  await ok(api(owner, "POST", `/api/segments/${seg}/share`, { audience_type: "friend", audience_id: other.id }));
  const adopted = ((await (await ok(api(other, "POST", "/api/segments/adopt", { segment_id: seg }))).json()) as { id: string }).id;
  return { seg, adopted };
}

describe("friends' activity", () => {
  it("lists a friend who drove your stage, with your rank, and no time", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await befriend(a, b);
    const { seg, adopted } = await stageShared(a, b);
    for (const [u, other] of [[a, b], [b, a]] as const) await ok(api(u, "PUT", "/api/grants", { audience_type: "friend", audience_id: other.id, share_scores: true, share_times: true }));
    await publish(a, seg, 700);
    await publish(b, adopted, 812);
    const list = await activity(a);
    expect(list).toEqual([{ handle: "bob", name: "BOB", canon_id: seg, stage: "Esses", driver_score: 812, driven_on: today, you: { rank: 2, of: 2, mine: 700 } }]);
    expect(JSON.stringify(list)).not.toMatch(/time_s|600/);
    expect((await activity(b))[0]).toMatchObject({ handle: "alice", stage: "Esses", you: { rank: 1, of: 2, mine: 812 } });
  });

  it("leaves out old drives, stages you don't have, your own runs, and anyone not sharing with you", async () => {
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("carol")];
    await befriend(a, b); await befriend(a, c); await befriend(b, c);
    const { adopted } = await stageShared(a, b);
    await ok(api(b, "PUT", "/api/grants", { audience_type: "friend", audience_id: a.id, share_scores: true }));
    await publish(b, adopted, 800, daysAgo(20));                       // too long ago
    const own = await makeSegment(b, "Bob's own road");                 // alice doesn't have it
    await publish(b, own, 750);
    await publish(a, (await makeSegment(a, "Mine")), 600);             // her own run
    const { adopted: cAdopted } = await stageShared(a, c);              // carol drove it but shares with no one
    await publish(c, cAdopted, 900);
    expect(await activity(a)).toEqual([]);
    // unfriending takes it away at once
    await publish(b, adopted, 810);
    expect(await activity(a)).toHaveLength(1);
    await ok(api(a, "DELETE", `/api/friends/${b.id}`));
    expect(await activity(a)).toEqual([]);
  });
});
