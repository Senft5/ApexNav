// Recurring meets (src/events.ts rollRepeats, migration 0053; IDEAS S-13): a crew drive that repeats plans its next one
// once it starts; the next keeps the plan, not the answers; cancelling the latest or the planner leaving ends it.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeUser, ok, type TestUser } from "./helpers";
import { nextStart, rollRepeats } from "../src/events";
import { sweepExpired } from "../src/sweep";

beforeEach(freshDb);
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as any;
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const DRIVE = { title: "Cars & Coffee", starts_at: inHours(48), meet: { name: "Kroger lot", lat: 35.76, lon: -83.96 }, notes: "8 to 10." };
async function crewOf(owner: TestUser, ...members: TestUser[]) {
  const id = (await json(api(owner, "POST", "/api/crews", { name: "Ridge Runners" }))).id as string;
  const tok = (await json(api(owner, "POST", `/api/crews/${id}/invite`))).token as string;
  for (const m of members) await ok(api(m, "POST", "/api/crews/join", { token: tok }));
  return id;
}
const started = (id: string, hoursAgo = 2) => env.DB.prepare(`UPDATE crew_events SET starts_at = datetime('now', '-${hoursAgo} hours') WHERE id = ?`).bind(id).run();

describe("recurring meets", () => {
  it("weekly: once it starts the next is planned a week on, with the plan but not the answers", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob");
    const crew = await crewOf(a, b);
    expect((await api(a, "POST", `/api/crews/${crew}/events`, { ...DRIVE, repeat_weeks: 3 })).status).toBe(400);
    const { id } = await json(api(a, "POST", `/api/crews/${crew}/events`, { ...DRIVE, repeat_weeks: 1 }));
    await ok(api(b, "POST", `/api/events/${id}/rsvp`, { status: "going" }));
    let list = await json(api(b, "GET", `/api/crews/${crew}/events`));
    expect(list.map((e: any) => [e.id, e.repeat_weeks])).toEqual([[id, 1]]);
    await started(id);
    list = await json(api(b, "GET", `/api/crews/${crew}/events`));
    expect(list).toHaveLength(2);
    const [old, next] = list;
    expect([old.id, old.repeat_weeks, next.repeat_weeks, next.series_id, old.series_id]).toEqual([id, null, 1, id, id]);
    expect([next.title, next.meet_name, next.notes, next.going, next.my_rsvp]).toEqual(["Cars & Coffee", "Kroger lot", "8 to 10.", ["alice"], null]);
    const gap = Date.parse(next.starts_at) - Date.parse(old.starts_at);
    expect(gap).toBe(7 * 86400_000);
    expect(await rollRepeats(env)).toBe(0);                       // planned once
    // the next one, cancelled: the series ends
    await ok(api(a, "DELETE", `/api/events/${next.id}`));
    await started(next.id);
    expect(await rollRepeats(env)).toBe(0);
  });

  it("many due at once are planned in one go, each once, each with its planner going", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob");
    const crew = await crewOf(a, b);
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await json(api(i % 2 ? b : a, "POST", `/api/crews/${crew}/events`, { ...DRIVE, title: `Run ${i}`, repeat_weeks: 1 }))).id);
    for (const id of ids) await started(id);
    expect(await rollRepeats(env)).toBe(6);
    expect(await rollRepeats(env)).toBe(0);
    const list = await json(api(a, "GET", `/api/crews/${crew}/events`));
    const next = list.filter((e: any) => !ids.includes(e.id));
    expect(next.map((e: any) => e.title).sort()).toEqual(ids.map((_, i) => `Run ${i}`));
    expect(next.map((e: any) => e.going)).toEqual(next.map((e: any) => (Number(e.title.slice(4)) % 2 ? ["bob"] : ["alice"])));
  });

  it("the planner leaving the crew ends it; stopping it on the card ends it; the sweep plans before it deletes", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob");
    const crew = await crewOf(a, b);
    const one = (await json(api(b, "POST", `/api/crews/${crew}/events`, { ...DRIVE, repeat_weeks: 2 }))).id;
    await ok(api(b, "DELETE", `/api/crews/${crew}/membership`));
    await started(one);
    expect(await rollRepeats(env)).toBe(0);
    const two = (await json(api(a, "POST", `/api/crews/${crew}/events`, { ...DRIVE, title: "Sunday run", repeat_weeks: 4 }))).id;
    await ok(api(a, "PUT", `/api/events/${two}`, { repeat_weeks: null }));
    await started(two);
    expect(await rollRepeats(env)).toBe(0);
    // missed for nine days (nobody looked): the sweep plans the next in the future, then deletes the old
    const three = (await json(api(a, "POST", `/api/crews/${crew}/events`, { ...DRIVE, title: "Weekly", repeat_weeks: 1 }))).id;
    await started(three, 9 * 24);
    await sweepExpired(env);
    const list = await json(api(a, "GET", `/api/crews/${crew}/events`));
    const weekly = list.filter((e: any) => e.title === "Weekly");
    expect(weekly).toHaveLength(1);
    expect(weekly[0].id).not.toBe(three);
    expect(Date.parse(weekly[0].starts_at)).toBeGreaterThan(Date.now());
    // repeat can be set later, but only on a series' latest drive
    await ok(api(a, "PUT", `/api/events/${weekly[0].id}`, { repeat_weeks: 2 }));
  });

  it("a public meet near you says it repeats", async () => {
    const a = await makeUser("alice"), c = await makeUser("cara");
    const pub = (await json(api(a, "POST", "/api/crews", { name: "Coffee & Cars", visibility: "public", area: { name: "Maryville", lat: 35.75, lon: -83.97 } }))).id;
    await ok(api(a, "POST", `/api/crews/${pub}/events`, { ...DRIVE, public: true, repeat_weeks: 1 }));
    const near = await json(api(c, "GET", "/api/events/near?lat=35.75&lon=-83.97"));
    expect(near.map((e: any) => [e.title, e.repeat_weeks])).toEqual([["Cars & Coffee", 1]]);
  });

  it("nextStart steps a week (or two, or four) on until it's ahead", () => {
    const now = Date.parse("2026-11-11T12:00:00Z");
    expect(nextStart("2026-11-08 14:00:00", 1, now)).toBe("2026-11-15 14:00:00");
    expect(nextStart("2026-10-25 14:00:00", 1, now)).toBe("2026-11-15 14:00:00");
    expect(nextStart("2026-11-11 11:00:00", 2, now)).toBe("2026-11-25 11:00:00");
    expect(nextStart("2026-11-01 09:30:00", 4, now)).toBe("2026-11-29 09:30:00");
  });
});
