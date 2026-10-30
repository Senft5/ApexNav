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

  it("a public crew lists a meet for everyone nearby; a private crew can't; it goes with privacy, distance, blocks and reports", async () => {
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara")];
    const pub = (await json(api(a, "POST", "/api/crews", { name: "Coffee & Cars", visibility: "public", area: { name: "Maryville", lat: 35.75, lon: -83.97 } }))).id;
    const priv = await crewOf(a);
    const near = (u: TestUser, lat = 35.8, lon = -83.9) => json(api(u, "GET", `/api/events/near?lat=${lat}&lon=${lon}`));
    expect((await api(a, "POST", `/api/crews/${priv}/events`, { ...DRIVE, public: true })).status).toBe(400);
    const { id } = await json(api(a, "POST", `/api/crews/${pub}/events`, { ...DRIVE, meet: { name: "Kroger lot", lat: 35.76, lon: -83.96 }, public: true }));
    await json(api(a, "POST", `/api/crews/${pub}/events`, { ...DRIVE, title: "Members only", starts_at: inHours(50) }));   // not listed
    const [m] = await near(b) as Msg[];
    expect(m).toMatchObject({ id, crew_name: "Coffee & Cars", title: "Cherohala Saturday", meet_name: "Kroger lot", going: 1, member: false });
    expect(JSON.stringify(m)).not.toMatch(/alice|by_handle/);                                      // no handles for outsiders
    expect((await near(b)).length).toBe(1);
    expect(await near(b, 37.5, -83.9)).toEqual([]);                                                    // ~190 km away
    await ok(api(b, "POST", `/api/crews/${pub}/join`));
    expect((await near(b))[0].member).toBe(true);
    await ok(api(c, "POST", "/api/blocks", { handle: "alice" }));
    expect(await near(c)).toEqual([]);                                                                 // blocked the planner
    await ok(api(a, "PUT", `/api/crews/${pub}`, { visibility: "private" }));
    expect(await near(b)).toEqual([]);                                                                 // the crew went private
  });

  it("roles and regroup points (roadmap 21): the planner leads, a going member sweeps, a role opens when its holder drops out", async () => {
    const [a, b, c, out] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara"), await makeUser("outsider")];
    const crew = await crewOf(a, b, c);
    const regroup = [{ name: "Overlook", lat: 35.3311119, lon: -84.12 }, { name: "Gas, Robbinsville", lat: 35.32, lon: -83.8 }];
    const { id } = await json(api(b, "POST", `/api/crews/${crew}/events`, { ...DRIVE, regroup }));
    let [e] = await json(api(a, "GET", `/api/crews/${crew}/events`)) as Msg[];
    expect([e.lead, e.sweep]).toEqual(["bob", null]);
    expect(e.regroup).toEqual([{ name: "Overlook", lat: 35.33111, lon: -84.12 }, { name: "Gas, Robbinsville", lat: 35.32, lon: -83.8 }]);
    await ok(api(c, "POST", `/api/events/${id}/role`, { role: "sweep", take: true }));
    expect((await api(a, "POST", `/api/events/${id}/role`, { role: "sweep", take: true })).status).toBe(409);   // taken
    expect((await api(b, "POST", `/api/events/${id}/role`, { role: "sweep", take: true })).status).toBe(409);   // bob leads already
    [e] = await json(api(a, "GET", `/api/crews/${crew}/events`)) as Msg[];
    expect([e.lead, e.sweep, e.going.sort()]).toEqual(["bob", "cara", ["bob", "cara"]]);                       // taking a role is going
    await ok(api(c, "POST", `/api/events/${id}/rsvp`, { status: "no" }));                                     // cara drops out
    [e] = await json(api(a, "GET", `/api/crews/${crew}/events`)) as Msg[];
    expect(e.sweep).toBeNull();
    expect((await api(c, "POST", `/api/events/${id}/role`, { role: "lead", take: false })).status).toBe(404);   // not hers to clear
    await ok(api(a, "POST", `/api/events/${id}/role`, { role: "lead", take: false }));                        // the crew's owner may
    await ok(api(a, "POST", `/api/events/${id}/role`, { role: "lead", take: true }));
    expect((await json(api(b, "GET", `/api/crews/${crew}/events`)) as Msg[])[0].lead).toBe("alice");
    expect((await api(out, "POST", `/api/events/${id}/role`, { role: "lead", take: true })).status).toBe(404);
    // named at planning: members only, not the same person twice, at most 5 regroup points with names
    const plan = (x: Msg) => api(a, "POST", `/api/crews/${crew}/events`, { ...DRIVE, ...x });
    expect((await plan({ lead: "cara", sweep: "bob" })).status).toBe(201);
    expect((await plan({ sweep: "outsider" })).status).toBe(400);
    expect((await plan({ lead: "bob", sweep: "bob" })).status).toBe(400);
    expect((await plan({ regroup: Array.from({ length: 6 }, (_, i) => ({ name: `R${i}`, lat: 35, lon: -84 })) })).status).toBe(400);
    expect((await plan({ regroup: [{ name: " ", lat: 35, lon: -84 }] })).status).toBe(400);
    expect((await plan({ regroup: [{ name: "Top", lat: 95, lon: -84 }] })).status).toBe(400);
  });
});

