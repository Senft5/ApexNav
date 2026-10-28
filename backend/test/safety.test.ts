import { beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeUser, ok, type TestUser } from "./helpers";

beforeEach(freshDb);

const json = async <T = any>(r: Promise<Response>) => (await (await ok(r)).json()) as T;
const publicCrew = async (u: TestUser, name = "Ridge Runners") =>
  (await json<{ id: string }>(api(u, "POST", "/api/crews", { name, visibility: "public", area: { name: "Robbinsville", lat: 35.3, lon: -83.8 } }))).id;
const nearby = async (u: TestUser) => json<{ id: string }[]>(api(u, "GET", "/api/crews/discover?lat=35.3&lon=-83.8"));
const reportIt = (u: TestUser, b: Record<string, unknown>) => api(u, "POST", "/api/reports", { reason: "spam", ...b });

describe("block", () => {
  it("blocks by handle (crew lists show handles) and lists and undoes it; an unknown handle answers the same", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await befriend(a, b);
    await ok(api(a, "POST", "/api/blocks", { handle: "Bob" }));
    expect(await json(api(a, "GET", "/api/friends"))).toEqual([]);                       // the friendship goes with it
    expect((await json<{ handle: string }[]>(api(a, "GET", "/api/blocks"))).map((x) => x.handle)).toEqual(["bob"]);
    expect(await json(api(b, "GET", "/api/blocks"))).toEqual([]);                        // never who blocked you
    expect((await api(a, "POST", "/api/blocks", { handle: "nobody_here" })).status).toBe(204);
    expect((await api(a, "POST", "/api/blocks", { handle: "alice" })).status).toBe(400);
    await ok(api(a, "DELETE", "/api/blocks/bob"));
    expect(await json(api(a, "GET", "/api/blocks"))).toEqual([]);
    await ok(api(a, "POST", "/api/blocks", { user_id: b.id }));                          // by id still works (friends list)
    expect((await json<unknown[]>(api(a, "GET", "/api/blocks"))).length).toBe(1);
  });
});

