import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
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
    await ok(reportIt(a, { kind: "user", target: "bob", reason: "abuse", note: "Threats in\n[spam] the crew chat" }));
    await ok(reportIt(a, { kind: "user", target: "bob", reason: "impersonation" }));     // a second one replaces the first
    await ok(reportIt(c, { kind: "user", target: "bob", note: "Threats in\n[spam] the crew chat" }));
    const owner = await makeUser("owner");
    const q = await json<{ kind: string; label: string; reporters: number; notes: string[]; who: string[]; hidden: boolean }[]>(api(owner, "GET", "/api/moderation"));
    expect(q).toEqual([expect.objectContaining({ kind: "user", label: "@bob", reporters: 2, hidden: false })]);
    expect(q[0].notes.sort()).toEqual(["[impersonation]", "[spam] Threats in [spam] the crew chat"]);   // one line per report
    expect(q[0].who.sort()).toEqual(["@alice", "@cara"]);
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
    expect((await json<{ hidden: boolean }[]>(api(owner, "GET", "/api/moderation")))[0].hidden).toBe(true);
    await ok(api(owner, "POST", "/api/moderation/resolve", { kind: "crew", target: crew, action: "dismiss" }));
    expect((await nearby(x)).map((c) => c.id)).toEqual([crew]);
    for (const r of [r1, r2, r3]) await ok(reportIt(r, { kind: "crew", target: crew }));  // the same people can't hide it again
    expect((await nearby(x)).map((c) => c.id)).toEqual([crew]);
    expect(await json(api(owner, "GET", "/api/moderation"))).toEqual([]);
    for (const r of [x, await makeUser("ria"), await makeUser("rob")]) await ok(reportIt(r, { kind: "crew", target: crew }));
    await ok(api(owner, "POST", "/api/moderation/resolve", { kind: "crew", target: crew, action: "remove" }));
    const mine = await json<{ id: string; visibility: string }[]>(api(own, "GET", "/api/crews"));
    expect(mine.find((c) => c.id === crew)!.visibility).toBe("private");                 // removed from public, not deleted
    expect((await api(own, "PUT", `/api/crews/${crew}`, { visibility: "public", area: { name: "Robbinsville", lat: 35.3, lon: -83.8 } })).status).toBe(403);
    expect(await json(api(owner, "GET", "/api/moderation"))).toEqual([]);
  });

  it("one member's spare accounts count once", async () => {
    const [own, a, b, c, x] = [await makeUser("olga"), await makeUser("abe"), await makeUser("bea"), await makeUser("cy"), await makeUser("xan")];
    const crew = await publicCrew(own);
    await env.DB.prepare("UPDATE members SET invited_by = ? WHERE user_id IN (?, ?)").bind(a.id, b.id, c.id).run();   // a invited b and c
    for (const r of [a, b, c]) await ok(reportIt(r, { kind: "crew", target: crew }));
    expect((await nearby(x)).map((k) => k.id)).toEqual([crew]);
    const q = await json<{ who: string[] }[]>(api(await makeUser("owner"), "GET", "/api/moderation"));
    expect(q[0].who.sort()).toEqual(["@abe", "@bea (invited by @abe)", "@cy (invited by @abe)"]);
  });

  it("reported shared cars leave friends' garages", async () => {
    const [a, ...fs] = [await makeUser("alice"), await makeUser("fay"), await makeUser("finn"), await makeUser("flo")];
    const car = (await json<{ id: string }>(api(a, "POST", "/api/garage", { make: "BMW", model: "M3", shared: true }))).id;
    for (const f of fs) await befriend(a, f);
    for (const f of fs) await ok(reportIt(f, { kind: "car", target: car, reason: "unsafe" }));
    for (const f of fs) expect(await json(api(f, "GET", "/api/garage/people"))).toEqual([]);
    expect((await json<unknown[]>(api(a, "GET", "/api/garage"))).length).toBe(1);       // the owner still has it
    expect((await reportIt(await makeUser("stranger"), { kind: "car", target: car })).status).toBe(404);   // never shown to them
    await ok(api(await makeUser("owner"), "POST", "/api/moderation/resolve", { kind: "car", target: car, action: "remove" }));
    expect((await api(a, "PUT", `/api/garage/${car}`, { make: "BMW", model: "M3", shared: true })).status).toBe(403);
    await ok(api(a, "PUT", `/api/garage/${car}`, { make: "BMW", model: "M3 CSL" }));      // still theirs to edit, just not to show
  });

  it("spots: three reports hide one; dismissing a report never brings back a spot the owner removed", async () => {
    const [a, ...rs] = [await makeUser("alice"), await makeUser("rae"), await makeUser("ron"), await makeUser("rex")];
    const owner = await makeUser("owner");
    await env.DB.prepare("INSERT INTO highlights (id, author_id, name, category, lat, lon) VALUES ('h1', ?, 'Overlook', 'overlook', 35.3, -83.8)").bind(a.id).run();
    const status = async () => (await env.DB.prepare("SELECT status FROM highlights WHERE id = 'h1'").first<{ status: string }>())!.status;
    await ok(api(rs[0], "POST", "/api/highlights/h1/report", { note: "spam" }));        // the older route files the same report
    for (const r of rs.slice(1)) await ok(reportIt(r, { kind: "highlight", target: "h1" }));
    expect(await status()).toBe("hidden");
    await ok(api(owner, "POST", "/api/moderation/resolve", { kind: "highlight", target: "h1", action: "dismiss" }));
    expect(await status()).toBe("active");
    for (const r of [await makeUser("ria"), await makeUser("rob"), await makeUser("roy")]) await ok(reportIt(r, { kind: "highlight", target: "h1" }));
    await ok(api(owner, "POST", "/api/moderation/resolve", { kind: "highlight", target: "h1", action: "remove" }));
    expect(await status()).toBe("hidden");
    expect((await reportIt(await makeUser("rue"), { kind: "highlight", target: "h1" })).status).toBe(404);   // hidden: nothing to report
    await env.DB.prepare("INSERT INTO reports (id, reporter, kind, target_id, note) VALUES ('x', ?, 'highlight', 'h1', '[spam]')").bind(a.id).run();
    await ok(api(owner, "POST", "/api/moderation/resolve", { kind: "highlight", target: "h1", action: "dismiss" }));
    expect(await status()).toBe("hidden");
  });

  it("twenty reports a day at most", async () => {
    const a = await makeUser("alice");
    const people = [];
    for (let i = 0; i < 21; i++) people.push(await makeUser(`p${String(i).padStart(2, "0")}`));
    for (const p of people.slice(0, 20)) await ok(reportIt(a, { kind: "user", target: p.handle }));
    expect((await reportIt(a, { kind: "user", target: people[20].handle })).status).toBe(429);
    expect((await reportIt(a, { kind: "user", target: "nobody_here" })).status).toBe(429);   // same answer: no handle oracle
  });
});