// The run as one card (REVIEW_PEOPLE.md P-03, P-10, roadmap 2): set the rest on the card, who came, the record.
describe("a drive's card and its record", () => {
  it("the planner or the crew's owner sets notes, regroup points, a meet and roles afterwards; a member can't", async () => {
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara")];
    const crew = await crewOf(a, b, c);
    const { id } = await json(api(b, "POST", `/api/crews/${crew}/events`, { ...DRIVE, notes: undefined }));
    expect((await api(c, "PUT", `/api/events/${id}`, { notes: "Mine now" })).status).toBe(403);
    await ok(api(b, "PUT", `/api/events/${id}`, { notes: "Fuel first.", regroup: [{ name: "The overlook", lat: 35.33, lon: -84.12 }], sweep: "cara" }));
    let [e] = await json(api(a, "GET", `/api/crews/${crew}/events`)) as Msg[];
    expect([e.notes, e.regroup, e.lead, e.sweep]).toEqual(["Fuel first.", [{ name: "The overlook", lat: 35.33, lon: -84.12 }], "bob", "cara"]);
    expect(e.going.sort()).toEqual(["bob", "cara"]);                                                          // named to sweep: going
    await ok(api(a, "PUT", `/api/events/${id}`, { notes: null, sweep: null }));                               // the owner may too
    [e] = await json(api(a, "GET", `/api/crews/${crew}/events`)) as Msg[];
    expect([e.notes, e.sweep, e.lead]).toEqual([null, null, "bob"]);
    expect((await api(b, "PUT", `/api/events/${id}`, { lead: "cara", sweep: "cara" })).status).toBe(400);
    expect((await api(b, "PUT", `/api/events/${id}`, { public: true })).status).toBe(400);                  // a private crew lists no meet
    expect((await api(b, "PUT", `/api/events/${id}`, { regroup: [{ name: "", lat: 0, lon: 0 }] })).status).toBe(400);
  });

  it("who came, who said going, and the best Score from the day among those who came; blocks hide; members only", async () => {
    const [a, b, c, out] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara"), await makeUser("outsider")];
    const crew = await crewOf(a, b, c);
    const { id } = await json(api(a, "POST", `/api/crews/${crew}/events`, DRIVE));
    await ok(api(b, "POST", `/api/events/${id}/rsvp`, { status: "going" }));
    expect((await api(b, "POST", `/api/events/${id}/came`)).status).toBe(400);                                // two days out: not yet
    // the drive was this morning (the sweep keeps it a week)
    await env.DB.prepare("UPDATE crew_events SET starts_at = datetime('now', '-5 hours') WHERE id = ?").bind(id).run();
    let r = await json(api(c, "GET", `/api/events/${id}/record`));
    expect(r).toMatchObject({ id, title: "Cherohala Saturday", crew_name: "Ridge Runners", came: [], i_came: false, best: null });
    expect(r.going.sort()).toEqual(["alice", "bob"]);
    await ok(api(a, "POST", `/api/events/${id}/came`));
    await ok(api(b, "POST", `/api/events/${id}/came`));
    await ok(api(b, "POST", `/api/events/${id}/came`));                                                       // said twice: once
    // Scores published to the crew that day: bob's 811, alice's 790, and cara's 900 (she didn't come)
    await env.DB.prepare("INSERT INTO segments (id, owner, name, length_m, geom, start_lat, start_lon, end_lat, end_lon) VALUES ('s1', ?, 'Cherohala Skyway', 3000, '[[1,2]]', 1, 2, 3, 4)").bind(a.id).run();
    for (const [u, score] of [[a, 790], [b, 811], [c, 900]] as const) {
      await ok(api(u, "PUT", "/api/grants", { audience_type: "crew", audience_id: crew, share_scores: true, share_times: false }));
      await env.DB.prepare("INSERT INTO board_entries (id, segment_id, user_id, audience_type, audience_id, driver_score, driven_on) VALUES (?, 's1', ?, 'crew', ?, ?, date('now', '-5 hours'))")
        .bind(crypto.randomUUID(), u.id, crew, score).run();
    }
    r = await json(api(c, "GET", `/api/events/${id}/record`));
    expect(r.came).toEqual(["alice", "bob"]);
    expect(r.best).toEqual({ handle: "bob", score: 811, stage: "Cherohala Skyway" });
    expect((await json(api(b, "GET", `/api/events/${id}/record`))).i_came).toBe(true);
    await ok(api(c, "POST", "/api/blocks", { handle: "bob" }));
    r = await json(api(c, "GET", `/api/events/${id}/record`));
    expect([r.came, r.best && r.best.handle]).toEqual([["alice"], "alice"]);
    await ok(api(a, "DELETE", `/api/events/${id}/came`));
    expect((await json(api(a, "GET", `/api/events/${id}/record`))).came).toEqual(["bob"]);
    expect((await api(out, "GET", `/api/events/${id}/record`)).status).toBe(404);
    expect((await api(out, "POST", `/api/events/${id}/came`)).status).toBe(404);
    // the crew page: no next drive now, the last one for its record
    const page = await json(api(a, "GET", `/api/crews/${crew}/page`));
    expect([page.next, page.last && page.last.id]).toEqual([null, id]);
    // the export lists it; the account's deletion takes it
    expect((await json(api(b, "GET", "/api/me/export"))).crew_drives_came_to).toHaveLength(1);
    await ok(api(b, "DELETE", "/api/me", { confirm: "DELETE" }));
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM crew_event_attendance").first<{ n: number }>())!.n).toBe(0);
  });

  it("a drive that started within the hours of its convoy stays the crew page's next drive", async () => {
    const a = await makeUser("alice"), crew = await crewOf(a);
    const { id } = await json(api(a, "POST", `/api/crews/${crew}/events`, DRIVE));
    await env.DB.prepare("UPDATE crew_events SET starts_at = datetime('now', '-3 hours') WHERE id = ?").bind(id).run();
    const page = await json(api(a, "GET", `/api/crews/${crew}/page`));
    expect([page.next && page.next.id, page.last]).toEqual([id, null]);
  });
});
