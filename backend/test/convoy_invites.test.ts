// In-app convoy invites (IDEAS S-22): the leader invites friends and private crew-mates by handle; they see the invite in
// the app and join without a link. Strangers, public-crew acquaintances and either side of a block are skipped silently.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeUser, ok, type TestUser } from "./helpers";

beforeEach(freshDb);
type Msg = Record<string, any>;
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as Msg;
const create = (u: TestUser, name = "Sunday run") => json(api(u, "POST", "/api/convoy", { consent: true, name }));
const invite = (u: TestUser, id: string, handles: string[]) => api(u, "POST", `/api/convoy/${id}/invite-people`, { handles });
const invites = (u: TestUser) => json(api(u, "GET", "/api/convoy/invites"));
const accept = (u: TestUser, id: string) => api(u, "POST", `/api/convoy/${id}/accept`, { consent: true });

async function crew(owner: TestUser, members: TestUser[], visibility: "private" | "public") {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO crews (id, name, owner, visibility) VALUES (?, 'Crew', ?, ?)").bind(id, owner.id, visibility).run();
  for (const m of [owner, ...members]) await env.DB.prepare("INSERT INTO crew_members (crew_id, user_id) VALUES (?, ?)").bind(id, m.id).run();
}

describe("in-app convoy invites", () => {
  it("friends and private crew-mates get the invite and join without a link; nobody else does", async () => {
    const lead = await makeUser("lead"), friend = await makeUser("friend"), mate = await makeUser("mate"), pub = await makeUser("pubmate"),
      stranger = await makeUser("stranger"), blocked = await makeUser("blocked");
    await befriend(lead, friend); await befriend(lead, blocked);
    await crew(lead, [mate], "private"); await crew(lead, [pub], "public");
    await ok(api(blocked, "POST", "/api/blocks", { user_id: lead.id }));
    const made = await create(lead), id = made.context.sessionId;
    const r = await json(invite(lead, id, ["@friend", "mate", "pubmate", "stranger", "blocked", "nobody"]));
    expect(r).toEqual({ invited: 2 });
    for (const u of [pub, stranger, blocked]) expect(await invites(u)).toEqual([]);
    const got = await invites(friend);
    expect(got).toEqual([{ id, name: "Sunday run", from: "lead", expiresAtMs: expect.any(Number) }]);
    expect(Object.keys(got[0]).sort()).toEqual(["expiresAtMs", "from", "id", "name"]);   // no secret, no account ids
    const ctx = await json(accept(friend, id));
    expect(ctx.members.map((m: Msg) => m.handle).sort()).toEqual(["friend", "lead"]);
    expect(await invites(friend)).toEqual([]);                                             // gone once joined
    expect((await accept(stranger, id)).status).toBe(400);                                 // not invited: no way in
    // The leader's link still works for people they share it with (the in-app invite didn't rotate it).
    expect((await api(stranger, "POST", "/api/convoy/join", { consent: true, invite: made.invite })).status).toBe(200);
  });

  it("only the leader invites; consent is still required; dismissing removes it", async () => {
    const lead = await makeUser("lead"), friend = await makeUser("friend"), other = await makeUser("other");
    await befriend(lead, friend); await befriend(friend, other);
    const id = (await create(lead)).context.sessionId;
    await ok(invite(lead, id, ["friend"]));
    await ok(accept(friend, id));
    expect((await invite(friend, id, ["other"])).status).toBe(404);                      // a member, not the leader
    const id2 = (await create(lead, "Second")).context.sessionId;
    await ok(invite(lead, id2, ["friend"]));
    expect((await api(friend, "POST", `/api/convoy/${id2}/accept`, {})).status).toBe(400);  // no consent
    await ok(api(friend, "DELETE", `/api/convoy/invites/${id2}`));
    expect(await invites(friend)).toEqual([]);
  });

  it("someone who left can't use an older invite to come back", async () => {
    const lead = await makeUser("lead"), friend = await makeUser("friend");
    await befriend(lead, friend);
    const id = (await create(lead)).context.sessionId;
    await ok(invite(lead, id, ["friend"]));
    await ok(accept(friend, id));
    await ok(api(friend, "POST", `/api/convoy/${id}/leave`));
    expect((await accept(friend, id)).status).toBe(400);   // the invite was used up by the first join
    await ok(invite(lead, id, ["friend"]));                // a fresh invite after leaving does let them back
    expect((await accept(friend, id)).status).toBe(200);
  });

  it("refuses a bad request", async () => {
    const lead = await makeUser("lead");
    const id = (await create(lead)).context.sessionId;
    expect((await invite(lead, id, [])).status).toBe(400);
    expect((await invite(lead, id, Array.from({ length: 16 }, (_, i) => `h${i}`))).status).toBe(400);
    expect((await api(lead, "POST", `/api/convoy/${id}/invite-people`, { handles: "lead" })).status).toBe(400);
  });
});
