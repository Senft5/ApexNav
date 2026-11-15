// Your driving DNA beside a friend's (src/dna.ts, migration 0064): yours on your friend's profile, only while you share
// scores with them, never across a block; only the card's six levels, style words and corner kind are kept.
import { beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeUser, ok } from "./helpers";

beforeEach(freshDb);
type Msg = Record<string, any>;
const DNA = { skills: { squeeze: 81, brake: 64.4, arc: 92, entry: 77, line: 58, exit: 70 }, style: ["Trail-braker", "Late apex", "180 mph"], size: "fast", corners: 212, drives: 14, pace: 99, top_speed: 60 };
const profile = async (u: any, of: any) => (await (await ok(api(u, "GET", `/api/friends/${of.id}/profile`))).json()) as Msg;

describe("driving DNA", () => {
  it("shows beside yours on a friend's profile, only what the card shows, only while they share scores", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob");
    await befriend(a, b);
    expect((await api(b, "PUT", "/api/me/dna", { skills: { arc: 50 } })).status).toBe(400);           // not all six: no DNA
    expect((await api(b, "PUT", "/api/me/dna", { ...DNA, skills: { ...DNA.skills, arc: 140 } })).status).toBe(400);
    expect((await profile(a, b)).dna).toBeNull();                                          // none sent yet
    await ok(api(b, "PUT", "/api/me/dna", DNA));
    await ok(api(b, "PUT", "/api/grants", { audience_type: "friend", audience_id: a.id, share_scores: true, share_times: false }));
    let p = await profile(a, b);
    expect(p.dna.theirs).toEqual({ skills: { squeeze: 81, brake: 64, arc: 92, entry: 77, line: 58, exit: 70 }, style: ["Trail-braker", "Late apex"], size: "fast", corners: 212, drives: 14 });
    expect(p.dna.mine).toBeNull();                                                          // alice hasn't sent hers
    await ok(api(a, "PUT", "/api/me/dna", { ...DNA, skills: { ...DNA.skills, arc: 60 } }));
    p = await profile(a, b);
    expect(p.dna.mine.skills.arc).toBe(60);
    expect(JSON.stringify(p.dna)).not.toMatch(/pace|speed|180/);
    await ok(api(b, "PUT", "/api/grants", { audience_type: "friend", audience_id: a.id, share_scores: false, share_times: false }));
    expect((await profile(a, b)).dna).toBeNull();                                          // scores off: the DNA goes with them
    const ex = (await (await ok(api(b, "GET", "/api/me/export"))).json()) as Msg;
    expect(ex.driving_dna.length).toBe(1);
  });
});
