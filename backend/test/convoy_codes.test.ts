// Convoy join codes (IDEAS S-22): six characters the leader reads out; the link keeps working; a person can only try a few.
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeUser, ok, type TestUser } from "./helpers";
import { normCode } from "../src/convoy_routes";

beforeEach(freshDb);
type Msg = Record<string, any>;
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as Msg;
const create = (u: TestUser) => json(api(u, "POST", "/api/convoy", { consent: true, name: "Car park" }));
const code = (u: TestUser, id: string) => api(u, "POST", `/api/convoy/${id}/code`);
const join = (u: TestUser, c: string, consent = true) => api(u, "POST", "/api/convoy/code/join", { consent, code: c });

describe("convoy join codes", () => {
  it("the leader's code lets anyone in (typed loosely), and the link still works", async () => {
    const lead = await makeUser("lead"), a = await makeUser("alice"), b = await makeUser("bob");
    const made = await create(lead), id = made.context.sessionId;
    const c = await json(code(lead, id));
    expect(c.code).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
    expect(c.expiresAtMs).toBeGreaterThan(Date.now());
    const pv = await json(api(a, "POST", "/api/convoy/code/preview", { code: c.code.toLowerCase() }));
    expect(pv).toMatchObject({ name: "Car park", leader: { handle: "lead" }, members: 1, member: false });
    expect((await join(a, c.code, false)).status).toBe(400);                         // consent first
    const ctx = await json(join(a, `${c.code.slice(0, 3)} ${c.code.slice(3)}`));
    expect(ctx.members.map((m: Msg) => m.handle).sort()).toEqual(["alice", "lead"]);
    expect((await api(b, "POST", "/api/convoy/join", { consent: true, invite: made.invite })).status).toBe(200);
  });

  it("only the leader makes one; a new code ends the old one", async () => {
    const lead = await makeUser("lead"), a = await makeUser("alice"), b = await makeUser("bob");
    const id = (await create(lead)).context.sessionId;
    const first = (await json(code(lead, id))).code;
    await ok(join(a, first));
    expect((await code(a, id)).status).toBe(404);                                    // a member, not the leader
    const second = (await json(code(lead, id))).code;
    expect(second).not.toBe(first);
    expect((await join(b, first)).status).toBe(400);
    expect((await join(b, second)).status).toBe(200);
  });

  it("someone who left can't use the same code to come back", async () => {
    const lead = await makeUser("lead"), a = await makeUser("alice");
    const id = (await create(lead)).context.sessionId;
    const c = (await json(code(lead, id))).code;
    await ok(join(a, c));
    await ok(api(a, "POST", `/api/convoy/${id}/leave`));
    expect((await join(a, c)).status).toBe(403);
  });

  it("wrong codes look alike and a person gets ten tries in ten minutes", async () => {
    const lead = await makeUser("lead"), g = await makeUser("guesser");
    const id = (await create(lead)).context.sessionId;
    const real = (await json(code(lead, id))).code;
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await join(g, i % 2 ? "ZZZZZZ" : "bad!")).status);
    expect(new Set(statuses)).toEqual(new Set([400]));
    expect((await join(g, real)).status).toBe(429);                                   // even the right one, once out of tries
  });

  it("reads codes loosely and refuses what can't be one", () => {
    expect(normCode("k7p-4qx")).toBe("K7P4QX");
    expect(normCode(" K7P 4QX ")).toBe("K7P4QX");
    for (const bad of ["K7P4Q", "K7P4QXX", "O0P4QX", "I1L4QX", 123, null]) expect(normCode(bad)).toBeNull();
  });
});
