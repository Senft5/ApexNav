// Daily sweep (src/sweep.ts, IDEAS Y-13): expired sessions, app sign-in codes, unused account invites and crew invites
// are deleted; live rows and used invites (who invited whom) stay.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import worker from "../src/index";
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
    expect(line).toEqual({ event: "sweep", deleted: { sessions: 1, app_auth_codes: 1, invites: 1, crew_invites: 1, hazard_reports: 0, shared_routes: 0 } });
    log.mockRestore();
  });
});