describe("moderation", () => {
  it("is only for the owner; removing a person bans them for good, but they can still take their data or delete the account", async () => {
    const [a, b, owner] = [await makeUser("alice"), await makeUser("bob"), await makeUser("owner")];
    expect((await api(a, "GET", "/api/moderation")).status).toBe(404);
    expect((await api(a, "POST", "/api/moderation/resolve", { kind: "user", target: b.id, action: "remove" })).status).toBe(404);
    expect(((await json<{ moderator?: boolean }>(api(owner, "GET", "/api/me")))).moderator).toBe(true);
    expect(((await json<{ moderator?: boolean }>(api(a, "GET", "/api/me")))).moderator).toBeUndefined();
    await ok(reportIt(a, { kind: "user", target: "bob" }));
    const crew = await publicCrew(b, "Bob's Crew");
    const car = (await json<{ id: string }>(api(b, "POST", "/api/garage", { make: "BMW", model: "M3", shared: true }))).id;
    const { token } = await json<{ token: string }>(api(b, "POST", "/api/invites"));
    const [item] = await json<{ target: string }[]>(api(owner, "GET", "/api/moderation"));
    expect((await api(owner, "POST", "/api/moderation/resolve", { kind: "user", target: owner.id, action: "remove" })).status).toBe(400);
    await ok(api(owner, "POST", "/api/moderation/resolve", { kind: "user", target: item.target, action: "remove" }));
    expect(await json(api(b, "GET", "/api/me"))).toEqual({ signed_in: false });
    expect(await nearby(a)).toEqual([]);                                                  // their public crew is private now
    expect((await env.DB.prepare("SELECT shared FROM cars WHERE id = ?").bind(car).first<{ shared: number }>())!.shared).toBe(0);
    const newcomer = await makeUser("newbie", false);
    expect((await api(newcomer, "POST", "/api/invites/redeem", { token })).status).toBe(400);   // their invites are void
    // they sign in again: not a member, can't get back in on anyone's invite, can still download and delete
    const again = { ...b, token: `tok-again-${crypto.randomUUID()}` };
    const { sha256hex } = await import("../src/util");
    await env.DB.prepare("INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))").bind(await sha256hex(again.token), b.id).run();
    expect((await json<{ member: boolean }>(api(again, "GET", "/api/me"))).member).toBe(false);
    const fresh = await json<{ token: string }>(api(a, "POST", "/api/invites"));
    expect((await api(again, "POST", "/api/invites/redeem", { token: fresh.token })).status).toBe(403);
    expect((await json<{ profile: { handle: string } }>(api(again, "GET", "/api/me/export"))).profile.handle).toBe("bob");
    await ok(api(again, "DELETE", "/api/me", { confirm: "DELETE" }));
  });

  it("you can't redeem your own invite", async () => {
    const a = await makeUser("alice");
    const { token } = await json<{ token: string }>(api(a, "POST", "/api/invites"));
    expect((await api(a, "POST", "/api/invites/redeem", { token })).status).toBe(400);
  });
});
