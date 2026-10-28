// Crew drives (src/events.ts, IDEAS S-06): members plan one, RSVP and see who's going; others never see it; the planner
// or the crew's owner cancels it; reports hide it; an account's drives go with it.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeUser, ok, type TestUser } from "./helpers";
import { MAX_UPCOMING } from "../src/events";

beforeEach(freshDb);
type Msg = Record<string, any>;
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as any;
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const DRIVE = { title: "Cherohala Saturday", starts_at: inHours(48), meet: { name: "Tellico Plains Shell", lat: 35.36, lon: -84.29 }, notes: "Full tank, 9:00 sharp." };
async function crewOf(owner: TestUser, ...members: TestUser[]) {
  const id = (await json(api(owner, "POST", "/api/crews", { name: "Ridge Runners" }))).id as string;
  const tok = (await json(api(owner, "POST", `/api/crews/${id}/invite`))).token as string;
  for (const m of members) await ok(api(m, "POST", "/api/crews/join", { token: tok }));
  return id;
}

describe("crew drives", () => {
  it("a member plans one; members see it with who's going; others never do", async () => {
    const [a, b, c, out] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara"), await makeUser("outsider")];
    const crew = await crewOf(a, b, c);
    const { id } = await json(api(b, "POST", `/api/crews/${crew}/events`, DRIVE));
    await ok(api(c, "POST", `/api/events/${id}/rsvp`, { status: "going" }));
    await ok(api(a, "POST", `/api/events/${id}/rsvp`, { status: "maybe" }));
    const [e] = await json(api(a, "GET", `/api/crews/${crew}/events`)) as Msg[];
    expect(e).toMatchObject({ id, title: "Cherohala Saturday", crew_name: "Ridge Runners", meet_name: "Tellico Plains Shell", by_handle: "bob",
      mine: false, can_cancel: true, my_rsvp: "maybe", maybe: 1, notes: "Full tank, 9:00 sharp." });   // alice owns the crew: she can cancel
    expect(e.going.sort()).toEqual(["bob", "cara"]);                                                   // the planner is going
    expect(e.starts_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect((await json(api(c, "GET", "/api/events")) as Msg[]).map((x) => x.id)).toEqual([id]);       // across your crews
    expect((await api(out, "GET", `/api/crews/${crew}/events`)).status).toBe(404);
    expect(await json(api(out, "GET", "/api/events"))).toEqual([]);
    expect((await api(out, "POST", `/api/events/${id}/rsvp`, { status: "going" })).status).toBe(404);
  });

  it("checks what it's given", async () => {
    const a = await makeUser("alice"), crew = await crewOf(a);
    const bad = [
      { ...DRIVE, title: "" }, { ...DRIVE, title: "x".repeat(61) }, { ...DRIVE, title: "bad\u202e" },
      { ...DRIVE, starts_at: inHours(-1) }, { ...DRIVE, starts_at: inHours(24 * 31) }, { ...DRIVE, starts_at: "2026-11-01T09:00:00" },   // no zone
      { ...DRIVE, meet: { lat: 95, lon: 0 } }, { ...DRIVE, notes: "n".repeat(281) }, { ...DRIVE, route_id: "AAAAAAAAAAAAAAAA" },
    ];
    for (const b of bad) expect((await api(a, "POST", `/api/crews/${crew}/events`, b)).status).toBe(400);
    for (let i = 0; i < MAX_UPCOMING; i++) await ok(api(a, "POST", `/api/crews/${crew}/events`, { ...DRIVE, starts_at: inHours(24 + i) }));
    expect((await api(a, "POST", `/api/crews/${crew}/events`, DRIVE)).status).toBe(429);
  });

  it("links a route the planner shared with the crew, and only that", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    const crew = await crewOf(a, b), other = await crewOf(b);
    const geom = [[-84.29, 35.36], [-84.2, 35.4]];
    const toCrew = (await json(api(a, "POST", "/api/routes", { name: "Loop", geom, crews: [crew] }))).id;
    const toOther = (await json(api(b, "POST", "/api/routes", { name: "Elsewhere", geom, crews: [other] }))).id;
    const { id } = await json(api(a, "POST", `/api/crews/${crew}/events`, { ...DRIVE, route_id: toCrew }));
    expect((await json(api(b, "GET", `/api/crews/${crew}/events`)))[0]).toMatchObject({ id, route_id: toCrew });
    expect((await json(api(b, "GET", `/api/routes/${toCrew}`))).name).toBe("Loop");                   // a member can open it
    expect((await api(b, "POST", `/api/crews/${crew}/events`, { ...DRIVE, route_id: toOther })).status).toBe(400);   // not shared with this crew
  });

  it("the planner or the crew owner cancels; a member can't; it drops out of the lists", async () => {
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara")];
    const crew = await crewOf(a, b, c);
    const { id } = await json(api(b, "POST", `/api/crews/${crew}/events`, DRIVE));
    expect((await api(c, "DELETE", `/api/events/${id}`)).status).toBe(403);
    await ok(api(a, "DELETE", `/api/events/${id}`));
    expect(await json(api(b, "GET", `/api/crews/${crew}/events`))).toEqual([]);
    expect((await api(b, "POST", `/api/events/${id}/rsvp`, { status: "going" })).status).toBe(404);
  });

  it("can be reported; the owner's removal cancels it; a blocked person isn't listed as going", async () => {
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara")];
    const crew = await crewOf(a, b, c);
    const { id } = await json(api(b, "POST", `/api/crews/${crew}/events`, DRIVE));
    await ok(api(c, "POST", "/api/reports", { kind: "event", target: id, reason: "spam" }));
    expect((await api(c, "POST", "/api/reports", { kind: "event", target: "BBBBBBBBBBBBBBBB", reason: "spam" })).status).toBe(404);
    await ok(api(c, "POST", "/api/blocks", { handle: "bob" }));
    expect((await json(api(c, "GET", `/api/crews/${crew}/events`)))[0].going).toEqual([]);
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE kind = 'event' AND target_id = ?").bind(id).first<{ n: number }>();
    expect(row!.n).toBe(1);
    await env.DB.prepare("UPDATE crew_events SET cancelled = 1 WHERE id = ?").bind(id).run();   // what moderation 'remove' does
    expect(await json(api(a, "GET", `/api/crews/${crew}/events`))).toEqual([]);
  });

  it("deleting the account takes their drives and answers; the export lists them", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    const crew = await crewOf(a, b);
    await json(api(b, "POST", `/api/crews/${crew}/events`, DRIVE));
    const exp = await json(api(b, "GET", "/api/me/export"));
    expect(exp.crew_drives_planned).toHaveLength(1); expect(exp.crew_drive_rsvps[0].status).toBe("going");
    await ok(api(b, "DELETE", "/api/me", { confirm: "DELETE" }));
    expect(await json(api(a, "GET", `/api/crews/${crew}/events`))).toEqual([]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM crew_event_rsvps").first<{ n: number }>())!.n).toBe(0);
  });
});