describe("report", () => {
  it("validates and only accepts what the reporter could see", async () => {
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara")];
    const priv = (await json<{ id: string }>(api(b, "POST", "/api/crews", { name: "Secret Squirrels" }))).id;
    const car = (await json<{ id: string }>(api(b, "POST", "/api/garage", { make: "BMW", model: "M3" }))).id;   // not shared
    for (const bad of [{ kind: "boat", target: "x" }, { kind: "user", target: "bob", reason: "rude" }, { kind: "user", target: "bob", note: "a\u202eb" },
                       { kind: "user", target: "bob", block: "yes" }]) {
      expect((await reportIt(a, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await reportIt(a, { kind: "crew", target: priv })).status).toBe(404);        // a private crew you're not in
    expect((await reportIt(a, { kind: "car", target: car })).status).toBe(404);          // a car nobody was shown
    expect((await reportIt(a, { kind: "user", target: "nobody_here" })).status).toBe(204); // same answer as a real handle
    await ok(reportIt(a, { kind: "user", target: "bob", reason: "abuse", note: "Threats in the crew chat" }));
    await ok(reportIt(a, { kind: "user", target: "bob", reason: "impersonation" }));     // a second one replaces the first
    await ok(reportIt(c, { kind: "user", target: "bob" }));
    const owner = await makeUser("owner");
    const q = await json<{ kind: string; label: string; reporters: number; notes: string[] }[]>(api(owner, "GET", "/api/moderation"));
    expect(q).toEqual([expect.objectContaining({ kind: "user", label: "bob", reporters: 2 })]);
    expect(q[0].notes.sort()).toEqual(["[impersonation]", "[spam]"]);
  });

  it("report and block in one go", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await befriend(a, b);
    await ok(reportIt(a, { kind: "user", target: "bob", block: true }));
    expect((await json<{ handle: string }[]>(api(a, "GET", "/api/blocks"))).map((x) => x.handle)).toEqual(["bob"]);
    expect(await json(api(a, "GET", "/api/friends"))).toEqual([]);
  });

  it("three people reporting a public crew take it off Crews near you and out of reach of new joiners", async () => {
    const [own, r1, r2, r3, x] = [await makeUser("olga"), await makeUser("rae"), await makeUser("ron"), await makeUser("rex"), await makeUser("xan")];
    const crew = await publicCrew(own);
    for (const r of [r1, r2]) await ok(reportIt(r, { kind: "crew", target: crew }));
    expect((await nearby(x)).map((c) => c.id)).toEqual([crew]);
    await ok(reportIt(r3, { kind: "crew", target: crew }));
    expect(await nearby(x)).toEqual([]);
    expect((await api(x, "POST", `/api/crews/${crew}/join`)).status).toBe(404);
    const owner = await makeUser("owner");                                               // the owner dismisses: it comes back
    await ok(api(owner, "POST", "/api/moderation/resolve", { kind: "crew", target: crew, action: "dismiss" }));
    expect((await nearby(x)).map((c) => c.id)).toEqual([crew]);
    for (const r of [r1, r2, r3]) await ok(reportIt(r, { kind: "crew", target: crew }));
    await ok(api(owner, "POST", "/api/moderation/resolve", { kind: "crew", target: crew, action: "remove" }));
    const mine = await json<{ id: string; visibility: string }[]>(api(own, "GET", "/api/crews"));
    expect(mine.find((c) => c.id === crew)!.visibility).toBe("private");                 // removed from public, not deleted
    expect(await json(api(owner, "GET", "/api/moderation"))).toEqual([]);
  });

  it("reported shared cars leave friends' garages", async () => {
    const [a, ...fs] = [await makeUser("alice"), await makeUser("fay"), await makeUser("finn"), await makeUser("flo")];
    const car = (await json<{ id: string }>(api(a, "POST", "/api/garage", { make: "BMW", model: "M3", shared: true }))).id;
    for (const f of fs) await befriend(a, f);
    for (const f of fs) await ok(reportIt(f, { kind: "car", target: car, reason: "unsafe" }));
    for (const f of fs) expect(await json(api(f, "GET", "/api/garage/people"))).toEqual([]);
    expect((await json<unknown[]>(api(a, "GET", "/api/garage"))).length).toBe(1);       // the owner still has it
  });

  it("twenty reports a day at most", async () => {
    const a = await makeUser("alice");
    const people = [];
    for (let i = 0; i < 21; i++) people.push(await makeUser(`p${String(i).padStart(2, "0")}`));
    for (const p of people.slice(0, 20)) await ok(reportIt(a, { kind: "user", target: p.handle }));
    expect((await reportIt(a, { kind: "user", target: people[20].handle })).status).toBe(429);
  });
});

describe("moderation", () => {
  it("is only for the owner; removing a person ends their membership and signs them out", async () => {
    const [a, b, owner] = [await makeUser("alice"), await makeUser("bob"), await makeUser("owner")];
    expect((await api(a, "GET", "/api/moderation")).status).toBe(404);
    expect((await api(a, "POST", "/api/moderation/resolve", { kind: "user", target: b.id, action: "remove" })).status).toBe(404);
    expect(((await json<{ moderator?: boolean }>(api(owner, "GET", "/api/me")))).moderator).toBe(true);
    expect(((await json<{ moderator?: boolean }>(api(a, "GET", "/api/me")))).moderator).toBeUndefined();
    await ok(reportIt(a, { kind: "user", target: "bob" }));
    const [item] = await json<{ target: string }[]>(api(owner, "GET", "/api/moderation"));
    expect((await api(owner, "POST", "/api/moderation/resolve", { kind: "user", target: owner.id, action: "remove" })).status).toBe(400);
    await ok(api(owner, "POST", "/api/moderation/resolve", { kind: "user", target: item.target, action: "remove" }));
    expect(await json(api(b, "GET", "/api/me"))).toEqual({ signed_in: false });
  });
});
