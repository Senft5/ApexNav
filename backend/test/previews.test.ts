import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeBanned, makeUser, ok } from "./helpers";

beforeEach(freshDb);
const json = async <T = Record<string, any>>(r: Promise<Response>) => (await (await ok(r)).json()) as T;

describe("invite previews: what you'd join, before you join", () => {
  it("a crew invite shows the crew's name, owner and size and joins nobody", async () => {
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara")];
    const { id } = await json<{ id: string }>(api(a, "POST", "/api/crews", { name: "Secret Squirrels" }));
    const { token } = await json<{ token: string }>(api(a, "POST", `/api/crews/${id}/invite`));
    await ok(api(c, "POST", "/api/crews/join", { token }));
    expect(await json(api(b, "POST", "/api/crews/invite/preview", { token })))
      .toEqual({ id, name: "Secret Squirrels", visibility: "private", owner: "alice", from: "alice", members: 2, member: false });
    expect((await json<any[]>(api(b, "GET", "/api/crews"))).length).toBe(0);              // looking is not joining
    expect((await json(api(c, "POST", "/api/crews/invite/preview", { token }))).member).toBe(true);
    expect((await api(b, "POST", "/api/crews/invite/preview", { token: "nope-nope-nope" })).status).toBe(400);
    expect((await api(await makeBanned("banned"), "POST", "/api/crews/invite/preview", { token })).status).toBe(403);
  });

  it("a block with the owner, either way, or a reported crew makes the invite look unknown to preview and join", async () => {
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara")];
    const { id } = await json<{ id: string }>(api(a, "POST", "/api/crews", { name: "Squirrels" }));
    const { token } = await json<{ token: string }>(api(a, "POST", `/api/crews/${id}/invite`));
    await ok(api(a, "POST", "/api/blocks", { handle: "bob" }));
    for (const path of ["/api/crews/invite/preview", "/api/crews/join"]) {
      const r = await api(b, "POST", path, { token });
      expect([r.status, await r.json()]).toEqual([400, { error: "invalid_invite" }]);
    }
    await ok(api(c, "POST", "/api/blocks", { handle: "alice" }));                     // the other way round too
    expect((await api(c, "POST", "/api/crews/join", { token })).status).toBe(400);
    for (const h of ["dan", "eve", "fay"]) {                                          // three members report it: hidden
      const u = await makeUser(h);
      await ok(api(u, "POST", "/api/crews/join", { token }));
      await ok(api(u, "POST", "/api/reports", { kind: "crew", target: id, reason: "spam" }));
    }
    const late = await makeUser("gus");
    expect((await api(late, "POST", "/api/crews/invite/preview", { token })).status).toBe(400);
    expect((await api(late, "POST", "/api/crews/join", { token })).status).toBe(400);
  });

  it("a convoy invite shows its name, leader and size, with the same checks as a join", async () => {
    const [lead, m, x, blocked] = [await makeUser("lead"), await makeUser("moe"), await makeUser("xan"), await makeUser("bea")];
    const { invite } = await json<{ invite: string }>(api(lead, "POST", "/api/convoy", { consent: true, name: "Sunday run" }));
    const p = await json(api(x, "POST", "/api/convoy/preview", { invite }));
    expect(p).toMatchObject({ name: "Sunday run", leader: { handle: "lead" }, members: 1, max: 16, member: false });
    expect(typeof p.expiresAtMs).toBe("number");
    expect(Object.keys(p).sort()).toEqual(["expiresAtMs", "leader", "max", "member", "members", "name"]);
    expect(p.leader).toEqual({ handle: "lead" });                                     // never the real name
    await ok(api(m, "POST", "/api/convoy/join", { consent: true, invite }));
    expect((await json(api(x, "POST", "/api/convoy/preview", { invite }))).members).toBe(2);  // previewing joined nobody
    expect((await json(api(m, "POST", "/api/convoy/preview", { invite }))).member).toBe(true);
    const [id] = invite.split(".");
    expect((await api(x, "POST", "/api/convoy/preview", { invite: `${id}.wrongwrongwrongwrongwrong` })).status).toBe(400);
    await ok(api(blocked, "POST", "/api/blocks", { handle: "moe" }));
    expect((await api(blocked, "POST", "/api/convoy/preview", { invite })).status).toBe(403);
    for (let i = 2; i < 16; i++) await ok(api(await makeUser(`fill${i}`), "POST", "/api/convoy/join", { consent: true, invite }));
    // full answers like a join, before the block check, so a blocked person can't tell the two apart
    for (const u of [x, blocked]) expect((await api(u, "POST", "/api/convoy/preview", { invite })).status).toBe(409);
    await ok(api(lead, "POST", `/api/convoy/${id}/leave`));
    expect((await api(x, "POST", "/api/convoy/preview", { invite })).status).toBe(404);   // ended
  });
});
