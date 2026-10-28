// Planned routes shared with friends and crews (src/routes_shared.ts, IDEAS S-05).
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeUser, ok, type TestUser } from "./helpers";
import { MAX_PER_DAY } from "../src/routes_shared";

beforeEach(freshDb);
type Msg = Record<string, any>;
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as Msg;
const geom = Array.from({ length: 50 }, (_, i) => [-83.9 + i * 1e-3, 35.6 + i * 5e-4]);
const share = (u: TestUser, b: Record<string, unknown>) => api(u, "POST", "/api/routes", { name: "Cherohala loop", geom, ...b });
const shared = (u: TestUser) => json(api(u, "GET", "/api/routes/shared"));

async function crew(owner: TestUser, members: TestUser[]) {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO crews (id, name, owner) VALUES (?, 'Crew', ?)").bind(id, owner.id).run();
  for (const m of [owner, ...members]) await env.DB.prepare("INSERT INTO crew_members (crew_id, user_id) VALUES (?, ?)").bind(id, m.id).run();
  return id;
}

describe("shared routes", () => {
  it("friends and crew-mates get the route; strangers, the blocked and non-members of the crew don't", async () => {
    const a = await makeUser("alice"), f = await makeUser("friend"), m = await makeUser("mate"), s = await makeUser("stranger"), x = await makeUser("blocker");
    await befriend(a, f); await befriend(a, x);
    await ok(api(x, "POST", "/api/blocks", { user_id: a.id }));
    const c = await crew(a, [m]), other = await crew(s, []);
    const r = await json(share(a, { friends: ["@friend", "stranger", "blocker"], crews: [c, other] }));
    expect(r.shared).toBe(2);                                              // friend + alice's own crew
    for (const u of [f, m]) expect((await shared(u)).map((x: Msg) => [x.name, x.from_handle])).toEqual([["Cherohala loop", "alice"]]);
    for (const u of [s, x]) expect(await shared(u)).toEqual([]);
    const got = await json(api(m, "GET", `/api/routes/${r.id}`));
    expect(got.geom).toHaveLength(50);
    expect(got.geom[0]).toEqual([-83.9, 35.6]);
    expect((await api(s, "GET", `/api/routes/${r.id}`)).status).toBe(404);
    expect(await shared(a)).toEqual([]);                                   // your own aren't "shared with you"
  });

  it("access follows the relationship: unfriend or leave the crew and it's gone", async () => {
    const a = await makeUser("alice"), f = await makeUser("friend");
    await befriend(a, f);
    const r = await json(share(a, { friends: ["friend"] }));
    await ok(api(a, "DELETE", `/api/friends/${f.id}`));
    expect((await api(f, "GET", `/api/routes/${r.id}`)).status).toBe(404);
  });

  it("validates the shape and audience, caps shares a day, and the owner can delete", async () => {
    const a = await makeUser("alice"), f = await makeUser("friend");
    await befriend(a, f);
    expect((await share(a, { friends: [] })).status).toBe(400);
    expect((await share(a, { friends: ["friend"], geom: [[0, 0]] })).status).toBe(400);
    expect((await share(a, { friends: ["friend"], geom: [[0, 99], [0, 0]] })).status).toBe(400);
    expect((await share(a, { friends: ["friend"], name: "" })).status).toBe(400);
    expect(await json(share(a, { friends: ["nobody"] }))).toEqual({ id: null, shared: 0 });
    const r = await json(share(a, { friends: ["friend"] }));
    for (let i = 1; i < MAX_PER_DAY; i++) await ok(share(a, { friends: ["friend"] }));
    expect((await share(a, { friends: ["friend"] })).status).toBe(429);
    expect((await api(f, "DELETE", `/api/routes/${r.id}`)).status).toBe(200);   // not the owner: nothing happens
    expect((await api(f, "GET", `/api/routes/${r.id}`)).status).toBe(200);
    await ok(api(a, "DELETE", `/api/routes/${r.id}`));
    expect((await api(f, "GET", `/api/routes/${r.id}`)).status).toBe(404);
  });
});
