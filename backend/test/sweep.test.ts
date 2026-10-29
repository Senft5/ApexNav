// Daily sweep (src/sweep.ts, IDEAS Y-13): expired sessions, app sign-in codes, unused account invites and crew invites
// are deleted; live rows and used invites (who invited whom) stay.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import worker from "../src/index";
import { sweepExpired } from "../src/sweep";
import { freshDb, makeUser } from "./helpers";

beforeEach(freshDb);
const past = "datetime('now', '-1 minute')", future = "datetime('now', '+1 day')";
const count = async (table: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

async function seed() {
  const a = await makeUser("alice"), b = await makeUser("bob");
  const crew = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO sessions (id_hash, user_id, expires_at) VALUES ('s-old', ?, ${past})`).bind(a.id),
    env.DB.prepare(`INSERT INTO app_auth_codes (code_hash, user_id, challenge, expires_at) VALUES ('c-old', ?, 'x', ${past}), ('c-new', ?, 'x', ${future})`).bind(a.id, a.id),
    env.DB.prepare(`INSERT INTO invites (token_hash, created_by, expires_at) VALUES ('i-old', ?, ${past}), ('i-new', ?, ${future})`).bind(a.id, a.id),
    env.DB.prepare(`INSERT INTO invites (token_hash, created_by, expires_at, used_by, used_at) VALUES ('i-used', ?, ${past}, ?, datetime('now', '-2 days'))`).bind(a.id, b.id),
    env.DB.prepare("INSERT INTO crews (id, name, owner) VALUES (?, 'Crew', ?)").bind(crew, a.id),
    env.DB.prepare(`INSERT INTO crew_invites (token_hash, crew_id, created_by, expires_at) VALUES ('ci-old', ?, ?, ${past}), ('ci-new', ?, ?, ${future})`).bind(crew, a.id, crew, a.id),
  ]);
  return { a, b };
}

describe("daily sweep", () => {
  it("deletes only expired rows and keeps used invites", async () => {
    await seed();
    const sessions = await count("sessions");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const waits: Promise<unknown>[] = [];
    await worker.scheduled({ cron: "23 6 * * *", scheduledTime: Date.now(), noRetry() {} } as ScheduledController, env,
      { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext);
    await Promise.all(waits);
    expect(await count("sessions")).toBe(sessions - 1);   // the signed-in test users keep theirs
    expect((await env.DB.prepare("SELECT code_hash FROM app_auth_codes").all()).results).toEqual([{ code_hash: "c-new" }]);
    expect((await env.DB.prepare("SELECT token_hash FROM invites ORDER BY token_hash").all()).results.map((r) => r.token_hash)).toEqual(["i-new", "i-used"]);
    expect((await env.DB.prepare("SELECT token_hash FROM crew_invites").all()).results).toEqual([{ token_hash: "ci-new" }]);
    const line = JSON.parse(log.mock.calls.map((c) => c[0] as string).find((l) => l.includes('"sweep"'))!);
    expect(line).toEqual({ event: "sweep", deleted: { sessions: 1, app_auth_codes: 1, invites: 1, crew_invites: 1, hazard_reports: 0, shared_routes: 0, crew_event_rsvps: 0, crew_events: 0, health_counts: 0, eta_shares: 0, feedback: 0, kudos: 0, route_stats: 0, crew_chat: 0 } });
    log.mockRestore();
  });

  it("deletes crew drives a week after they started, with their answers (IDEAS S-06)", async () => {
    const a = await makeUser("alice"), crew = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO crews (id, name, owner) VALUES (?, 'Crew', ?)").bind(crew, a.id),
      env.DB.prepare(`INSERT INTO crew_events (id, crew_id, created_by, title, starts_at, meet_lat, meet_lon) VALUES
        ('old', ?1, ?2, 'Old', datetime('now', '-8 days'), 35, -84), ('recent', ?1, ?2, 'Recent', datetime('now', '-6 days'), 35, -84)`).bind(crew, a.id),
      env.DB.prepare("INSERT INTO crew_event_rsvps (event_id, user_id, status) VALUES ('old', ?1, 'going'), ('recent', ?1, 'going')").bind(a.id),
    ]);
    expect((await sweepExpired(env)).crew_events).toBe(1);
    expect(await count("crew_events")).toBe(1); expect(await count("crew_event_rsvps")).toBe(1);
  });
});
