// Health check (IDEAS Y-05): the status workflow reads it to tell "Worker up" from "Worker and database up", and (migration
// 0055, src/cron_runs.ts) whether the weekly backup and the daily sweep still run.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, freshDb } from "./helpers";
import { cronHealth, runCron } from "../src/cron_runs";

beforeEach(freshDb);
const health = async () => (await (await api(null, "GET", "/api/health")).json()) as Record<string, any>;

describe("health", () => {
  it("answers ok with the database, signed out, never cached; cron jobs never recorded are unknown, not late", async () => {
    const res = await api(null, "GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const none = { age_h: null, failing: false, late: false };
    expect(await res.json()).toEqual({ ok: true, db: true, cron: { backup: none, sweep: none }, failing_routes: [] });
  });

  it("a run that finishes is recorded; one that throws is failing, counted with the 500s, and never rethrown", async () => {
    expect(await runCron(env as any, "sweep", async () => 1)).toBe(true);
    expect((await health()).cron.sweep).toEqual({ age_h: 0, failing: false, late: false });
    expect(await runCron(env as any, "sweep", async () => { throw new Error("D1_ERROR: too many SQL variables at offset 12.345678"); })).toBe(false);
    expect((await health()).cron.sweep).toMatchObject({ failing: true, late: false });
    const row = await env.DB.prepare("SELECT reason FROM cron_runs WHERE job = 'sweep'").first<{ reason: string }>();
    expect(row!.reason).toBe("Error: D1_ERROR: too many SQL variables at offset [num]");   // scrubbed like any error
    const counted = await env.DB.prepare("SELECT kind, n FROM error_counts WHERE source = 'server'").first<{ kind: string; n: number }>();
    expect(counted).toEqual({ kind: "cron sweep", n: 1 });
    // a good run after it clears "failing" (the fail time stays for the record)
    await runCron(env as any, "sweep", async () => 1);
    expect((await health()).cron.sweep.failing).toBe(false);
  });

  it("a route whose 500s keep coming is named; a few, an old burst, or a failing cron job is not", async () => {
    const add = (kind: string, n: number, ago: string, message = "Error: boom") => env.DB.prepare(
      "INSERT INTO error_counts (day, source, kind, message, n, last_at) VALUES (date('now'), 'server', ?, ?, ?, datetime('now', ?))").bind(kind, message, n, ago).run();
    await add("POST /api/drives", 20, "-1 minute");
    await add("POST /api/drives", 6, "-40 minutes", "TypeError: x");          // two messages on one route add up: 26
    await add("GET /api/crews/:id", 24, "-1 minute");                        // under 25 today
    await add("GET /api/roads", 90, "-2 hours");                             // a burst that stopped
    await add("cron sweep", 40, "-1 minute");                                // has its own check
    await env.DB.prepare("INSERT INTO error_counts (day, source, kind, message, n) VALUES (date('now'), 'web', 'error', 'x', 500)").run();   // the page's own
    expect((await health()).failing_routes).toEqual(["POST /api/drives"]);
    await env.DB.prepare("UPDATE error_counts SET day = date('now', '-1 day') WHERE kind = 'POST /api/drives'").run();   // yesterday's is not today's
    expect((await health()).failing_routes).toEqual([]);
  });

  it("late once a run is missed: the backup past 8 days and 6 hours, the sweep past 2 days and 6 hours", async () => {
    await env.DB.prepare("INSERT INTO cron_runs (job, ok_at) VALUES ('backup', datetime('now', '-9 days')), ('sweep', datetime('now', '-49 hours'))").run();
    const c = await cronHealth(env as any);
    expect([c.backup.late, c.backup.age_h, c.sweep.late]).toEqual([true, 216, false]);
    await env.DB.prepare("UPDATE cron_runs SET ok_at = datetime('now', '-55 hours') WHERE job = 'sweep'").run();
    expect((await cronHealth(env as any)).sweep).toEqual({ age_h: 55, failing: false, late: true });
  });

  it("the scheduled handler records both jobs", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 503 }));   // the daily service check asks upstreams
    const worker = (await import("../src/index")).default as any;
    const waits: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} };
    await worker.scheduled({ cron: "23 6 * * *" }, env, ctx);
    await worker.scheduled({ cron: "0 7 * * 1" }, env, ctx);
    await Promise.all(waits);
    const c = (await health()).cron;
    expect([c.sweep.age_h, c.backup.age_h, c.backup.failing]).toEqual([0, 0, false]);
  });
});
