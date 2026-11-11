// Sharing on by default (the owner, 2026-11-11; src/share_defaults.ts): friends and private crews start with Scores and
// Times shared, a public crew with nothing, a choice made (on or off) is never overwritten, never across a block.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeUser, ok, type TestUser } from "./helpers";

type G = { audience_type: string; audience_id: string; share_scores: number; share_times: number };
beforeEach(freshDb);
const grants = async (u: TestUser) => ((await (await ok(api(u, "GET", "/api/grants"))).json()) as G[]).map((g) => `${g.audience_type}:${g.audience_id}:${g.share_scores}${g.share_times}`).sort();

describe("sharing defaults", () => {
  it("a private crew: its owner and everyone who joins share Scores and Times with it; a public crew: nobody, until they say", async () => {
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara")];
    const priv = ((await (await ok(api(a, "POST", "/api/crews", { name: "Ridge Runners" }))).json()) as { id: string }).id;
    const tok = ((await (await ok(api(a, "POST", `/api/crews/${priv}/invite`))).json()) as { token: string }).token;
    await ok(api(b, "POST", "/api/crews/join", { token: tok }));
    expect(await grants(a)).toEqual([`crew:${priv}:11`, `friend:${b.id}:11`]);
    expect(await grants(b)).toEqual([`crew:${priv}:11`, `friend:${a.id}:11`]);
    const pub = ((await (await ok(api(c, "POST", "/api/crews", { name: "Open Road", visibility: "public", area: { name: "Knoxville", lat: 35.96, lon: -83.92 } }))).json()) as { id: string }).id;
    expect(await grants(c)).toEqual([]);
    const j = await (await ok(api(b, "POST", `/api/crews/${pub}/join`))).json();
    expect(j).toEqual({ id: pub });
    expect((await grants(b)).filter((g) => g.includes(pub))).toEqual([]);
    const link = ((await (await ok(api(c, "POST", `/api/crews/${pub}/invite`))).json()) as { token: string }).token;
    expect(await (await ok(api(a, "POST", "/api/crews/join", { token: link }))).json()).toEqual({ id: pub, friend: "cara", public: true });
    expect((await grants(a)).filter((g) => g.includes(pub))).toEqual([]);              // the phone asks
  });

  it("an off switch stays off; a block shares nothing", async () => {
    const [a, b, x] = [await makeUser("alice"), await makeUser("bob"), await makeUser("xavier")];
    await befriend(a, b);
    await ok(api(a, "PUT", "/api/grants", { audience_type: "friend", audience_id: b.id, share_scores: true, share_times: false }));
    await ok(api(b, "PUT", "/api/grants", { audience_type: "friend", audience_id: a.id, share_scores: false }));
    await ok(api(a, "POST", "/api/friends/request", { handle: "bob" }));               // asked again: nothing changes
    expect(await grants(a)).toEqual([`friend:${b.id}:10`]);
    expect(await grants(b)).toEqual([`friend:${a.id}:00`]);
    // a block between two people who would otherwise be befriended by a link: no friendship, no grant
    await ok(api(x, "POST", "/api/blocks", { handle: "alice" }));
    const { token } = (await (await ok(api(a, "POST", "/api/invites"))).json()) as { token: string };
    await api(x, "POST", "/api/invites/redeem", { token });
    expect(await grants(x)).toEqual([]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM grants WHERE user_id = ? AND audience_id = ?").bind(a.id, x.id).first<{ n: number }>())!.n).toBe(0);
  });
});
